// Colouring neighbourhoods on the map by one measure at a time.

/** Shading for any measure: values by geography id, banded by `breaks`. A null or absent
 * value is unknown and shown in `noData`, never as the lowest band. */
export type Shading = {
  values: Record<string, number | null>;
  breaks: number[];
  /** One more colour than `breaks`, for the bands from lowest to highest value. */
  colors: string[];
  noData: string;
  /** The hover text for one neighbourhood's value. */
  describe: (value: number | null) => string;
};

/** The Mapbox colour for a shaded feature: its band, or "no data" when it has no value. */
export function shadingColor({ breaks, colors, noData }: Pick<Shading, "breaks" | "colors" | "noData">): unknown[] {
  return ["case", ["has", "shade_value"], ["step", ["get", "shade_value"], colors[0], ...breaks.flatMap((b, i) => [b, colors[i + 1]])], noData];
}

/** The band a value falls in (0 is the lowest), the same way the map's "step" colours it. */
export function bandOf(value: number, breaks: number[]): number {
  return breaks.filter(b => value >= b).length;
}
