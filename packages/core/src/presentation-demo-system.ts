import type { AmbientDialogueActiveSnapshot } from "@airship-restaurant/contracts";

export type PresentationDemoScenario =
  | "guest-flow"
  | "delivery"
  | "reunion-dialogue"
  | "otto-listening"
  | "layout";

export interface PresentationDemoSnapshot {
  readonly revision: number;
  readonly scenario: PresentationDemoScenario | null;
  readonly active: AmbientDialogueActiveSnapshot | null;
  readonly deliveryRevision: number;
  readonly guestFlowRevision: number;
  readonly showLayoutAnchors: boolean;
  readonly nextTransitionUtcMs: number | null;
}

export interface PresentationDemoDialogueConfig {
  readonly dialogueId: string;
  readonly lineDurationsMs: readonly number[];
}

export interface PresentationDemoConfig {
  readonly dialogues: Readonly<Partial<Record<PresentationDemoScenario, PresentationDemoDialogueConfig>>>;
}

export interface PresentationDemoActionResult {
  readonly accepted: boolean;
  readonly changed: boolean;
  readonly message: string;
  readonly snapshot: PresentationDemoSnapshot;
}

export interface PresentationDemoAdvanceResult {
  readonly changed: boolean;
  readonly snapshot: PresentationDemoSnapshot;
}

interface ActiveDemoDialogue {
  dialogueId: string;
  lineIndex: number;
  startedAtUtcMs: number;
  endsAtUtcMs: number;
}

export class PresentationDemoSystem {
  readonly #config: PresentationDemoConfig;
  #revision = 0;
  #scenario: PresentationDemoScenario | null = null;
  #active: ActiveDemoDialogue | null = null;
  #deliveryRevision = 0;
  #guestFlowRevision = 0;

  constructor(config: PresentationDemoConfig) {
    this.#config = config;
  }

  getSnapshot(): PresentationDemoSnapshot {
    return Object.freeze({
      revision: this.#revision,
      scenario: this.#scenario,
      active: this.#active === null ? null : Object.freeze({ ...this.#active }),
      deliveryRevision: this.#deliveryRevision,
      guestFlowRevision: this.#guestFlowRevision,
      showLayoutAnchors: this.#scenario === "layout",
      nextTransitionUtcMs: this.#active?.endsAtUtcMs ?? null,
    });
  }

  start(scenario: PresentationDemoScenario, atUtcMs: number): PresentationDemoActionResult {
    this.#scenario = scenario;
    this.#active = null;
    if (scenario === "delivery") this.#deliveryRevision += 1;
    if (scenario === "guest-flow") this.#guestFlowRevision += 1;
    const dialogue = this.#config.dialogues[scenario];
    if (dialogue !== undefined && dialogue.lineDurationsMs.length > 0) {
      this.#active = {
        dialogueId: dialogue.dialogueId,
        lineIndex: 0,
        startedAtUtcMs: atUtcMs,
        endsAtUtcMs: atUtcMs + (dialogue.lineDurationsMs[0] ?? 1),
      };
    }
    this.#revision += 1;
    return this.#action(true, true, "Presentation demo started.");
  }

  stop(): PresentationDemoActionResult {
    if (this.#scenario === null && this.#active === null) return this.#action(true, false, "Presentation demo is already stopped.");
    this.#scenario = null;
    this.#active = null;
    this.#revision += 1;
    return this.#action(true, true, "Presentation demo stopped.");
  }

  advanceTo(atUtcMs: number): PresentationDemoAdvanceResult {
    if (this.#active === null || atUtcMs < this.#active.endsAtUtcMs) return Object.freeze({ changed: false, snapshot: this.getSnapshot() });
    const dialogue = this.#config.dialogues[this.#scenario ?? "layout"];
    if (dialogue === undefined || this.#active.lineIndex + 1 >= dialogue.lineDurationsMs.length) {
      this.#active = null;
    } else {
      const lineIndex = this.#active.lineIndex + 1;
      this.#active = {
        dialogueId: dialogue.dialogueId,
        lineIndex,
        startedAtUtcMs: atUtcMs,
        endsAtUtcMs: atUtcMs + (dialogue.lineDurationsMs[lineIndex] ?? 1),
      };
    }
    this.#revision += 1;
    return Object.freeze({ changed: true, snapshot: this.getSnapshot() });
  }

  #action(accepted: boolean, changed: boolean, message: string): PresentationDemoActionResult {
    return Object.freeze({ accepted, changed, message, snapshot: this.getSnapshot() });
  }
}