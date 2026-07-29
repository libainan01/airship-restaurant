export interface ContentRecord {
  readonly id: string;
}

export function indexContent<T extends ContentRecord>(
  records: readonly T[],
): ReadonlyMap<string, T> {
  const index = new Map<string, T>();

  for (const record of records) {
    if (index.has(record.id)) {
      throw new Error(`Duplicate content id: ${record.id}`);
    }

    index.set(record.id, record);
  }

  return index;
}
