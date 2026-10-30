"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Source = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  coverage: string;
};

type Geography = {
  id: string;
  name: string;
  geography_set__kind: string;
  geography_set__version: string;
};

type Indicator = {
  id: string;
  label: string;
  unit: string;
  definition: string;
};

type Catalog = {
  sources: Source[];
  geographies: Geography[];
  indicators: Indicator[];
};

type Observation = {
  census_year: number | null;
  reference_year: number;
  period: string;
  value: string | null;
  status: string;
  source_locator: string;
  notes: string;
};

type ObservationResult = {
  key: string;
  rows: Observation[];
};

type ObservationError = {
  key: string;
  message: string;
};

type DataTopic = "rent" | "income" | "burden";

function LoadingIndicator({ label }: { label: string }) {
  return (
    <div className="loading-state" role="status" aria-label={label}>
      <span className="loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

const topicTerms: Record<DataTopic, RegExp> = {
  rent: /\brent\b|shelter cost|rental/i,
  income: /\bincome\b/i,
  burden: /housing burden|shelter[- ]cost burden|rent burden/i,
};

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  const data: unknown = await response.json();

  if (!response.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return data as T;
}

function formatValue(value: string | null, unit: string): string {
  if (value === null) return "—";
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return value;
  const formatted = new Intl.NumberFormat("en-CA", {
    maximumFractionDigits: 2,
  }).format(numericValue);
  return unit.toLowerCase().includes("dollar") || unit.toLowerCase().includes("cad")
    ? `$${formatted}`
    : `${formatted} ${unit}`;
}

export default function Home() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [topic, setTopic] = useState<DataTopic>("rent");
  const [geographyId, setGeographyId] = useState("");
  const [indicatorId, setIndicatorId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [annualIncome, setAnnualIncome] = useState("");
  const [monthlyRentBudget, setMonthlyRentBudget] = useState("");
  const [bedrooms, setBedrooms] = useState("1");
  const [observationResult, setObservationResult] =
    useState<ObservationResult | null>(null);
  const [observationError, setObservationError] =
    useState<ObservationError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getJson<Catalog>("/api/catalog/", controller.signal)
      .then((data) => {
        setCatalog(data);
        const neighbourhood =
          data.geographies.find((geography) => geography.geography_set__kind === "neighbourhood") ??
          data.geographies[0];
        const rentIndicator = data.indicators.find((indicator) =>
          topicTerms.rent.test(
            `${indicator.label} ${indicator.definition} ${indicator.unit}`,
          ),
        );
        setGeographyId(neighbourhood?.id ?? "");
        setIndicatorId(rentIndicator?.id ?? "");
        setSourceId(data.sources[0]?.id ?? "");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCatalogError(
            error instanceof Error ? error.message : "Could not load housing data.",
          );
        }
      });

    return () => controller.abort();
  }, []);

  const indicators = useMemo(
    () =>
      (catalog?.indicators ?? []).filter((indicator) =>
        topicTerms[topic].test(
          `${indicator.label} ${indicator.definition} ${indicator.unit}`,
        ),
      ),
    [catalog, topic],
  );

  const selectionKey = `${geographyId}:${indicatorId}:${sourceId}`;

  useEffect(() => {
    if (!geographyId || !indicatorId || !sourceId) return;

    const controller = new AbortController();
    const query = new URLSearchParams({
      geography_id: geographyId,
      indicator_id: indicatorId,
      source_id: sourceId,
    });

    getJson<{ observations: Observation[] }>(
      `/api/observations/?${query.toString()}`,
      controller.signal,
    )
      .then((data) => {
        setObservationResult({
          key: `${geographyId}:${indicatorId}:${sourceId}`,
          rows: data.observations,
        });
        setObservationError(null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setObservationError({
            key: `${geographyId}:${indicatorId}:${sourceId}`,
            message:
              error instanceof Error ? error.message : "Could not load housing records.",
          });
        }
      });

    return () => controller.abort();
  }, [geographyId, indicatorId, sourceId]);

  const observations =
    observationResult?.key === selectionKey ? observationResult.rows : null;
  const currentError =
    observationError?.key === selectionKey ? observationError.message : null;
  const loadingObservations =
    Boolean(geographyId && indicatorId && sourceId) &&
    observations === null &&
    currentError === null;

  const selectedIndicator = indicators.find(
    (indicator) => indicator.id === indicatorId,
  );
  const selectedSource = catalog?.sources.find(
    (source) => source.id === sourceId,
  );
  const selectedGeography = catalog?.geographies.find(
    (geography) => geography.id === geographyId,
  );

  const annualIncomeValue = Number(annualIncome);
  const monthlyBudgetValue = Number(monthlyRentBudget);
  const hasIncome = annualIncome !== "" && annualIncomeValue > 0;
  const hasBudget = monthlyRentBudget !== "" && monthlyBudgetValue >= 0;
  const suggestedRentLimit = hasIncome ? (annualIncomeValue / 12) * 0.3 : null;

  const chartRows = (observations ?? []).filter(
    (row) => row.status === "observed" && row.value !== null,
  );
  const chartMaximum = Math.max(
    1,
    ...chartRows.map((row) => Math.abs(Number(row.value))),
  );

  return (
    <main className="housing-page">
      <header className="hero-panel">
        <nav className="top-nav" aria-label="Main navigation">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true">N</span>
            <span>Neighbourhood<br />Explorer</span>
          </Link>
          <Link className="back-link" href="/">
            <span aria-hidden="true">←</span> Back home
          </Link>
        </nav>
        <div className="hero-content">
          <div className="hero-copy">
            <p className="hero-kicker"><span /> TORONTO · HOUSING SERIES</p>
            <h1>Find your place<br />in the <em>city.</em></h1>
            <p className="hero-description">
              Explore housing costs, understand affordability, and see what the
              data says about Toronto neighbourhoods.
            </p>
            <a className="hero-cta" href="#budget">
              Explore affordability <span aria-hidden="true">↓</span>
            </a>
          </div>
          <div className="city-art" aria-hidden="true">
            <div className="city-orbit orbit-one" />
            <div className="city-orbit orbit-two" />
            <div className="sun-disc" />
            <div className="city-buildings">
              <span className="building building-one" />
              <span className="building building-two" />
              <span className="building building-three" />
              <span className="building building-four" />
              <span className="building building-five" />
              <span className="building building-six" />
            </div>
            <span className="city-caption">A city of<br />many stories</span>
          </div>
        </div>
        <div className="hero-footer">
          <span>Housing &amp; affordability</span>
          <span className="hero-footer-line" />
          <span>Explore the numbers behind the neighbourhood</span>
        </div>
      </header>

      {catalogError ? (
        <section className="message error" role="alert">
          <h2>Could not connect to housing data</h2>
          <p>{catalogError}</p>
          <p>Make sure the Django server is running, then refresh.</p>
        </section>
      ) : !catalog ? (
        <section className="message" aria-live="polite">
          <p>Loading available housing data…</p>
        </section>
      ) : (
        <>
          <section className="budget-panel" id="budget" aria-labelledby="budget-heading">
            <div className="section-title">
              <div>
                <p className="section-kicker">01 <span /> YOUR STARTING POINT</p>
                <h2 id="budget-heading">What feels comfortable?</h2>
                <p className="section-description">
                  Add a few details to get a simple monthly rent estimate.
                </p>
              </div>
              <span className="section-stamp">YOUR<br />BUDGET</span>
            </div>
            <div className="budget-layout">
              <div className="budget-fields">
                <label>
                  Annual household income <span className="label-note">OPTIONAL · BEFORE TAX</span>
                  <span className="input-with-prefix">
                    <span aria-hidden="true">$</span>
                    <input
                      type="number"
                      min="0"
                      inputMode="decimal"
                      placeholder="68,000"
                      value={annualIncome}
                      onChange={(event) => setAnnualIncome(event.target.value)}
                    />
                    <span className="input-suffix">CAD / year</span>
                  </span>
                </label>
                <label>
                  Monthly rent budget
                  <span className="input-with-prefix">
                    <span aria-hidden="true">$</span>
                    <input
                      type="number"
                      min="0"
                      inputMode="decimal"
                      placeholder="2,200"
                      value={monthlyRentBudget}
                      onChange={(event) => setMonthlyRentBudget(event.target.value)}
                    />
                    <span className="input-suffix">CAD / month</span>
                  </span>
                </label>
                <label>
                  Bedrooms
                  <select
                    value={bedrooms}
                    onChange={(event) => setBedrooms(event.target.value)}
                  >
                    <option value="0">Studio</option>
                    <option value="1">1 bedroom</option>
                    <option value="2">2 bedrooms</option>
                    <option value="3">3 bedrooms</option>
                    <option value="4">4+ bedrooms</option>
                  </select>
                </label>
              </div>
              <aside className="estimate-card" aria-live="polite">
                <span className="estimate-icon" aria-hidden="true">↗</span>
                <p className="estimate-label">A QUICK GUIDELINE</p>
                {hasIncome && suggestedRentLimit !== null && (
                  <>
                    <p className="estimate-value">
                      {new Intl.NumberFormat("en-CA", {
                        style: "currency",
                        currency: "CAD",
                        maximumFractionDigits: 0,
                      }).format(suggestedRentLimit)}
                      <span>/ month</span>
                    </p>
                    <p className="estimate-copy">
                      About 30% of your gross income. A common rule of thumb,
                      not a final affordability decision.
                    </p>
                  </>
                )}
                {!hasIncome && (
                  <>
                    <p className="estimate-value estimate-placeholder">Your number, your starting point</p>
                    <p className="estimate-copy">
                      Add an income above to see a rough monthly guideline.
                    </p>
                  </>
                )}
                {hasBudget && hasIncome && (
                  <div className="budget-share">
                    <span>Your budget uses</span>
                    <strong>{((monthlyBudgetValue * 12 / annualIncomeValue) * 100).toFixed(1)}% of gross income</strong>
                  </div>
                )}
                {hasBudget && !hasIncome && (
                  <div className="budget-share">
                    <span>Your monthly rent budget</span>
                    <strong>{new Intl.NumberFormat("en-CA", {
                      style: "currency",
                      currency: "CAD",
                      maximumFractionDigits: 0,
                    }).format(monthlyBudgetValue)}</strong>
                  </div>
                )}
                <p className="estimate-footnote">
                  {bedrooms === "0" ? "Studio selected" : `${bedrooms}${bedrooms === "4" ? "+" : ""} bedroom${bedrooms === "1" ? "" : "s"} selected`}
                  {" · "}Bedrooms may not be available in historical records.
                </p>
              </aside>
            </div>
          </section>

          <section className="data-panel" aria-labelledby="records-heading">
            <div className="section-title data-title">
              <div>
                <p className="section-kicker">02 <span /> THE EVIDENCE</p>
                <h2 id="records-heading">Explore housing data</h2>
                <p className="section-description">
                  Choose a measure and place to explore reported values over time.
                </p>
              </div>
              <div className="data-decoration" aria-hidden="true">
                <span /><span /><span /><span /><span /><span /><span />
              </div>
            </div>
            <div className="filters">
              <label>
                Data
                <select
                  value={topic}
                  onChange={(event) => {
                    const nextTopic = event.target.value as DataTopic;
                    const nextIndicator = catalog.indicators.find((indicator) =>
                      topicTerms[nextTopic].test(
                        `${indicator.label} ${indicator.definition} ${indicator.unit}`,
                      ),
                    );
                    setTopic(nextTopic);
                    setIndicatorId(nextIndicator?.id ?? "");
                  }}
                >
                  <option value="rent">Rent & shelter costs</option>
                  <option value="income">Income</option>
                  <option value="burden">Housing burden</option>
                </select>
              </label>
              <label>
                Geography
                <select
                  value={geographyId}
                  onChange={(event) => setGeographyId(event.target.value)}
                  disabled={catalog.geographies.length === 0}
                >
                  {catalog.geographies.map((geography) => (
                    <option key={geography.id} value={geography.id}>
                      {geography.name} · {geography.geography_set__kind} ·{" "}
                      {geography.geography_set__version}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Measure
                <select
                  value={indicatorId}
                  onChange={(event) => setIndicatorId(event.target.value)}
                  disabled={indicators.length === 0}
                >
                  {indicators.map((indicator) => (
                    <option key={indicator.id} value={indicator.id}>
                      {indicator.label} ({indicator.unit})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Source release
                <select
                  value={sourceId}
                  onChange={(event) => setSourceId(event.target.value)}
                  disabled={catalog.sources.length === 0}
                >
                  {catalog.sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {(catalog.sources.length === 0 ||
            catalog.geographies.length === 0 ||
            indicators.length === 0) ? (
              <LoadingIndicator label="Loading housing records…" />
            ) : (
              <>
                {selectedIndicator && (
                  <p className="measure-definition">
                    <strong>{selectedIndicator.label}:</strong>{" "}
                    {selectedIndicator.definition}
                  </p>
                )}
                {selectedSource && (
                  <div className="source-coverage">
                    <p>
                      <strong>{selectedSource.publisher}</strong> ·{" "}
                      {selectedSource.coverage}
                    </p>
                    <a href={selectedSource.url} target="_blank" rel="noreferrer">
                      View source
                    </a>
                    {selectedGeography && (
                      <p>
                        Geography: {selectedGeography.name} (
                        {selectedGeography.geography_set__kind},{" "}
                        {selectedGeography.geography_set__version})
                      </p>
                    )}
                  </div>
                )}
                {currentError ? (
                  <p className="error-text" role="alert">{currentError}</p>
                ) : loadingObservations ? (
                  <LoadingIndicator label="Loading records…" />
                ) : observations?.length === 0 ? (
                  <LoadingIndicator label="Loading housing records…" />
                ) : observations ? (
                  <>
                    {chartRows.length > 0 && (
                      <div className="chart" aria-label="Observed values by year">
                        {chartRows.map((row, index) => {
                          const value = Number(row.value);
                          const width = Math.max(
                            3,
                            (Math.abs(value) / chartMaximum) * 100,
                          );
                          return (
                            <div
                              className="chart-row"
                              key={`${row.reference_year}-${row.period}-${index}`}
                            >
                              <span className="chart-year">{row.reference_year}</span>
                              <span className="chart-track">
                                <span className="chart-bar" style={{ width: `${width}%` }} />
                              </span>
                              <span className="chart-value">
                                {formatValue(row.value, selectedIndicator?.unit ?? "")}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Reference year</th>
                            <th scope="col">Census year</th>
                            <th scope="col">Period</th>
                            <th scope="col">Value</th>
                            <th scope="col">Status</th>
                            <th scope="col">Source record</th>
                          </tr>
                        </thead>
                        <tbody>
                          {observations.map((observation, index) => (
                            <tr key={`${observation.reference_year}-${observation.period}-${index}`}>
                              <td>{observation.reference_year}</td>
                              <td>{observation.census_year ?? "—"}</td>
                              <td>{observation.period}</td>
                              <td>{formatValue(observation.value, selectedIndicator?.unit ?? "")}</td>
                              <td>{observation.status}</td>
                              <td>{observation.source_locator}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="note">
                      Values are shown as reported (nominal unless the source
                      says otherwise). A dash means unavailable—not zero.
                    </p>
                  </>
                ) : null}
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
