/** A budget check, not a neighbourhood match score or published housing-burden statistic. */
export function affordability(cost: number | null, annualIncome: string, rentBudget: string) {
  const income = annualIncome.trim() === "" ? null : Number(annualIncome);
  const budget = rentBudget.trim() === "" ? null : Number(rentBudget);
  const validIncome = income !== null && Number.isFinite(income) && income > 0;
  const validBudget = budget !== null && Number.isFinite(budget) && budget >= 0;
  const validCost = cost !== null && Number.isFinite(cost) && cost >= 0;
  return {
    incomeError: income !== null && !validIncome ? "Enter annual household income greater than $0." : null,
    budgetError: budget !== null && !validBudget ? "Enter a monthly budget of $0 or more." : null,
    monthlyLimit: validIncome ? income * 0.3 / 12 : null,
    incomeShare: validIncome && validCost ? cost / (income / 12) * 100 : null,
    withinBudget: validCost && validBudget ? cost <= budget : null,
    meetsGuideline: validIncome && validCost ? cost <= income * 0.3 / 12 : null,
  };
}
