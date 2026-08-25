import type { GameCommand } from "@airship-restaurant/contracts";
import type {
  RuntimeCommandExtensionPort,
  RuntimeCommandExtensionResult,
} from "./instance-upgrade-runtime";

export class RuntimeCommandExtensionChain implements RuntimeCommandExtensionPort {
  readonly #extensions: readonly RuntimeCommandExtensionPort[];

  constructor(extensions: readonly RuntimeCommandExtensionPort[]) {
    this.#extensions = Object.freeze([...extensions]);
  }

  dispatch(command: GameCommand): RuntimeCommandExtensionResult {
    for (const extension of this.#extensions) {
      const result = extension.dispatch(command);
      if (result.handled) return result;
    }
    return Object.freeze({ handled: false });
  }
}