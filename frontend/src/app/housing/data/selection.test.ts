import { describe, expect, it } from "vitest";
import {
  defaultHousingSelection,
  indicatorsForGeography,
  indicatorsForTopic,
  sourcesForSelection,
  type Catalog,
} from "./selection";

const catalog: Catalog = {
  sources: [
    { id: "census-2001-release", title: "2001", publisher: "City", url: "", coverage: "" },
    { id: "census-2021-release", title: "2021", publisher: "City", url: "", coverage: "" },
    { id: "boundary-158", title: "Boundaries", publisher: "City", url: "", coverage: "" },
  ],
  geography_sets: [{ id: "toronto-158", source_id: "boundary-158" }],
  geographies: [
    {
      id: "toronto-158-1",
      name: "Test neighbourhood",
      code: "1",
      geography_set_id: "toronto-158",
      geography_set__kind: "neighbourhood",
      geography_set__version: "158",
    },
    {
      id: "toronto-140-1",
      name: "Historical neighbourhood",
      code: "1",
      geography_set_id: "toronto-140",
      geography_set__kind: "neighbourhood",
      geography_set__version: "140",
    },
  ],
  indicators: [
    {
      id: "census-2011-row-1358",
      label: "% of owner households spending 30% or more on shelter costs",
      definition: "Percentage spending 30% or more",
      unit: "percent",
    },
    {
      id: "census-2001-row-742",
      label: "Average gross rent",
      definition: "Average gross rent",
      unit: "CAD/month",
    },
    {
      id: "census-2021-row-380",
      label: "Median monthly shelter costs for rented dwellings",
      definition: "Median monthly shelter costs",
      unit: "CAD/month",
    },
    {
      id: "census-2021-row-245",
      label: "Median total income of household",
      definition: "Median total income",
      unit: "CAD/year",
    },
  ],
};

describe("housing data selection", () => {
  it("defaults to a rent measure and release that match the current neighbourhood set", () => {
    const selection = defaultHousingSelection(catalog);

    expect(selection.geography?.id).toBe("toronto-158-1");
    expect(selection.indicator?.id).toBe("census-2021-row-380");
    expect(selection.source?.id).toBe("census-2021-release");
  });

  it("does not mistake housing-burden percentages for rent measures", () => {
    const rent = indicatorsForTopic(catalog, "rent");
    const burden = indicatorsForTopic(catalog, "burden");

    expect(rent.map((indicator) => indicator.id)).toEqual([
      "census-2001-row-742",
      "census-2021-row-380",
    ]);
    expect(burden.map((indicator) => indicator.id)).toEqual([
      "census-2011-row-1358",
    ]);
  });

  it("keeps historical and current Census indicators on their matching boundary sets", () => {
    const rent = indicatorsForTopic(catalog, "rent");

    expect(
      indicatorsForGeography(rent, catalog.geographies[0]).map(({ id }) => id),
    ).toEqual(["census-2021-row-380"]);
    expect(
      indicatorsForGeography(rent, catalog.geographies[1]).map(({ id }) => id),
    ).toEqual(["census-2001-row-742"]);
  });

  it("selects the matching Census source instead of the boundary source", () => {
    const geography = catalog.geographies[0];
    const indicator = catalog.indicators[2];

    expect(sourcesForSelection(catalog, geography, indicator)[0]?.id)
      .toBe("census-2021-release");
  });
});
