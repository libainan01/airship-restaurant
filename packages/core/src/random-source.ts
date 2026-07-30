export interface RandomSource {
  nextFloat(): number;
}

export class SeededRandom implements RandomSource {
  #state: number;

  constructor(seed: number) {
    if (
      !Number.isSafeInteger(seed) ||
      seed < 0 ||
      seed > 0xffff_ffff
    ) {
      throw new RangeError(
        "Random seed must be an unsigned 32-bit integer.",
      );
    }
    this.#state = seed >>> 0;
  }

  getState(): number {
    return this.#state;
  }

  nextFloat(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let value = this.#state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }
}
