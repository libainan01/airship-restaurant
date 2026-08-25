export interface RevisionedValue {
  readonly revision: number;
}

export function shouldAcceptRevision(
  currentRevision: number | null,
  nextRevision: number,
): boolean {
  return currentRevision === null || nextRevision >= currentRevision;
}

export function selectLatestRevision<T extends RevisionedValue>(
  current: T | null,
  next: T,
): T {
  if (current === null || next.revision >= current.revision) {
    return next;
  }
  return current;
}
