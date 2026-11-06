import { describe, expect, it } from 'vitest';
import { affordability } from './affordability';

describe('affordability', () => {
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

  it('treats a cost equal to the guideline as meeting it', () => {
    const result = affordability(1800, '72000', '1700');

    expect(result.meetsGuideline).toBe(true);
    expect(result.withinBudget).toBe(false);
  });

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

  it('treats negative and non-finite housing costs as unavailable', () => {
    for (const cost of [-1, Number.POSITIVE_INFINITY, Number.NaN]) {
      const result = affordability(cost, '72000', '1500');

      expect(result.incomeShare).toBeNull();
      expect(result.withinBudget).toBeNull();
      expect(result.meetsGuideline).toBeNull();
    }
  });
});
