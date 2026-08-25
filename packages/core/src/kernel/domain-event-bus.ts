export interface DomainEvent<TPayload = unknown> {
  readonly id: string;
  readonly type: string;
  readonly occurredAtUtcMs: number;
  readonly payload: TPayload;
  readonly causationId?: string;
  readonly correlationId?: string;
}

export type DomainEventHandler<TEvent extends DomainEvent = DomainEvent> = (
  event: TEvent,
) => void;

export interface DomainEventSubscriberError {
  readonly event: DomainEvent;
  readonly error: unknown;
}

export interface DomainEventPublishReport {
  readonly publishedEventIds: readonly string[];
  readonly duplicateEventIds: readonly string[];
  readonly subscriberErrorCount: number;
}

export interface DomainEventBusOptions {
  readonly eventHistoryLimit?: number;
  readonly onSubscriberError?: (failure: DomainEventSubscriberError) => void;
}

export class DomainEventBus {
  readonly #handlersByType = new Map<string, Set<DomainEventHandler>>();
  readonly #allHandlers = new Set<DomainEventHandler>();
  readonly #processedEventIds = new Set<string>();
  readonly #eventHistory: string[] = [];
  readonly #eventHistoryLimit: number;
  readonly #onSubscriberError: ((failure: DomainEventSubscriberError) => void) | undefined;

  constructor(options: DomainEventBusOptions = {}) {
    const historyLimit = options.eventHistoryLimit ?? 2_048;
    if (!Number.isSafeInteger(historyLimit) || historyLimit <= 0) {
      throw new RangeError("Event history limit must be a positive integer.");
    }
    this.#eventHistoryLimit = historyLimit;
    this.#onSubscriberError = options.onSubscriberError;
  }

  subscribe(
    eventType: string | "*",
    handler: DomainEventHandler,
  ): () => void {
    const handlers = eventType === "*"
      ? this.#allHandlers
      : this.#handlersByType.get(eventType) ?? new Set<DomainEventHandler>();
    if (eventType !== "*") this.#handlersByType.set(eventType, handlers);
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
      if (eventType !== "*" && handlers.size === 0) {
        this.#handlersByType.delete(eventType);
      }
    };
  }

  publish(event: DomainEvent): DomainEventPublishReport {
    return this.publishAll([event]);
  }

  validate(events: readonly DomainEvent[]): void {
    for (const event of events) this.#validate(event);
  }

  publishAll(events: readonly DomainEvent[]): DomainEventPublishReport {
    this.validate(events);
    const publishedEventIds: string[] = [];
    const duplicateEventIds: string[] = [];
    let subscriberErrorCount = 0;
    for (const event of events) {
      if (this.#processedEventIds.has(event.id)) {
        duplicateEventIds.push(event.id);
        continue;
      }
      this.#remember(event.id);
      publishedEventIds.push(event.id);
      const handlers = [
        ...(this.#handlersByType.get(event.type) ?? []),
        ...this.#allHandlers,
      ];
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (error: unknown) {
          subscriberErrorCount += 1;
          this.#onSubscriberError?.({ event, error });
        }
      }
    }
    return Object.freeze({
      publishedEventIds: Object.freeze(publishedEventIds),
      duplicateEventIds: Object.freeze(duplicateEventIds),
      subscriberErrorCount,
    });
  }

  #remember(eventId: string): void {
    this.#processedEventIds.add(eventId);
    this.#eventHistory.push(eventId);
    if (this.#eventHistory.length <= this.#eventHistoryLimit) return;
    const oldest = this.#eventHistory.shift();
    if (oldest !== undefined) this.#processedEventIds.delete(oldest);
  }

  #validate(event: DomainEvent): void {
    if (event.id.length === 0 || event.type.length === 0) {
      throw new Error("Domain event id and type must not be empty.");
    }
    if (!Number.isSafeInteger(event.occurredAtUtcMs) || event.occurredAtUtcMs < 0) {
      throw new RangeError("Domain event time must be a non-negative integer.");
    }
  }
}
