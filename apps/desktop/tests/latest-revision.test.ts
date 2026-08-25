import { describe, expect, it } from "vitest";
import {
  selectLatestRevision,
  shouldAcceptRevision,
} from "../src/renderer/shared/latest-revision";

describe("latest revision selection", () => {
  it("accepts initial, equal, and newer revisions", () => {
    expect(shouldAcceptRevision(null, 3)).toBe(true);
    expect(shouldAcceptRevision(3, 3)).toBe(true);
    expect(shouldAcceptRevision(3, 4)).toBe(true);
  });

  it("rejects an older asynchronous result", () => {
    expect(shouldAcceptRevision(4, 3)).toBe(false);
    const current = { revision: 4, value: "subscription" };
    const stale = { revision: 3, value: "hydration" };
    expect(selectLatestRevision(current, stale)).toBe(current);
  });

  it("replaces the current value when revisions are equal", () => {
    const current = { revision: 4, value: "old-instance" };
    const next = { revision: 4, value: "new-instance" };
    expect(selectLatestRevision(current, next)).toBe(next);
  });
});
