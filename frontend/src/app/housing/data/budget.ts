export function calculateMonthlyRentBudget(
  annualIncome: string,
  rentSharePercent: string,
): number | null {
  const income = Number(annualIncome);
  const share = Number(rentSharePercent);

  if (
    annualIncome.trim() === "" ||
    rentSharePercent.trim() === "" ||
    !Number.isFinite(income) ||
    income <= 0 ||
    !Number.isFinite(share) ||
    share < 0 ||
    share > 100
  ) {
    return null;
  }

  return income * (share / 100) / 12;
}
