declare const contentIdBrand: unique symbol;
declare const instanceIdBrand: unique symbol;
declare const subresourceIdBrand: unique symbol;

export type ContentId = string & { readonly [contentIdBrand]: true };
export type InstanceId = string & { readonly [instanceIdBrand]: true };
export type SubresourceId = string & { readonly [subresourceIdBrand]: true };

export type StableId = ContentId | InstanceId | SubresourceId;

const CONTENT_ID_PATTERN = /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/;
const INSTANCE_ID_PATTERN = /^instance\.[a-z][a-z0-9_-]*\.[a-z0-9][a-z0-9_-]*$/;
const SUBRESOURCE_ID_PATTERN = /^subresource\.[a-z0-9_-]+\.[a-z][a-z0-9_-]*$/;

function assertMatches(value: string, pattern: RegExp, label: string): void {
  if (!pattern.test(value)) {
    throw new TypeError(`${label} is invalid: ${value}`);
  }
}

export function isContentId(value: unknown): value is ContentId {
  return typeof value === "string" &&
    CONTENT_ID_PATTERN.test(value) &&
    !value.startsWith("instance.") &&
    !value.startsWith("subresource.");
}

export function contentId(value: string): ContentId {
  if (!isContentId(value)) {
    throw new TypeError(`Content id is invalid: ${value}`);
  }
  return value;
}

export function isInstanceId(value: unknown): value is InstanceId {
  return typeof value === "string" && INSTANCE_ID_PATTERN.test(value);
}

export function instanceId(value: string): InstanceId {
  assertMatches(value, INSTANCE_ID_PATTERN, "Instance id");
  return value as InstanceId;
}

export function isSubresourceId(value: unknown): value is SubresourceId {
  return typeof value === "string" && SUBRESOURCE_ID_PATTERN.test(value);
}

export function subresourceId(value: string): SubresourceId {
  assertMatches(value, SUBRESOURCE_ID_PATTERN, "Subresource id");
  return value as SubresourceId;
}

export interface InstanceIdGenerator {
  next(kind: string): InstanceId;
}

function normalizeSegment(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(normalized)) {
    throw new TypeError(`${label} must be a stable lowercase identifier segment.`);
  }
  return normalized;
}

export interface SequentialInstanceIdGeneratorState {
  readonly version: 1;
  readonly namespace: string;
  readonly nextSequence: number;
}

export class SequentialInstanceIdGenerator implements InstanceIdGenerator {
  readonly #namespace: string;
  #nextSequence: number;

  constructor(namespace = "runtime", firstSequence = 1) {
    this.#namespace = normalizeSegment(namespace, "Instance id namespace");
    if (!Number.isSafeInteger(firstSequence) || firstSequence < 1) {
      throw new RangeError("First instance sequence must be a positive integer.");
    }
    this.#nextSequence = firstSequence;
  }

  next(kind: string): InstanceId {
    const normalizedKind = normalizeSegment(kind, "Instance kind");
    const sequence = this.#nextSequence;
    this.#nextSequence += 1;
    return instanceId(`instance.${normalizedKind}.${this.#namespace}_${sequence.toString(36)}`);
  }
  exportState(): SequentialInstanceIdGeneratorState {
    return Object.freeze({
      version: 1,
      namespace: this.#namespace,
      nextSequence: this.#nextSequence,
    });
  }

  static fromState(state: SequentialInstanceIdGeneratorState): SequentialInstanceIdGenerator {
    if (state.version !== 1) {
      throw new RangeError("Unsupported instance id generator state version.");
    }
    return new SequentialInstanceIdGenerator(state.namespace, state.nextSequence);
  }
}

export function createSubresourceId(
  ownerId: InstanceId,
  slotId: string,
): SubresourceId {
  const normalizedSlot = normalizeSegment(slotId, "Subresource slot");
  const ownerToken = ownerId.slice("instance.".length).replaceAll(".", "_");
  return subresourceId(`subresource.${ownerToken}.${normalizedSlot}`);
}