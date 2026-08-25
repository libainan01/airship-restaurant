export interface KernelCommand<TPayload = unknown> {
  readonly id: string;
  readonly type: string;
  readonly payload: TPayload;
}

export type CommandBusRejectionCode =
  | "INVALID_COMMAND"
  | "UNKNOWN_COMMAND"
  | "DUPLICATE_COMMAND"
  | "HANDLER_REJECTED";

export type CommandHandlerResult<TValue = unknown> =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly value?: TValue;
    }
  | {
      readonly accepted: false;
      readonly code?: string;
      readonly message: string;
    };

export type CommandBusResult<TValue = unknown> =
  | {
      readonly accepted: true;
      readonly changed: boolean;
      readonly commandId: string;
      readonly value?: TValue;
    }
  | {
      readonly accepted: false;
      readonly changed: false;
      readonly commandId: string | null;
      readonly code: CommandBusRejectionCode | string;
      readonly message: string;
    };

export interface CommandHandler<TContext, TPayload = unknown, TValue = unknown> {
  readonly validatePayload?: (payload: unknown) => payload is TPayload;
  readonly handle: (
    command: KernelCommand<TPayload>,
    context: TContext,
  ) => CommandHandlerResult<TValue>;
}

export interface CommandBusOptions {
  readonly commandHistoryLimit?: number;
}

function isKernelCommand(value: unknown): value is KernelCommand {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    "type" in value &&
    typeof value.type === "string" &&
    value.type.length > 0 &&
    "payload" in value
  );
}

export class CommandBus<TContext> {
  readonly #handlers = new Map<string, CommandHandler<TContext>>();
  readonly #processedCommandIds = new Set<string>();
  readonly #commandHistory: string[] = [];
  readonly #commandHistoryLimit: number;

  constructor(options: CommandBusOptions = {}) {
    const historyLimit = options.commandHistoryLimit ?? 512;
    if (!Number.isSafeInteger(historyLimit) || historyLimit <= 0) {
      throw new RangeError("Command history limit must be a positive integer.");
    }
    this.#commandHistoryLimit = historyLimit;
  }

  register<TPayload, TValue>(
    commandType: string,
    handler: CommandHandler<TContext, TPayload, TValue>,
  ): () => void {
    if (commandType.length === 0) {
      throw new Error("Command type must not be empty.");
    }
    if (this.#handlers.has(commandType)) {
      throw new Error(`Command handler already registered: ${commandType}`);
    }
    this.#handlers.set(
      commandType,
      handler as CommandHandler<TContext>,
    );
    return () => {
      if (this.#handlers.get(commandType) === handler) {
        this.#handlers.delete(commandType);
      }
    };
  }

  dispatch(command: unknown, context: TContext): CommandBusResult {
    if (!isKernelCommand(command)) {
      return this.#reject(
        null,
        "INVALID_COMMAND",
        "The command failed structural validation.",
      );
    }
    if (this.#processedCommandIds.has(command.id)) {
      return this.#reject(
        command.id,
        "DUPLICATE_COMMAND",
        "The command id has already been processed.",
      );
    }
    const handler = this.#handlers.get(command.type);
    if (handler === undefined) {
      return this.#reject(
        command.id,
        "UNKNOWN_COMMAND",
        `No command handler is registered for ${command.type}.`,
      );
    }
    if (
      handler.validatePayload !== undefined &&
      !handler.validatePayload(command.payload)
    ) {
      this.#remember(command.id);
      return this.#reject(
        command.id,
        "INVALID_COMMAND",
        "The command payload failed validation.",
      );
    }
    const result = handler.handle(command, context);
    this.#remember(command.id);
    if (!result.accepted) {
      return this.#reject(
        command.id,
        result.code ?? "HANDLER_REJECTED",
        result.message,
      );
    }
    return Object.freeze({
      accepted: true,
      changed: result.changed,
      commandId: command.id,
      ...(result.value === undefined ? {} : { value: result.value }),
    });
  }

  #remember(commandId: string): void {
    this.#processedCommandIds.add(commandId);
    this.#commandHistory.push(commandId);
    if (this.#commandHistory.length <= this.#commandHistoryLimit) return;
    const oldest = this.#commandHistory.shift();
    if (oldest !== undefined) this.#processedCommandIds.delete(oldest);
  }

  #reject(
    commandId: string | null,
    code: CommandBusRejectionCode | string,
    message: string,
  ): CommandBusResult {
    return Object.freeze({
      accepted: false,
      changed: false,
      commandId,
      code,
      message,
    });
  }
}
