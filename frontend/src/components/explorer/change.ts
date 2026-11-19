/** Measured change between two periods. Reports what the data shows; never a cause. */
export const MAJOR_CHANGE_PERCENT = 15;

export type Change = { from: number; to: number; absolute: number; percent: number | null; major: boolean };

/** Absolute and percent change; null when either value is unavailable (never treated as zero). */
export function measuredChange(from: number | null, to: number | null): Change | null {
  if (from === null || to === null || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  const absolute = to - from;
  // A percentage of zero is undefined, not infinite.
  const percent = from === 0 ? null : absolute / Math.abs(from) * 100;
  return { from, to, absolute, percent, major: percent !== null && Math.abs(percent) >= MAJOR_CHANGE_PERCENT };
}

/** "+25%" / "−4.2%"; one decimal under 10%. */
export function formatPercent(percent: number): string {
  const rounded = Math.abs(percent) < 10 ? percent.toFixed(1) : percent.toFixed(0);
  return `${percent > 0 ? "+" : percent < 0 ? "−" : ""}${rounded.replace("-", "")}%`;
}
