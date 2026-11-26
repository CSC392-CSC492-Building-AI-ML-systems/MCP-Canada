/**
 * Tests for the affordability snapshot check (affordability.ts).
 *
 * Grouped the way the project plan's testing framework (Section 7, Layer 1) asks for:
 * a normal case, a boundary case and a missing-data case for every calculation,
 * plus input validation.
 */
import { describe, expect, it } from 'vitest';
import { affordability } from './affordability';

describe('affordability', () => {
  describe('normal cases', () => {
    it('calculates the monthly guideline, income share, and budget result', () => {
      expect(affordability(1800, '72000', '1800')).toEqual({
        incomeError: null,
        budgetError: null,
        monthlyLimit: 1800,
        incomeShare: 30,
        withinBudget: true,
        meetsGuideline: true,
      });
    });
  });

  describe('boundary cases', () => {
    it('treats a cost equal to the guideline as meeting it', () => {
      const result = affordability(1800, '72000', '1700');

      expect(result.meetsGuideline).toBe(true);
      expect(result.withinBudget).toBe(false);
    });

    it('income share and exact monthly budget boundary', () => {
      const r = affordability(1800, '72000', '1800');
      expect(r.incomeShare).toBe(30);
      expect(r.monthlyLimit).toBe(1800);
      expect(r.withinBudget).toBe(true);
      expect(r.meetsGuideline).toBe(true);
      expect(affordability(1800.01, '72000', '1800').withinBudget).toBe(false);
    });

    it('zero income is invalid and zero observed cost is valid', () => {
      expect(affordability(1000, '0', '').incomeError).toBeTruthy();
      expect(affordability(1000, '0', '').incomeShare).toBeNull();
      expect(affordability(0, '72000', '0').withinBudget).toBe(true);
      expect(affordability(0, '72000', '').incomeShare).toBe(0);
    });
  });

  describe('missing data', () => {
    it('leaves calculations unavailable when income or cost is missing', () => {
      expect(affordability(null, '', '1500')).toEqual({
        incomeError: null,
        budgetError: null,
        monthlyLimit: null,
        incomeShare: null,
        withinBudget: null,
        meetsGuideline: null,
      });
    });

    it('missing cost stays unknown, including with valid income', () => {
      const r = affordability(null, '72000', '1800');
      expect(r.incomeShare).toBeNull();
      expect(r.withinBudget).toBeNull();
      expect(r.meetsGuideline).toBeNull();
    });

    it('treats negative and non-finite housing costs as unavailable', () => {
      for (const cost of [-1, Number.POSITIVE_INFINITY, Number.NaN]) {
        const result = affordability(cost, '72000', '1500');

        expect(result.incomeShare).toBeNull();
        expect(result.withinBudget).toBeNull();
        expect(result.meetsGuideline).toBeNull();
      }
    });
  });

  describe('input validation', () => {
    it.each(['0', '-1', 'not a number'])('rejects invalid annual income %s', (income) => {
      const result = affordability(1000, income, '1500');

      expect(result.incomeError).toBe('Enter annual household income greater than $0.');
      expect(result.monthlyLimit).toBeNull();
      expect(result.incomeShare).toBeNull();
      expect(result.meetsGuideline).toBeNull();
    });

    it.each(['-1', 'not a number'])('rejects invalid monthly budget %s', (budget) => {
      const result = affordability(1000, '72000', budget);

      expect(result.budgetError).toBe('Enter a monthly budget of $0 or more.');
      expect(result.withinBudget).toBeNull();
    });

    it('invalid, blank and non-finite personal inputs never yield a score', () => {
      for (const income of ['', ' ', 'NaN', '-1', 'Infinity']) expect(affordability(1000, income, '').incomeShare).toBeNull();
      expect(affordability(1000, '72000', '-1').budgetError).toBeTruthy();
      expect(affordability(-1, '72000', '1800').incomeShare).toBeNull();
    });
  });
});
