export type Source = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  coverage: string;
};

export type Geography = {
  id: string;
  name: string;
  code: string;
  geography_set_id: string;
  geography_set__kind: string;
  geography_set__version: string;
};

export type GeographySet = {
  id: string;
  source_id: string;
};

export type Indicator = {
  id: string;
  label: string;
  unit: string;
  definition: string;
};

export type Catalog = {
  sources: Source[];
  geography_sets: GeographySet[];
  geographies: Geography[];
  indicators: Indicator[];
};

export type DataTopic = "rent" | "income" | "burden";

const censusIndicatorYear = (indicator: Indicator) =>
  indicator.id.match(/^census-(\d{4})-/)?.[1];
const cmhcIndicatorYear = (indicator: Indicator) =>
  indicator.id.match(/^cmhc-(\d{4})-/)?.[1];

export function indicatorsForTopic(catalog: Catalog, topic: DataTopic) {
  return catalog.indicators.filter((indicator) => {
    const text = `${indicator.label} ${indicator.definition}`;
    if (topic === "rent") {
      return /^(CAD|[$])/i.test(indicator.unit) &&
        /\brent\b|rented dwellings|gross rent/i.test(text);
    }
    if (topic === "income") {
      return /CAD\/year|dollars?\/year/i.test(indicator.unit);
    }
    return /30%\s*or more|spending 30%|shelter-cost-to-income ratio/i.test(text);
  });
}

export function indicatorsForGeography(
  indicators: Indicator[],
  geography: Geography | undefined,
) {
  if (!geography) return [];
  return indicators.filter((indicator) => {
    const censusYear = censusIndicatorYear(indicator);
    if (censusYear) {
      return geography.geography_set_id ===
        (censusYear === "2021" ? "toronto-158" : "toronto-140");
    }

    const cmhcYear = cmhcIndicatorYear(indicator);
    if (cmhcYear) {
      return geography.geography_set_id.startsWith(`cmhc-`) &&
        geography.geography_set_id.includes(cmhcYear);
    }
    return true;
  });
}

export function sourcesForSelection(
  catalog: Catalog,
  geography: Geography | undefined,
  indicator: Indicator | undefined,
) {
  if (!geography || !indicator) return [];

  const censusYear = censusIndicatorYear(indicator);
  if (censusYear) {
    return catalog.sources.filter((source) =>
      source.id.startsWith(`census-${censusYear}-`),
    );
  }

  const geographySet = catalog.geography_sets.find(
    (set) => set.id === geography.geography_set_id,
  );
  if (geographySet) {
    return catalog.sources.filter((source) => source.id === geographySet.source_id);
  }

  const cmhcYear = cmhcIndicatorYear(indicator);
  if (cmhcYear) {
    return catalog.sources.filter((source) =>
      source.id.includes(`-${cmhcYear}-`),
    );
  }
  return catalog.sources;
}

export function preferredIndicator(indicators: Indicator[], geography: Geography) {
  const censusYear = geography.geography_set_id === "toronto-158" ? "2021" : null;
  return (
    (censusYear
      ? indicators.find((indicator) =>
          indicator.id.startsWith(`census-${censusYear}-`) &&
          /median monthly shelter costs for rented dwellings/i.test(indicator.label),
        )
      : undefined) ??
    indicators.find((indicator) =>
      /median monthly shelter costs for rented dwellings|average gross rent/i.test(
        indicator.label,
      ),
    ) ??
    indicators[0]
  );
}

export function defaultHousingSelection(catalog: Catalog) {
  const geography =
    catalog.geographies.find(
      (item) => item.geography_set_id === "toronto-158" && item.code === "1",
    ) ??
    catalog.geographies.find((item) => item.geography_set_id === "toronto-158") ??
    catalog.geographies.find((item) => item.geography_set__kind === "neighbourhood") ??
    catalog.geographies[0];
  if (!geography) return { geography, indicator: undefined, source: undefined };

  const rentIndicators = indicatorsForGeography(
    indicatorsForTopic(catalog, "rent"),
    geography,
  );
  const indicator = preferredIndicator(rentIndicators, geography);
  const source = sourcesForSelection(catalog, geography, indicator)[0];
  return { geography, indicator, source };
}
