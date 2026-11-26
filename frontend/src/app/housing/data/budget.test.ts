/**
 * Tests for the monthly rent budget estimate (budget.ts).
 *
 * Grouped the way the project plan's testing framework (Section 7, Layer 1) asks for:
 * normal, boundary and missing-data cases, plus input validation.
 */
import { describe, expect, it } from "vitest";
import { calculateMonthlyRentBudget } from "./budget";
import { affordability } from "@/components/explorer/affordability";

describe("calculateMonthlyRentBudget", () => {
  describe("normal cases", () => {
    it("calculates a monthly amount from annual income and a chosen percentage", () => {
      expect(calculateMonthlyRentBudget("72000", "30")).toBe(1800);
      expect(calculateMonthlyRentBudget("72000", "25")).toBe(1500);
    });

    it.each([
      ["60000", "30", 1500],
      ["120000", "30", 3000],
      ["48000", "25", 1000],
      ["36000", "50", 1500],
      ["100000", "35", 2916.67],
    ])("an annual income of %s at %s%% gives %s a month", (income, share, monthly) => {
      expect(calculateMonthlyRentBudget(income, share)).toBeCloseTo(monthly, 2);
    });

    it("gives a higher budget for a higher income at the same percentage", () => {
      expect(calculateMonthlyRentBudget("90000", "30")!).toBeGreaterThan(calculateMonthlyRentBudget("60000", "30")!);
    });

    it("gives a higher budget for a higher percentage on the same income", () => {
      expect(calculateMonthlyRentBudget("72000", "35")!).toBeGreaterThan(calculateMonthlyRentBudget("72000", "30")!);
    });

    it("matches the 30% monthly guideline used by the affordability check", () => {
      for (const income of ["36000", "72000", "96000", "150000"]) {
        expect(calculateMonthlyRentBudget(income, "30")).toBeCloseTo(affordability(null, income, "").monthlyLimit!, 6);
      }
    });

    it("never gives a negative budget for valid inputs", () => {
      for (const income of ["1", "50000", "250000"]) {
        for (const share of ["0", "15", "30", "100"]) {
          expect(calculateMonthlyRentBudget(income, share)!).toBeGreaterThanOrEqual(0);
        }
      }
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

    it("100% of income is the whole monthly income", () => {
      expect(calculateMonthlyRentBudget("60000", "100")).toBe(5000);
    });

    it.each([
      ["99.99", 5999.4],
      ["0.01", 0.6],
    ])("accepts a percentage of %s just inside the 0 to 100 range", (share, monthly) => {
      expect(calculateMonthlyRentBudget("72000", share)).toBeCloseTo(monthly, 2);
    });

    it("rejects a percentage just over 100", () => {
      expect(calculateMonthlyRentBudget("72000", "100.0001")).toBeNull();
    });

    it("the smallest positive income still gives a budget", () => {
      expect(calculateMonthlyRentBudget("1", "30")).toBeCloseTo(0.025, 5);
      expect(calculateMonthlyRentBudget("0.01", "30")).toBeGreaterThan(0);
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

    it("treats an income or percentage of only spaces as missing", () => {
      expect(calculateMonthlyRentBudget("   ", "30")).toBeNull();
      expect(calculateMonthlyRentBudget("72000", "   ")).toBeNull();
    });

    it("returns no estimate when both inputs are blank", () => {
      expect(calculateMonthlyRentBudget("", "")).toBeNull();
    });

    it("accepts numbers with spaces around them", () => {
      expect(calculateMonthlyRentBudget(" 72000 ", " 30 ")).toBe(1800);
    });

    it.each(["-72000", "Infinity", "-Infinity", "72,000", "$72000"])(
      "returns no estimate for the income %s",
      (income) => {
        expect(calculateMonthlyRentBudget(income, "30")).toBeNull();
      },
    );

    it.each(["Infinity", "-Infinity", "30%", "thirty", "-0.01"])(
      "returns no estimate for the percentage %s",
      (share) => {
        expect(calculateMonthlyRentBudget("72000", share)).toBeNull();
      },
    );

    it("gives the same result every time for the same inputs", () => {
      expect(calculateMonthlyRentBudget("85000", "32")).toBe(calculateMonthlyRentBudget("85000", "32"));
    });
  });
});
