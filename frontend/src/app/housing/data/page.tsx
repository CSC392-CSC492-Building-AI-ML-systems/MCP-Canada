"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  defaultHousingSelection,
  indicatorsForGeography,
  indicatorsForTopic,
  preferredIndicator,
  sourcesForSelection,
  type Catalog,
  type DataTopic,
} from "./selection";
import { calculateMonthlyRentBudget } from "./budget";

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

function LoadingIndicator({ label }: { label: string }) {
  return (
    <div className="loading-state" role="status" aria-label={label}>
      <span className="loading-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

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
  const [rentSharePercent, setRentSharePercent] = useState("30");
  const [observationResult, setObservationResult] =
    useState<ObservationResult | null>(null);
  const [observationError, setObservationError] =
    useState<ObservationError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getJson<Catalog>("/api/catalog/", controller.signal)
      .then((data) => {
        setCatalog(data);
        const selection = defaultHousingSelection(data);
        setGeographyId(selection.geography?.id ?? "");
        setIndicatorId(selection.indicator?.id ?? "");
        setSourceId(selection.source?.id ?? "");
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

  const selectedGeography = catalog?.geographies.find(
    (geography) => geography.id === geographyId,
  );
  const indicators = useMemo(
    () =>
      catalog
        ? indicatorsForGeography(
            indicatorsForTopic(catalog, topic),
            selectedGeography,
          )
        : [],
    [catalog, selectedGeography, topic],
  );
  const selectedIndicator = indicators.find(
    (indicator) => indicator.id === indicatorId,
  );
  const availableSources = catalog
    ? sourcesForSelection(catalog, selectedGeography, selectedIndicator)
    : [];

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

  const selectedSource = availableSources.find(
    (source) => source.id === sourceId,
  );

  const rentShareValue = Number(rentSharePercent);
  const hasValidRentShare =
    rentSharePercent.trim() !== "" &&
    Number.isFinite(rentShareValue) &&
    rentShareValue >= 0 &&
    rentShareValue <= 100;
  const monthlyRentBudget = calculateMonthlyRentBudget(
    annualIncome,
    rentSharePercent,
  );

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
                  Choose your household income and the share you want to spend on rent.
                </p>
              </div>
              <span className="section-stamp">YOUR<br />BUDGET</span>
            </div>
            <div className="budget-layout">
              <div className="budget-fields">
                <label>
                  <span className="budget-field-heading">
                    Annual household income (before tax)
                  </span>
                  <span className="budget-field-hint">
                    Before-tax household income for one year.
                  </span>
                  <span className="input-with-prefix">
                    <span aria-hidden="true">$</span>
                    <input
                      type="number"
                      min="1"
                      inputMode="decimal"
                      placeholder="e.g. 68,000"
                      value={annualIncome}
                      aria-label="Annual household income before tax in Canadian dollars"
                      onChange={(event) => setAnnualIncome(event.target.value)}
                    />
                    <span className="input-suffix">CAD / year</span>
                  </span>
                </label>
                <label>
                  <span className="budget-field-heading">Share of income for rent</span>
                  <span className="budget-field-hint">
                    Drag to choose a share from 0% to 100%.
                  </span>
                  <span className="rent-share-control">
                    <input
                      className="rent-share-slider"
                      type="range"
                      min="0"
                      max="100"
                      step="1"
                      aria-label="Share of annual household income to budget for rent"
                      aria-valuetext={`${rentSharePercent}%`}
                      aria-describedby="rent-share-range"
                      value={rentSharePercent}
                      style={{
                        "--range-progress": `${rentShareValue}%`,
                      } as CSSProperties}
                      onChange={(event) => setRentSharePercent(event.target.value)}
                    />
                    <output className="rent-share-value" aria-live="polite">
                      {rentSharePercent}%
                    </output>
                  </span>
                  <span className="range-hint" id="rent-share-range">
                    <span>0%</span><span>100%</span>
                  </span>
                </label>
              </div>
              <aside className="estimate-card" aria-live="polite">
                <span className="estimate-icon" aria-hidden="true">↗</span>
                <p className="estimate-label">YOUR ESTIMATED MONTHLY RENT BUDGET</p>
                {monthlyRentBudget !== null && (
                  <>
                    <output className="estimate-value" aria-label="Estimated monthly rent budget">
                      {new Intl.NumberFormat("en-CA", {
                        style: "currency",
                        currency: "CAD",
                        maximumFractionDigits: 0,
                      }).format(monthlyRentBudget)}
                      <span>monthly</span>
                    </output>
                    <p className="estimate-copy">
                      Your rent budget based on the income and share you chose.
                    </p>
                  </>
                )}
                {monthlyRentBudget === null && (
                  <>
                    <p className="estimate-value estimate-placeholder">
                      {annualIncome.trim() === ""
                        ? "Your estimate will appear here"
                        : "Check your entries"}
                    </p>
                    <p className="estimate-copy">
                      {hasValidRentShare
                        ? "Add your annual household income to see your monthly rent budget."
                        : "Enter a rent share from 0% to 100% and a positive annual income."}
                    </p>
                  </>
                )}
                <p className="estimate-footnote">
                  Planning estimate based on before-tax income—not a rent quote or an affordability decision.
                </p>
                {monthlyRentBudget !== null && (
                  <details className="calculation-details">
                    <summary>Show calculation</summary>
                    <p>
                      {new Intl.NumberFormat("en-CA", {
                        style: "currency",
                        currency: "CAD",
                        maximumFractionDigits: 0,
                      }).format(Number(annualIncome))}{" "}
                      × {rentSharePercent}% ÷ 12 months ={" "}
                      {new Intl.NumberFormat("en-CA", {
                        style: "currency",
                        currency: "CAD",
                        maximumFractionDigits: 0,
                      }).format(monthlyRentBudget)}{" "}
                      per month.
                    </p>
                  </details>
                )}
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
                    const nextIndicators = indicatorsForGeography(
                      indicatorsForTopic(catalog, nextTopic),
                      selectedGeography,
                    );
                    const nextIndicator = selectedGeography
                      ? preferredIndicator(nextIndicators, selectedGeography)
                      : nextIndicators[0];
                    const nextSources = sourcesForSelection(
                      catalog,
                      selectedGeography,
                      nextIndicator,
                    );
                    setTopic(nextTopic);
                    setIndicatorId(nextIndicator?.id ?? "");
                    setSourceId(nextSources[0]?.id ?? "");
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
                  onChange={(event) => {
                    const nextGeography = catalog.geographies.find(
                      (geography) => geography.id === event.target.value,
                    );
                    const nextIndicators = indicatorsForGeography(
                      indicatorsForTopic(catalog, topic),
                      nextGeography,
                    );
                    const nextIndicator =
                      nextIndicators.find((indicator) => indicator.id === indicatorId) ??
                      (nextGeography
                        ? preferredIndicator(nextIndicators, nextGeography)
                        : nextIndicators[0]);
                    const nextSources = sourcesForSelection(
                      catalog,
                      nextGeography,
                      nextIndicator,
                    );
                    setGeographyId(event.target.value);
                    setIndicatorId(nextIndicator?.id ?? "");
                    setSourceId(nextSources[0]?.id ?? "");
                  }}
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
                  onChange={(event) => {
                    const nextIndicator = indicators.find(
                      (indicator) => indicator.id === event.target.value,
                    );
                    const nextSources = sourcesForSelection(
                      catalog,
                      selectedGeography,
                      nextIndicator,
                    );
                    setIndicatorId(event.target.value);
                    setSourceId(nextSources[0]?.id ?? "");
                  }}
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
                  {availableSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {(catalog.sources.length === 0 ||
            catalog.geographies.length === 0 ||
            catalog.indicators.length === 0) ? (
              <p className="empty-state" role="status">
                No housing data is available in the database yet.
              </p>
            ) : indicators.length === 0 || availableSources.length === 0 ? (
              <p className="empty-state" role="status">
                No {topic === "rent" ? "rent" : topic === "income" ? "income" : "housing burden"} measures are available for this geography.
                Choose another geography or topic.
              </p>
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
                  <p className="empty-state" role="status">
                    No records are available for this measure, geography, and source release.
                    Try another selection.
                  </p>
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
