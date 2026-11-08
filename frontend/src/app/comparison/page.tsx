
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
      "census-2001-row-3",
      "census-2001-row-745",
      "census-2001-row-741",
      "census-2001-row-743",
    ],
  },
  "2006": {
    sourceId: "census-2006-csv-f5eaa4478e",
    indicatorIds: [
      "census-2006-row-3",
      "census-2006-row-1201",
      "census-2006-row-1197",
      "census-2006-row-1199",
      "census-2006-row-803",
    ],
  },
  "2011": {
    sourceId: "census-2011-csv-2fc83b4b8e",
    indicatorIds: [
      "census-2011-row-2",
      "census-2011-row-759",
      "census-2011-row-1366",
      "census-2011-row-1367",
      "census-2011-row-1365",
      "census-2011-row-1358",
    ],
  },
  "2016": {
    sourceId: "census-2016-csv-9d45a882dd",
    indicatorIds: [
      "census-2016-row-4",
      "census-2016-row-1684",
      "census-2016-row-1690",
      "census-2016-row-1680",
      "census-2016-row-8",
    ],
  },
  "2021": {
    sourceId: "census-2021-xlsx-9a3c372907",
    indicatorIds: [
      "census-2021-row-247",
      "census-2021-row-380",
      "census-2021-row-381",
      "census-2021-row-378",
      "census-2021-row-36",
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
};

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

  useEffect(() => {
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
}, [selectedYear]);

  const isLoading = !comparisonData && !error;
  const rows = comparisonData?.indicators.map((indicator) => ({
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

  return (

    <div className={styles.dashboard}>
      <main className={styles.main}>
        <p className={styles.eyebrow}>
          COMPARE PLACES · ONE SHARED PERIOD
        </p>

        <h1>Side-by-side comparison</h1>

        <p className={styles.subtitle}>
          Different neighbourhoods, the same time period.
          Compare fit, everyday needs and local context.
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
            <span>SAMPLE PROFILE · SAME ASSUMPTIONS FOR EVERY PLACE</span>
            <p>
              2 bedrooms · $2,400 rent budget · $6,000 monthly income ·
              30 min work commute
            </p>
          </div>
        </div>

        <p className={styles.note}>
          Values are displayed in their respective units.
          — means the observation is missing, not zero.
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
                {rows.map((row) => (
                  <tr key={row.indicatorId}>
                    <th>{row.label}</th>

                    {neighbourhoods.map((n) => {
                      const observation = comparisonData?.observations.find(
                        (o) =>
                          o.geography_id === n.geographyId &&
                          o.indicator_id === row.indicatorId
                      );

                      const value =
                        observation?.status === "observed" &&
                        observation.value !== null
                          ? Number(observation.value)
                          : null;

                      let displayValue = "—";

                      if (value !== null && Number.isFinite(value)) {
                        if (row.unit === "CAD/year" || row.unit === "CAD/month") {
                          displayValue = `$${value.toLocaleString("en-CA", {
                            maximumFractionDigits: 0,
                          })}`;
                        } else if (row.unit === "percent") {
                          displayValue = `${value.toLocaleString("en-CA", {
                            maximumFractionDigits: 1,
                          })}%`;
                        } else if (row.unit === "years") {
                          displayValue = `${value.toLocaleString("en-CA", {
                            maximumFractionDigits: 1,
                          })}`;
                        }
                        else if (row.unit === "persons" || row.unit === "households") {
                          displayValue = value.toLocaleString("en-CA", {
                            maximumFractionDigits: 0,
                          });
                        }
                      }

                      return (
                        <td key={n.id}>
                          {displayValue}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className={styles.disclaimer}>
          Source: Statistics Canada, {selectedYear} Census. Indicator definitions and reference periods may vary by Census year.
        </p>
                
        {/* AI-generated neighbourhood recommendations */}
        <section className={styles.recommendations}>
          <h2>Where could you live?</h2>

          <div className={styles.aiBanner}>
            <h3>✦ AI-generated recommendations</h3>
            <p>
              These suggestions use the sample profile and illustrative
              comparison data. They are a starting point and are not yet
              personalized to you.
            </p>
            <p>
              For more personalized recommendations, fill out your profile
              with your budget, work or school destination, everyday needs
              and lifestyle preferences.
            </p>
            <span className={styles.primaryAction}>
              Complete your profile →
            </span>
          </div>

          <div className={styles.recommendationGrid}>
            <article className={styles.recommendationCard}>
              <h3>Best sample overall · Erindale</h3>
              <p>
                Consider Erindale if shorter commutes and transit access
                matter most. It has the highest illustrative match score
                (72/100), but $2,950 rent exceeds the sample budget by $550.
              </p>
            </article>

            <article className={styles.recommendationCard}>
              <h3>For parks & lifestyle · Cooksville</h3>
              <p>
                Consider Cooksville if parks and lifestyle fit are
                priorities. The sample commute is 23 min; $2,650 rent
                exceeds the sample budget by $250.
              </p>
            </article>

            <article className={styles.recommendationCard}>
              <h3>For the sample budget · Port Credit</h3>
              <p>
                Consider Port Credit if the $2,400 rent limit is your
                priority. Sample rent is $2,300, but the 31 min commute
                exceeds the sample limit. School and safety data are missing.
              </p>
            </article>
          </div>
        </section>

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
            The comparison table uses observed values from the 2021
            Toronto neighbourhood Census profiles. The recommendations
            and match scores are still illustrative and are not yet
            calculated from your personal profile. Missing factors
            must be excluded and available weights normalized when
            calculating personalized scores.
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
