export interface ReadModelSlice<TValue> {
  readonly key: string;
  readonly revision: number;
  readonly value: TValue;
}

export type ReadModelListener<TValue> = (slice: ReadModelSlice<TValue>) => void;

export interface ReadModelSubscriptionOptions {
  readonly emitCurrent?: boolean;
}

interface MutableReadModelEntry {
  revision: number;
  value: unknown;
  readonly listeners: Set<ReadModelListener<unknown>>;
}

export class ReadModelRegistry {
  readonly #entries = new Map<string, MutableReadModelEntry>();

  register<TValue>(key: string, initialValue: TValue): () => void {
    if (key.length === 0) throw new Error("Read model key must not be empty.");
    if (this.#entries.has(key)) {
      throw new Error(`Read model already registered: ${key}`);
    }
    const entry: MutableReadModelEntry = {
      revision: 0,
      value: initialValue,
      listeners: new Set(),
    };
    this.#entries.set(key, entry);
    return () => {
      if (entry.listeners.size > 0) {
        throw new Error(`Cannot unregister subscribed read model: ${key}`);
      }
      if (this.#entries.get(key) === entry) this.#entries.delete(key);
    };
  }

  get<TValue>(key: string): ReadModelSlice<TValue> {
    return this.#snapshot<TValue>(key, this.#requireEntry(key));
  }

  publish<TValue>(key: string, value: TValue): ReadModelSlice<TValue> {
    const entry = this.#requireEntry(key);
    entry.value = value;
    entry.revision += 1;
    const snapshot = this.#snapshot<TValue>(key, entry);
    for (const listener of entry.listeners) {
      listener(snapshot as ReadModelSlice<unknown>);
    }
    return snapshot;
  }

  subscribe<TValue>(
    key: string,
    listener: ReadModelListener<TValue>,
    options: ReadModelSubscriptionOptions = {},
  ): () => void {
    const entry = this.#requireEntry(key);
    const untypedListener = listener as ReadModelListener<unknown>;
    entry.listeners.add(untypedListener);
    if (options.emitCurrent === true) listener(this.#snapshot(key, entry));
    return () => entry.listeners.delete(untypedListener);
  }

  listKeys(): readonly string[] {
    return Object.freeze([...this.#entries.keys()].sort());
  }

  #requireEntry(key: string): MutableReadModelEntry {
    const entry = this.#entries.get(key);
    if (entry === undefined) throw new Error(`Unknown read model: ${key}`);
    return entry;
  }

  #snapshot<TValue>(key: string, entry: MutableReadModelEntry): ReadModelSlice<TValue> {
    return Object.freeze({
      key,
      revision: entry.revision,
      value: entry.value as TValue,
    });
  }
}
