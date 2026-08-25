import { describe, expect, it } from "vitest";
import { isManagementOpenRequest } from "../src/index";

describe("management navigation request", () => {
  it.each([
    "overview",
    "inventory",
    "recipes",
    "procurement",
    "finance",
    "instance-upgrades",
    "technology",
    "staff",
    "roster",
  ])("accepts the %s section", (section) => {
    expect(isManagementOpenRequest({ section })).toBe(true);
  });

  it("rejects missing, unknown, and primitive payloads", () => {
    expect(isManagementOpenRequest({})).toBe(false);
    expect(isManagementOpenRequest({ section: "settings" })).toBe(false);
    expect(isManagementOpenRequest("inventory")).toBe(false);
    expect(isManagementOpenRequest(null)).toBe(false);
  });
});
