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

    it('scores the project plan example: $2,300 rent on $72,000 income is about 38% of income', () => {
      const result = affordability(2300, '72000', '2300');

      expect(result.incomeShare).toBeCloseTo(38.33, 2);
      expect(result.monthlyLimit).toBe(1800);
      expect(result.meetsGuideline).toBe(false);
      expect(result.withinBudget).toBe(true);
    });

    it('gives a higher income share for the 38% case than for a 30% case on the same income', () => {
      const higher = affordability(2300, '72000', '').incomeShare!;
      const guideline = affordability(1800, '72000', '').incomeShare!;

      expect(higher).toBeGreaterThan(guideline);
    });

    it.each([
      [1500, '60000', 30],
      [1000, '120000', 10],
      [2500, '50000', 60],
      [3000, '36000', 100],
      [4000, '36000', 133.33],
    ])('rent of %s on an annual income of %s is %s%% of monthly income', (cost, income, share) => {
      expect(affordability(cost, income, '').incomeShare).toBeCloseTo(share, 2);
    });

    it.each([
      ['60000', 1500],
      ['72000', 1800],
      ['85000', 2125],
      ['120000', 3000],
    ])('the 30%% monthly guideline for an annual income of %s is %s', (income, limit) => {
      expect(affordability(1000, income, '').monthlyLimit).toBeCloseTo(limit, 2);
    });

    it('checks the budget and the guideline separately: within budget but over 30% of income', () => {
      const result = affordability(2300, '72000', '2500');

      expect(result.withinBudget).toBe(true);
      expect(result.meetsGuideline).toBe(false);
    });

    it('checks the budget and the guideline separately: under 30% of income but over budget', () => {
      const result = affordability(1500, '72000', '1400');

      expect(result.withinBudget).toBe(false);
      expect(result.meetsGuideline).toBe(true);
    });

    it('handles a very high income without rounding the share to zero', () => {
      const result = affordability(1800, '1000000000', '');

      expect(result.incomeShare).toBeGreaterThan(0);
      expect(result.incomeShare).toBeCloseTo(0.00216, 5);
      expect(result.meetsGuideline).toBe(true);
    });

    it('accepts decimal incomes and costs', () => {
      const result = affordability(1800.5, '72000.50', '1800.50');

      expect(result.withinBudget).toBe(true);
      expect(result.incomeShare).toBeCloseTo(30.008, 3);
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

    it.each([
      [1799.99, true],
      [1800, true],
      [1800.01, false],
    ])('a cost of %s against the $1,800 guideline meets it: %s', (cost, meets) => {
      expect(affordability(cost, '72000', '').meetsGuideline).toBe(meets);
    });

    it.each([
      [1999.99, true],
      [2000, true],
      [2000.01, false],
    ])('a cost of %s against a $2,000 budget is within it: %s', (cost, within) => {
      expect(affordability(cost, '72000', '2000').withinBudget).toBe(within);
    });

    it('a $0 budget only fits a $0 cost', () => {
      expect(affordability(0, '', '0').withinBudget).toBe(true);
      expect(affordability(0.01, '', '0').withinBudget).toBe(false);
    });

    it('a $0 cost always meets the guideline with a valid income', () => {
      const result = affordability(0, '72000', '');

      expect(result.incomeShare).toBe(0);
      expect(result.meetsGuideline).toBe(true);
    });

    it('the smallest valid income still gives a monthly guideline', () => {
      expect(affordability(1000, '1', '').incomeError).toBeNull();
      expect(affordability(1000, '1', '').monthlyLimit).toBeCloseTo(0.025, 5);
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

    it('a blank budget leaves the budget check unknown without showing an error', () => {
      const result = affordability(1800, '72000', '');

      expect(result.withinBudget).toBeNull();
      expect(result.budgetError).toBeNull();
      expect(result.incomeShare).toBe(30);
    });

    it('a blank income leaves the income checks unknown without showing an error', () => {
      const result = affordability(1800, '', '2000');

      expect(result.incomeError).toBeNull();
      expect(result.monthlyLimit).toBeNull();
      expect(result.incomeShare).toBeNull();
      expect(result.meetsGuideline).toBeNull();
      expect(result.withinBudget).toBe(true);
    });

    it('still gives the monthly guideline when the cost is missing', () => {
      const result = affordability(null, '72000', '');

      expect(result.monthlyLimit).toBe(1800);
      expect(result.incomeShare).toBeNull();
    });

    it('nothing entered and no cost gives no results and no errors', () => {
      expect(affordability(null, '', '')).toEqual({
        incomeError: null,
        budgetError: null,
        monthlyLimit: null,
        incomeShare: null,
        withinBudget: null,
        meetsGuideline: null,
      });
    });

    it('a missing cost never counts as within budget, even with a large budget', () => {
      expect(affordability(null, '72000', '100000').withinBudget).toBeNull();
      expect(affordability(Number.NaN, '72000', '100000').withinBudget).toBeNull();
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

    it('treats an income of only spaces as blank, not as an error', () => {
      const result = affordability(1800, '   ', '');

      expect(result.incomeError).toBeNull();
      expect(result.incomeShare).toBeNull();
    });

    it('accepts an income with spaces around the number', () => {
      expect(affordability(1800, ' 72000 ', '').incomeShare).toBe(30);
    });

    it('shows the income error for an infinite income', () => {
      expect(affordability(1000, 'Infinity', '').incomeError).toBe('Enter annual household income greater than $0.');
    });

    it('shows the budget error for an infinite budget', () => {
      const result = affordability(1000, '', 'Infinity');

      expect(result.budgetError).toBe('Enter a monthly budget of $0 or more.');
      expect(result.withinBudget).toBeNull();
    });

    it('an invalid income does not stop the budget check', () => {
      const result = affordability(1000, '-5', '1500');

      expect(result.incomeError).not.toBeNull();
      expect(result.withinBudget).toBe(true);
    });

    it('an invalid budget does not stop the income checks', () => {
      const result = affordability(1800, '72000', 'abc');

      expect(result.budgetError).not.toBeNull();
      expect(result.incomeShare).toBe(30);
      expect(result.meetsGuideline).toBe(true);
    });

    it('shows both errors when income and budget are both invalid', () => {
      const result = affordability(1000, '0', '-1');

      expect(result.incomeError).not.toBeNull();
      expect(result.budgetError).not.toBeNull();
    });

    it('always returns the same six fields', () => {
      const fields = ['budgetError', 'incomeError', 'incomeShare', 'meetsGuideline', 'monthlyLimit', 'withinBudget'];

      expect(Object.keys(affordability(1800, '72000', '1800')).sort()).toEqual(fields);
      expect(Object.keys(affordability(null, '', '')).sort()).toEqual(fields);
      expect(Object.keys(affordability(-1, 'abc', 'xyz')).sort()).toEqual(fields);
    });

    it('gives the same result every time for the same inputs', () => {
      expect(affordability(2300, '72000', '2000')).toEqual(affordability(2300, '72000', '2000'));
    });
  });
});
