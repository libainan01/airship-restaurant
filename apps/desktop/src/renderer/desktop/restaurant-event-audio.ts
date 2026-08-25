import type { GameplayRestaurantEventSnapshot } from "@airship-restaurant/contracts";

export type RestaurantAudioCue =
  | "arrival"
  | "order"
  | "kitchen"
  | "served"
  | "departure"
  | "procurement";

export interface RestaurantAudioPort {
  unlock(): Promise<void>;
  play(cue: RestaurantAudioCue): void;
  destroy(): void;
}

export class DesktopRestaurantAudioFeedback {
  readonly #audio: RestaurantAudioPort;
  readonly #seenEventIds = new Set<string>();
  readonly #eventHistory: string[] = [];
  #initialized = false;

  constructor(audio: RestaurantAudioPort = new BrowserRestaurantAudioPort()) {
    this.#audio = audio;
  }

  unlock(): Promise<void> {
    return this.#audio.unlock();
  }

  observe(
    events: readonly GameplayRestaurantEventSnapshot[],
    options: { readonly quiet: boolean; readonly procurementArrived: boolean },
  ): void {
    const newEvents = events.filter((event) => !this.#seenEventIds.has(event.id));
    for (const event of newEvents) this.#remember(event.id);
    if (!this.#initialized) {
      this.#initialized = true;
      return;
    }
    if (options.quiet) return;
    const cues = new Set<RestaurantAudioCue>(newEvents.map((event) => cueForEvent(event.type)));
    if (options.procurementArrived) cues.add("procurement");
    for (const cue of cues) this.#audio.play(cue);
  }

  destroy(): void {
    this.#audio.destroy();
    this.#seenEventIds.clear();
    this.#eventHistory.splice(0);
  }

  #remember(eventId: string): void {
    this.#seenEventIds.add(eventId);
    this.#eventHistory.push(eventId);
    if (this.#eventHistory.length <= 256) return;
    const removed = this.#eventHistory.shift();
    if (removed !== undefined) this.#seenEventIds.delete(removed);
  }
}

function cueForEvent(type: GameplayRestaurantEventSnapshot["type"]): RestaurantAudioCue {
  switch (type) {
    case "customer.arrived":
      return "arrival";
    case "order.requested":
    case "order.confirmation-started":
    case "order.confirmed":
      return "order";
    case "kitchen.notification-sent":
    case "kitchen.order-received":
      return "kitchen";
    case "order.fulfilled":
    case "customer.dining-completed":
      return "served";
    case "customer.left":
      return "departure";
  }
}

class BrowserRestaurantAudioPort implements RestaurantAudioPort {
  #context: AudioContext | null = null;
  #unlocked = false;

  async unlock(): Promise<void> {
    if (this.#context === null) this.#context = new AudioContext();
    if (this.#context.state === "suspended") await this.#context.resume();
    this.#unlocked = this.#context.state === "running";
  }

  play(cue: RestaurantAudioCue): void {
    if (!this.#unlocked || this.#context === null) return;
    const tones = TONES[cue];
    const startedAt = this.#context.currentTime;
    tones.forEach((tone, index) => {
      const oscillator = this.#context!.createOscillator();
      const gain = this.#context!.createGain();
      const beginsAt = startedAt + index * 0.055;
      oscillator.type = tone.wave;
      oscillator.frequency.setValueAtTime(tone.frequency, beginsAt);
      gain.gain.setValueAtTime(0.0001, beginsAt);
      gain.gain.exponentialRampToValueAtTime(tone.volume, beginsAt + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, beginsAt + tone.duration);
      oscillator.connect(gain);
      gain.connect(this.#context!.destination);
      oscillator.start(beginsAt);
      oscillator.stop(beginsAt + tone.duration + 0.01);
    });
  }

  destroy(): void {
    this.#unlocked = false;
    const context = this.#context;
    this.#context = null;
    if (context !== null) void context.close();
  }
}

interface Tone {
  readonly frequency: number;
  readonly duration: number;
  readonly volume: number;
  readonly wave: OscillatorType;
}

const TONES: Readonly<Record<RestaurantAudioCue, readonly Tone[]>> = Object.freeze({
  arrival: Object.freeze([
    { frequency: 660, duration: 0.11, volume: 0.018, wave: "sine" as OscillatorType },
    { frequency: 880, duration: 0.16, volume: 0.016, wave: "sine" as OscillatorType },
  ]),
  order: Object.freeze([
    { frequency: 520, duration: 0.09, volume: 0.014, wave: "triangle" as OscillatorType },
  ]),
  kitchen: Object.freeze([
    { frequency: 740, duration: 0.08, volume: 0.014, wave: "square" as OscillatorType },
    { frequency: 988, duration: 0.10, volume: 0.010, wave: "square" as OscillatorType },
  ]),
  served: Object.freeze([
    { frequency: 523, duration: 0.12, volume: 0.016, wave: "sine" as OscillatorType },
    { frequency: 659, duration: 0.12, volume: 0.015, wave: "sine" as OscillatorType },
    { frequency: 784, duration: 0.18, volume: 0.014, wave: "sine" as OscillatorType },
  ]),
  departure: Object.freeze([
    { frequency: 440, duration: 0.12, volume: 0.010, wave: "triangle" as OscillatorType },
  ]),
  procurement: Object.freeze([
    { frequency: 392, duration: 0.10, volume: 0.016, wave: "triangle" as OscillatorType },
    { frequency: 523, duration: 0.14, volume: 0.014, wave: "triangle" as OscillatorType },
  ]),
});
