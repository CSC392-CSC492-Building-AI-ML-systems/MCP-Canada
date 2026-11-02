// Temporary smoke test so CI has a frontend test to run. Delete once real tests exist.
import { describe, expect, it } from "vitest";

describe("test setup", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
