
"use client";

import { useEffect, useState } from "react";
import styles from "./comparison.module.css";


type SavedPlace = {
  id: string;
  name: string;
  year: number;
  boundary: string;
};

const savedKey = "mcp-canada-saved-housing";


const yearConfigs: Record<string, {
  sourceId: string;
  indicatorIds: string[];
}> = {
  "2001": {
    sourceId: "census-2001-csv-8d3542c5b0",
    indicatorIds: [
      "census-2001-row-522", // Average household income
      "census-2001-row-523", // Median household income
    ],
  },
  "2006": {
    sourceId: "census-2006-csv-f5eaa4478e",
    indicatorIds: [
      "census-2006-row-577", // Median household income
      "census-2006-row-578", // Average household income
      "census-2006-row-607", // Median after-tax household income
      "census-2006-row-608", // Average after-tax household income
    ],
  },
  "2011": {
    sourceId: "census-2011-csv-2fc83b4b8e",
    indicatorIds: [
      "census-2011-row-757", // Median household total income
      "census-2011-row-758", // Average household total income
      "census-2011-row-759", // Median after-tax household income
      "census-2011-row-760", // Average after-tax household income
    ],
  },
  "2016": {
    sourceId: "census-2016-csv-9d45a882dd",
    indicatorIds: [
      "census-2016-row-1020", // Median total household income
      "census-2016-row-1021", // Median after-tax household income
      "census-2016-row-1029", // Average total household income
    ],
  },
  "2021": {
    sourceId: "census-2021-xlsx-9a3c372907",
    indicatorIds: [
      "census-2021-row-245", // Median total household income
      "census-2021-row-246", // Average total household income
      "census-2021-row-247", // Median after-tax household income
      "census-2021-row-248", // Average after-tax household income
      "census-2021-row-248", // Average after-tax household income
      "census-2021-row-36",  // Median age
    ],
  },
};


type ComparisonResponse = {
  geographies: {
    id: string;
    name: string;
  }[];

  indicators: {
    id: string;
    label: string;
    unit: string;
  }[];

  observations: {
    geography_id: string;
    indicator_id: string;
    census_year: number | null;
    reference_year: number;
    period: string;
    value: string | null;
    status: string;
  }[];

  budget: {
    monthly_income: number | null;
    monthly_rent: number | null;
    bedrooms: number;
  } | null;

  housing_rent: {
    value: string;
    bedrooms: string;
    reference_year: number;
    geography: string;
  } | null;
};


function isLowerBetter(label: string): boolean {
  const name = label.toLowerCase();

  return (
    name.includes("rent") ||
    name.includes("shelter cost") ||
    name.includes("housing burden") ||
    name.includes("spending 30%") ||
    name.includes("unaffordable housing")
  );
}

function isHigherBetter(label: string): boolean {
  const name = label.toLowerCase();

  return (
    name.includes("income") ||
    name.includes("population") ||
    name.includes("schools") ||
    name.includes("transit stops") ||
    name.includes("parks")
  );
}

function MapCard({ index }: { index: number }) {
  return (
    <div className={`${styles.map} ${styles[`map${index + 1}`]}`}>
      <div className={styles.park} />
      <div className={styles.road} />
      <div className={styles.roadTwo} />
      <div className={styles.blocks}>
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} />
        ))}
      </div>
      <span className={styles.pin}>♥</span>
    </div>
  );
}


export default function ComparisonPage() {
  const [comparisonData, setComparisonData] =
    useState<ComparisonResponse | null>(null);
  const [selectedYear, setSelectedYear] = useState("2021");

  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [error, setError] = useState("");
  const [budget, setBudget] = useState<{
    before_tax_income: number | null;
    monthly_rent: number | null;
    bedrooms: number;
  } | null>(null);
  const [budgetLoaded, setBudgetLoaded] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem("mcp-canada-budget-preferences");

    if (!stored) return;

    try {
      const parsed = JSON.parse(stored);

      if (
        (parsed.before_tax_income === null ||
          typeof parsed.before_tax_income === "number") &&
        (parsed.monthly_rent === null ||
          typeof parsed.monthly_rent === "number") &&
        typeof parsed.bedrooms === "number"
      ) {
        setBudget(parsed);
      }
    } catch {
      console.error("Could not read saved budget preferences.");
    }
    setBudgetLoaded(true);
  }, []);

  useEffect(() => {
    if (!budgetLoaded) return;

    async function loadComparison() {
      setComparisonData(null);
      setError("");
      try {
        const stored = localStorage.getItem(savedKey);
        const parsed: unknown = stored ? JSON.parse(stored) : [];

        if (!Array.isArray(parsed)) {
          throw new Error("Your saved places could not be read.");
        }

        const places = parsed.filter(
          (place): place is SavedPlace =>
            place &&
            typeof place.id === "string" &&
            typeof place.name === "string" &&
            Number.isInteger(place.year) &&
            typeof place.boundary === "string"
        );

        if (places.length < 3 || places.length > 5) {
          throw new Error(
            "Save between 3 and 5 neighbourhoods before comparing."
          );
        }

        if (places.some(place => place.boundary !== "toronto-158")) {
          throw new Error(
            "The current comparison supports Toronto 158 neighbourhoods only."
          );
        }

        if (new Set(places.map(place => place.id)).size !== places.length) {
          throw new Error(
            "A neighbourhood can only be compared once. Remove duplicate saved entries."
          );
        }

        setSavedPlaces(places);

        const selectedConfig = yearConfigs[selectedYear];

        const params = new URLSearchParams({
          geography_ids: places.map(place => place.id).join(","),
          indicator_ids: selectedConfig.indicatorIds.join(","),
          source_id: selectedConfig.sourceId,
        });

        if (budget) {
          if (budget.before_tax_income !== null) {
            params.set("before_tax_income", String(budget.before_tax_income));
          }

          if (budget.monthly_rent !== null) {
            params.set("monthly_rent", String(budget.monthly_rent));
          }

          params.set("bedrooms", String(budget.bedrooms));
        }

        const response = await fetch(
          `/api/comparison/?${params.toString()}`
        );

        if (!response.ok) {
          throw new Error("Unable to load neighbourhood data.");
        }

        const result: ComparisonResponse = await response.json();
        setComparisonData(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Something went wrong."
        );
      }
    }

    loadComparison();
  }, [selectedYear, budget, budgetLoaded]);

  const isLoading = !comparisonData && !error;
  const rows = comparisonData?.indicators
    .filter(
      (indicator) =>
        !indicator.label.toLowerCase().includes("median age")
    )
    .map((indicator) => ({
      label: indicator.label,
      indicatorId: indicator.id,
      unit: indicator.unit,
    })) ?? [];
  const neighbourhoods = comparisonData
    ? savedPlaces.map((place) => {
      const geography = comparisonData.geographies.find(
        (g) => g.name === place.name
      );

      return {
        id: place.id,
        geographyId: geography?.id,
        name: geography?.name ?? place.name,
      };
    })
    : [];


  const housingRent = comparisonData?.housing_rent
    ? Number(comparisonData.housing_rent.value)
    : null;

  const monthlyIncome = comparisonData?.budget?.monthly_income ?? null;
  const monthlyRentBudget = comparisonData?.budget?.monthly_rent ?? null;

  const rentWithinBudget =
    housingRent !== null && monthlyRentBudget !== null
      ? housingRent <= monthlyRentBudget
      : null;

  const rentIncomeShare =
    housingRent !== null && monthlyIncome !== null && monthlyIncome > 0
      ? (housingRent / monthlyIncome) * 100
      : null;

  return (

    <div className={styles.dashboard}>
      <main className={styles.main}>
        <p className={styles.eyebrow}>
          COMPARE PLACES · ONE SHARED PERIOD
        </p>

        <div className={styles.controls}>
          <div className={styles.period}>
            <span>PERIOD FOR ALL LOCATIONS</span>
            <select
              value={selectedYear}
              onChange={(event) => setSelectedYear(event.target.value)}
              aria-label="Select comparison period"
            >
              <option value="2001">2001 Census</option>
              <option value="2006">2006 Census</option>
              <option value="2011">2011 Census</option>
              <option value="2016">2016 Census</option>
              <option value="2021">2021 Census</option>
            </select>
          </div>

          <div className={styles.profile}>
            <span>YOUR PROFILE · SAME ASSUMPTIONS FOR EVERY PLACE</span>
            <p>
              {budget ? (
                <>
                  {budget.bedrooms === 0
                    ? "Studio"
                    : `${budget.bedrooms}${budget.bedrooms === 4 ? "+" : ""} bedrooms`}
                  {" · "}
                  {budget.monthly_rent !== null
                    ? `$${budget.monthly_rent.toLocaleString("en-CA")} rent budget`
                    : "Rent budget not provided"}
                  {" · "}
                  {budget.before_tax_income !== null
                    ? `$${Math.round(budget.before_tax_income).toLocaleString("en-CA")} monthly income`
                    : "Income not provided"}
                </>
              ) : (
                "Add your housing preferences to personalize this comparison."
              )}
            </p>
          </div>
        </div>

        <p className={styles.note}>
          Green cells mark the best available value in each row.
          — means missing, never zero.
          Census release: {selectedYear}. Indicator reference periods vary by measure.
        </p>
        {isLoading && (
          <p className={styles.note}>Loading Toronto neighbourhood data...</p>
        )}

        {error && (
          <p className={styles.note}>{error}</p>
        )}

        <section className={styles.comparison}>
          <h2>{selectedYear} Census snapshot</h2>

          <div className={styles.neighbourhoods}>
            {neighbourhoods.map((n, i) => (
              <div className={styles.place} key={n.id}>
                <MapCard index={i} />
                <h3>{n.name}</h3>
                <span>Toronto · Saved neighbourhood</span>
                <small>Map concept · not geographic evidence</small>
              </div>
            ))}
          </div>


          <div className={styles.tableWrap}>
            <table>
              <tbody>
                <tr>
                  <th scope="row">Median age of the population</th>
                  {neighbourhoods.map((n) => {
                    const ageIndicatorId = {
                      "2001": null,
                      "2006": "census-2006-row-28",
                      "2011": "census-2011-row-39",
                      "2016": null,
                      "2021": "census-2021-row-36",
                    }[selectedYear];

                    const observation = ageIndicatorId
                      ? comparisonData?.observations.find(
                        (o) =>
                          o.geography_id === n.geographyId &&
                          o.indicator_id === ageIndicatorId
                      )
                      : null;

                    return (
                      <td key={n.id}>
                        {observation?.status === "observed" &&
                          observation.value !== null
                          ? Number(observation.value).toLocaleString("en-CA", {
                            maximumFractionDigits: 1,
                          })
                          : "—"}
                      </td>
                    );
                  })}
                </tr>

                {rows.map((row) => {
                  const values = neighbourhoods.map((n) => {
                    const observation = comparisonData?.observations.find(
                      (o) =>
                        o.geography_id === n.geographyId &&
                        o.indicator_id === row.indicatorId
                    );

                    return observation?.status === "observed" &&
                      observation.value !== null
                      ? Number(observation.value)
                      : null;
                  });

                  const validValues = values.filter(
                    (value): value is number =>
                      value !== null && Number.isFinite(value)
                  );

                  const bestValue =
                    validValues.length === 0
                      ? null
                      : isLowerBetter(row.label)
                        ? Math.min(...validValues)
                        : isHigherBetter(row.label)
                          ? Math.max(...validValues)
                          : null;

                  return (
                    <tr key={row.indicatorId}>
                      <th scope="row">{row.label}</th>

                      {values.map((value, index) => {
                        let displayValue = "—";

                        if (value !== null && Number.isFinite(value)) {
                          displayValue = value.toLocaleString("en-CA", {
                            maximumFractionDigits: 2,
                          });

                          if (
                            row.unit === "CAD/year" ||
                            row.unit === "CAD/month"
                          ) {
                            displayValue = `$${value.toLocaleString("en-CA", {
                              maximumFractionDigits: 0,
                            })}`;
                          } else if (row.unit === "percent") {
                            displayValue = `${value.toLocaleString("en-CA", {
                              maximumFractionDigits: 1,
                            })}%`;
                          } else if (row.unit === "years") {
                            displayValue = value.toLocaleString("en-CA", {
                              maximumFractionDigits: 1,
                            });
                          } else if (
                            row.unit === "persons" ||
                            row.unit === "households"
                          ) {
                            displayValue = value.toLocaleString("en-CA", {
                              maximumFractionDigits: 0,
                            });
                          }
                        }

                        const isBest =
                          bestValue !== null && value === bestValue;

                        return (
                          <td
                            key={neighbourhoods[index].id}
                            className={isBest ? styles.bestValue : undefined}
                          >
                            {displayValue}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}

                <>
                  <tr>
                    <th scope="row">Within your monthly rent budget</th>
                    {neighbourhoods.map((place) => (
                      <td key={place.id}>
                        {rentWithinBudget === null
                          ? "—"
                          : rentWithinBudget
                            ? "Yes"
                            : "No"}
                      </td>
                    ))}
                  </tr>

                  <tr>
                    <th scope="row">
                      Average monthly rent ({comparisonData?.housing_rent?.geography ?? "Toronto CMA"})
                    </th>
                    {neighbourhoods.map((place) => (
                      <td key={place.id}>
                        {housingRent === null
                          ? "—"
                          : housingRent.toLocaleString("en-CA", {
                            style: "currency",
                            currency: "CAD",
                            maximumFractionDigits: 0,
                          })}
                      </td>
                    ))}
                  </tr>

                  <tr>
                    <th scope="row">Share of monthly income</th>
                    {neighbourhoods.map((place) => (
                      <td key={place.id}>
                        {rentIncomeShare !== null
                          ? `${rentIncomeShare.toFixed(1)}%`
                          : "—"}
                      </td>
                    ))}
                  </tr>
                </>
              </tbody>
            </table>
          </div>

        </section>

        <p className={styles.disclaimer}>
          Sources: Statistics Canada, {selectedYear} Census; CMHC,
          {comparisonData?.housing_rent?.reference_year ?? "latest available"}.
          CMHC rent represents the Toronto CMA.
        </p>

        {/* Local historical context */}
        <section className={styles.history}>
          <h2>Local history in context</h2>

          <p>
            Compare how each neighbourhood&apos;s past shaped today&apos;s housing,
            transport and community spaces. Historical context stays
            separate from the present-day match score.
          </p>

          <div className={styles.historyGrid}>
            <article>
              <h3>Erindale</h3>
              <p>How did learning spaces shape the surrounding community?</p>
              <span>No dated records linked</span>
            </article>

            <article>
              <h3>Cooksville</h3>
              <p>How did transport connections influence local growth?</p>
              <span>No dated records linked</span>
            </article>

            <article>
              <h3>Port Credit</h3>
              <p>How did waterfront land use shape everyday life?</p>
              <span>No dated records linked</span>
            </article>
          </div>
        </section>

        {/* Data methodology */}
        <section className={styles.method}>
          <h2>Data coverage & method</h2>

          <p>
            The comparison table uses observed values from the selected
            Census year. Housing affordability is shown separately using
            CMHC average apartment rent for your selected bedroom category.
            Rent figures represent the Toronto CMA, not individual
            neighbourhoods. For 4+ bedroom selections, the available
            3-bedroom-and-plus category is used. Share of monthly income
            is calculated using your provided monthly income.
            Missing Census indicators are excluded from comparisons.
          </p>

          <p>
            Sources to connect: CMHC · Statistics Canada · OpenStreetMap
            · MiWay / GO Transit · municipal safety records · local
            archives. Use matching geographic coverage and reference
            dates; show the actual vintage where 2026 data is unavailable.
          </p>
        </section>

        {/* Bottom navigation */}
        <div className={styles.bottomActions}>
          <span>← Back to map</span>
          <span>Complete your profile</span>
        </div>

      </main>

      {/* Reserved for teammate's history teacher sidebar */}
      <aside
        className={styles.sidebar}
        aria-label="Reserved sidebar for history teacher feature"
      />
    </div>
  );
}
