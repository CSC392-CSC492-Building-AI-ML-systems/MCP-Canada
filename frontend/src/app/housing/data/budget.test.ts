/**
 * Tests for the monthly rent budget estimate (budget.ts).
 *
 * Grouped the way the project plan's testing framework (Section 7, Layer 1) asks for:
 * normal, boundary and missing-data cases, plus input validation.
 */
import { describe, expect, it } from "vitest";
import { calculateMonthlyRentBudget } from "./budget";

describe("calculateMonthlyRentBudget", () => {
  describe("normal cases", () => {
    it("calculates a monthly amount from annual income and a chosen percentage", () => {
      expect(calculateMonthlyRentBudget("72000", "30")).toBe(1800);
      expect(calculateMonthlyRentBudget("72000", "25")).toBe(1500);
    });
  });

  describe("boundary cases", () => {
    it("allows a zero-percent rent target", () => {
      expect(calculateMonthlyRentBudget("72000", "0")).toBe(0);
    });

    it("supports decimal and boundary values without inventing a rent target", () => {
      expect(calculateMonthlyRentBudget("85000", "35.5")).toBeCloseTo(2514.58, 2);
      expect(calculateMonthlyRentBudget("75000", "100")).toBe(6250);
      expect(calculateMonthlyRentBudget("75000", "-1")).toBeNull();
    });
  });

  describe("missing data and input validation", () => {
    it.each(["", "-1", "100.1", "NaN"])(
      "returns no estimate for an invalid rent percentage (%s)",
      (share) => {
        expect(calculateMonthlyRentBudget("72000", share)).toBeNull();
      },
    );

    it("returns no estimate until a positive annual income is entered", () => {
      expect(calculateMonthlyRentBudget("", "30")).toBeNull();
      expect(calculateMonthlyRentBudget("0", "30")).toBeNull();
      expect(calculateMonthlyRentBudget("not a number", "30")).toBeNull();
    });
  });
});
