import type {
  GameplaySnapshot,
  InventoryReadModel,
  InventoryReadModelLocation,
} from "@airship-restaurant/contracts";
import type Phaser from "phaser";

export type KitchenPhase = "idle" | "cooking" | "waiting-output" | "blocked";
export type KitchenTask =
  | "idle" | "reading-order" | "preparing" | "stirring"
  | "checking-pantry" | "checking-output";

export interface KitchenNotification {
  readonly phase: "sending" | "received";
}
export interface KitchenPresentation {
  readonly phase: KitchenPhase;
  readonly task: KitchenTask;
  readonly progress: number;
  readonly ingredients: readonly [number, number];
  readonly output: readonly [number, number];
  readonly signal: "sending" | "received" | null;
  readonly blocked: "insufficient-ingredients" | "output-capacity" | null;
}
export interface KitchenBounds {
  readonly x: number; readonly y: number;
  readonly width: number; readonly height: number;
}
export interface KitchenPalette {
  readonly ink: number; readonly creamLight: number;
  readonly brass: number; readonly brassLight: number;
  readonly copperLight: number; readonly wood: number;
  readonly woodDark: number; readonly teal: number;
  readonly tealLight: number; readonly smoke: number; readonly glow: number;
}
export interface KitchenAnimation {
  readonly timeMs: number; readonly motionScale: number;
  readonly quietMode: boolean;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function resolveKitchenPresentation(
  gameplay: GameplaySnapshot | null,
  notification: KitchenNotification | null,
  inventory: InventoryReadModel | null,
): KitchenPresentation {
  const cooking = gameplay?.cooking;
  const job = cooking?.activeJob ?? null;
  const blocked = cooking?.blockedReason ?? null;
  const phase: KitchenPhase =
    job?.status === "cooking" ? "cooking"
      : job?.status === "waiting-output" ? "waiting-output"
        : blocked === null ? "idle" : "blocked";
  const duration = job === null
    ? 1
    : Math.max(1, job.finishAtUtcMs - job.startedAtUtcMs);
  const progress =
    job?.status === "waiting-output" ? 1
      : job?.status === "cooking" && gameplay !== null
        ? clamp01((gameplay.currentUtcMs - job.startedAtUtcMs) / duration)
        : 0;
  const task: KitchenTask =
    phase === "cooking" ? progress < 0.22 ? "preparing" : "stirring"
      : phase === "waiting-output" || blocked === "output-capacity"
        ? "checking-output"
        : blocked === "insufficient-ingredients" ? "checking-pantry"
          : notification?.phase === "received" ? "reading-order" : "idle";
  const locationValues = (
    location: InventoryReadModelLocation | undefined,
  ): readonly [number, number] => Object.freeze([
    location?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0,
    location?.compartments.reduce(
      (sum, compartment) => sum + compartment.capacity,
      0,
    ) ?? 1,
  ] as const);
  const ingredients = inventory?.locations.find(
    (location) => location.id === "kitchen.ingredients",
  );
  const output = inventory?.locations.find(
    (location) => location.id === "kitchen.output",
  );
  return Object.freeze({
    phase, task, progress,
    ingredients: locationValues(ingredients),
    output: locationValues(output),
    signal: notification?.phase ?? null,
    blocked,
  });
}

export class AirshipKitchenRenderer {
  readonly #p: KitchenPalette;
  constructor(palette: KitchenPalette) { this.#p = palette; }

  draw(
    g: Phaser.GameObjects.Graphics,
    b: KitchenBounds,
    state: KitchenPresentation,
    animation: KitchenAnimation,
  ): void {
    const u = Math.max(0.72, b.height / 54);
    const pantry = this.#part(b, 0.02, 0.13, 0.17, 0.7);
    const prep = this.#part(b, 0.22, 0.42, 0.23, 0.42);
    const stove = this.#part(b, 0.51, 0.43, 0.2, 0.41);
    const output = this.#part(b, 0.77, 0.14, 0.19, 0.69);
    for (const part of [pantry, prep, stove, output]) {
      g.fillStyle(this.#p.woodDark, 0.18);
      g.fillRoundedRect(part.x, part.y, part.width, part.height, 4 * u);
      g.lineStyle(u, this.#p.brass, 0.48);
      g.strokeRoundedRect(part.x, part.y, part.width, part.height, 4 * u);
    }
    this.#drawStorage(g, pantry, state.ingredients, state.blocked === "insufficient-ingredients", animation, u, false);
    this.#drawPrep(g, prep, state, animation, u);
    this.#drawStove(g, stove, state, animation, u);
    this.#drawStorage(g, output, state.output, state.blocked === "output-capacity" || state.phase === "waiting-output", animation, u, true);
    this.#drawReceiver(g, b, state, animation, u);
    this.#drawChef(g, b, state, animation, u);
  }

  #part(b: KitchenBounds, x: number, y: number, w: number, h: number): KitchenBounds {
    return { x: b.x + b.width * x, y: b.y + b.height * y, width: b.width * w, height: b.height * h };
  }

  #drawStorage(
    g: Phaser.GameObjects.Graphics, b: KitchenBounds,
    values: readonly [number, number], warning: boolean,
    animation: KitchenAnimation, u: number, dishes: boolean,
  ): void {
    const ratio = clamp01(values[0] / Math.max(1, values[1]));
    g.fillStyle(this.#p.wood, dishes ? 0.35 : 0.96);
    g.fillRoundedRect(b.x + 3 * u, b.y + 3 * u, b.width - 6 * u, b.height - 6 * u, 2 * u);
    g.lineStyle(u, this.#p.brassLight, 0.8);
    g.lineBetween(b.x + 4 * u, b.y + b.height / 2, b.x + b.width - 4 * u, b.y + b.height / 2);
    const count = Math.ceil(ratio * (dishes ? 6 : 4));
    for (let i = 0; i < count; i += 1) {
      const px = b.x + b.width * (0.2 + (i % 2) * 0.36);
      const py = b.y + b.height * (0.18 + Math.floor(i / 2) * (dishes ? 0.28 : 0.42));
      if (dishes) {
        g.fillStyle(this.#p.creamLight, 0.96);
        g.fillEllipse(px, py, 9 * u, 3 * u);
        g.fillStyle(this.#p.copperLight, 0.9);
        g.fillCircle(px, py - u, 1.7 * u);
      } else {
        g.fillStyle(this.#p.copperLight, 0.92);
        g.fillRoundedRect(px, py, b.width * 0.28, b.height * 0.2, u);
      }
    }
    const pulse = warning ? 0.58 + Math.sin(animation.timeMs * 0.012) * 0.3 : 0.8;
    g.fillStyle(warning ? this.#p.glow : this.#p.tealLight, pulse);
    g.fillCircle(b.x + b.width - 5 * u, b.y + 5 * u, 2 * u);
  }

  #drawPrep(
    g: Phaser.GameObjects.Graphics, b: KitchenBounds,
    state: KitchenPresentation, animation: KitchenAnimation, u: number,
  ): void {
    g.fillStyle(this.#p.woodDark, 1);
    g.fillRoundedRect(b.x, b.y + b.height * 0.5, b.width, b.height * 0.42, 2 * u);
    g.fillStyle(this.#p.creamLight, 0.94);
    g.fillRoundedRect(b.x + 2 * u, b.y + b.height * 0.42, b.width - 4 * u, 4 * u, 2 * u);
    g.fillStyle(this.#p.brassLight, 0.88);
    g.fillEllipse(b.x + b.width / 2, b.y + b.height * 0.34, b.width * 0.42, 5 * u);
    const chop = state.task === "preparing"
      ? Math.abs(Math.sin(animation.timeMs * 0.014 * animation.motionScale)) : 0;
    g.lineStyle(1.6 * u, this.#p.ink, 0.85);
    g.lineBetween(b.x + b.width * 0.35, b.y + b.height * (0.2 - chop * 0.08), b.x + b.width * 0.61, b.y + b.height * 0.35);
  }

  #drawStove(
    g: Phaser.GameObjects.Graphics, b: KitchenBounds,
    state: KitchenPresentation, animation: KitchenAnimation, u: number,
  ): void {
    const active = state.phase === "cooking";
    g.fillStyle(this.#p.woodDark, 1);
    g.fillRoundedRect(b.x, b.y + b.height * 0.38, b.width, b.height * 0.54, 3 * u);
    g.fillStyle(this.#p.glow, active ? 0.66 + Math.sin(animation.timeMs * 0.012) * 0.18 : 0.13);
    g.fillRoundedRect(b.x + b.width * 0.18, b.y + b.height * 0.61, b.width * 0.64, 4 * u, 2 * u);
    const potY = b.y + b.height * 0.24;
    g.fillStyle(this.#p.ink, 0.96);
    g.fillEllipse(b.x + b.width / 2, potY, b.width * 0.72, 7 * u);
    if (active) {
      for (let i = 0; i < (animation.quietMode ? 1 : 3); i += 1) {
        const phase = (animation.timeMs * 0.018 * animation.motionScale + i * 23) % 44;
        g.fillStyle(this.#p.smoke, Math.max(0, 0.5 * (1 - phase / 44)));
        g.fillCircle(b.x + b.width * (0.38 + i * 0.12), potY - 5 * u - phase * u * 0.38, (2.3 + phase * 0.035) * u);
      }
    }
    g.fillStyle(this.#p.brassLight, 0.9);
    g.fillRect(b.x, b.y + b.height - 2.5 * u, b.width * state.progress, 2 * u);
  }

  #drawReceiver(
    g: Phaser.GameObjects.Graphics, b: KitchenBounds,
    state: KitchenPresentation, animation: KitchenAnimation, u: number,
  ): void {
    const x = b.x + b.width * 0.2;
    const y = b.y + b.height * 0.11;
    g.fillStyle(this.#p.teal, 0.96);
    g.fillRoundedRect(x - 6 * u, y - 4 * u, 12 * u, 8 * u, 2 * u);
    g.lineStyle(u, this.#p.brassLight, 0.9);
    g.lineBetween(x, y - 4 * u, x, y - 10 * u);
    if (state.signal === null) return;
    const pulse = 0.5 + Math.sin(animation.timeMs * 0.014) * 0.28;
    const color = state.signal === "sending" ? this.#p.copperLight : this.#p.glow;
    g.lineStyle(1.2 * u, color, pulse);
    g.fillStyle(color, pulse);
    g.fillCircle(x, y, 2.2 * u);
    g.strokeCircle(x, y, 7 * u);
    g.strokeCircle(x, y, 12 * u);
  }

  #drawChef(
    g: Phaser.GameObjects.Graphics, b: KitchenBounds,
    state: KitchenPresentation, animation: KitchenAnimation, u: number,
  ): void {
    const targets: Record<KitchenTask, number> = {
      idle: 0.46, "reading-order": 0.27, preparing: 0.43,
      stirring: 0.61, "checking-pantry": 0.2, "checking-output": 0.76,
    };
    const x = b.x + b.width * targets[state.task];
    const y = b.y + b.height * 0.58;
    const working = state.task !== "idle";
    const bob = Math.sin(animation.timeMs * (working ? 0.008 : 0.002) * animation.motionScale) * u;
    g.fillStyle(this.#p.creamLight, 1);
    g.fillCircle(x, y - 8 * u + bob, 5 * u);
    g.fillRoundedRect(x - 6 * u, y - 15 * u + bob, 12 * u, 5 * u, 2 * u);
    g.fillStyle(this.#p.teal, 1);
    g.fillRoundedRect(x - 5 * u, y - 2 * u + bob, 10 * u, 13 * u, 3 * u);
    const direction = state.task === "checking-pantry" || state.task === "reading-order" ? -1 : 1;
    const swing = working ? Math.sin(animation.timeMs * 0.016 * animation.motionScale) * 2 * u : 0;
    g.lineStyle(1.8 * u, this.#p.creamLight, 1);
    g.lineBetween(x + direction * 2 * u, y + 2 * u + bob, x + direction * 10 * u, y + 7 * u + bob + swing);
  }
}
