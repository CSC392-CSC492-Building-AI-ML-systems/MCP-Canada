// Map shading by travel time from each neighbourhood to the address in the user's profile.
import type { Shading } from "./shading";


// One violet hue, dark for the shortest trips (validated as an ordinal ramp on the light
// basemap). Orange is population and green the selection, so neither is reused here.
export const COMMUTE_COLORS = ["#2e1f86", "#5243c4", "#7c6fe0", "#a59cf0"];
export const COMMUTE_NO_DATA = "#c9c9c2";

/** Bands that follow the match score: up to half the user's limit scores 100, the limit
 * itself 50, and 1.5 times the limit or more 0. Without a limit, 15-minute steps. */
export function commuteBands(limit: number): { breaks: number[]; labels: string[] } {
  const breaks = limit > 0 ? [limit / 2, limit, limit * 1.5].map(Math.round) : [15, 30, 45];
  const [a, b, c] = breaks;
  const labels = limit > 0
    ? [`Up to ${a} min`, `${a}–${b} min (your limit)`, `${b}–${c} min`, `Over ${c} min`]
    : [`Up to ${a} min`, `${a}–${b} min`, `${b}–${c} min`, `Over ${c} min`];
  return { breaks, labels };
}

/** Travel minutes per neighbourhood as map shading. A trip at exactly a break counts in the
 * shorter band, so a trip at the limit is shown within it. */
export function commuteShading(minutes: Record<string, number | null>, limit: number, trip: string): Shading {
  const { breaks } = commuteBands(limit);
  return {
    values: minutes,
    // Mapbox "step" puts a value equal to a break in the higher band; nudge the breaks up.
    breaks: breaks.map(b => b + 0.5),
    colors: COMMUTE_COLORS,
    noData: COMMUTE_NO_DATA,
    describe: (n) => n === null ? `No ${trip} time` : `${n} min to ${trip}`,
  };
}
