"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { formatDistance, placeText, type AmenityCategory } from "@/lib/amenities";
import { readNearby, subscribeNearby, type NearbySnapshot } from "@/lib/nearbyStore";
import { affordability } from "./affordability";
import type { Measurement, NeighbourhoodProfile } from "./types";
import styles from "./explorer.module.css";

export const money = (n: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(n);
export function measuredNumber(m: Measurement): number | null {
  if (m.status !== "observed" || m.value === null || !Number.isFinite(Number(m.value))) return null;
  return Number(m.value);
}
function display(m: Measurement) {
  const n = measuredNumber(m);
  return n === null ? "—" : m.unit?.startsWith("CAD") ? money(n) : m.unit === "percent" ? `${n.toFixed(1)}%` : n.toLocaleString("en-CA");
}
function SourceNote({ measurement }: { measurement: Measurement }) {
  return measurement.source ? <span className={styles.sourceCaption}>{measurement.source.publisher} · {measurement.reference_year}</span> : null;
}

export function NeighbourhoodDetailsPanel({ profile, income, budget, onIncomeChange, onBudgetChange, onCompare, saved, limitReached, onAskTeacher }: {
  profile: NeighbourhoodProfile;
  income: string; budget: string;
  onIncomeChange: (value: string) => void; onBudgetChange: (value: string) => void;
  onCompare?: () => void; saved?: boolean; limitReached?: boolean; onAskTeacher?: () => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [profile.geography.id]);
  const { cost, income: householdIncome, burden } = profile.metrics;
  const costValue = measuredNumber(cost);
  const result = affordability(costValue, income, budget);
  const sources = [...new Map(Object.values(profile.metrics).filter(m => m.source).map(m => [m.source!.id, m.source!])).values()];
  const historical = profile.geography.boundary_set === "toronto-140";
  const historyMax = Math.max(1, ...profile.history.map(h => measuredNumber(h.cost) ?? 0));
  const explanation = costValue === null ? `Renter shelter cost is unavailable for this neighbourhood in ${profile.year}. It is excluded from your affordability check.` :
    result.incomeShare === null ? `The published ${profile.year} renter shelter cost is ${money(costValue)} per month. Enter income to check its share of your household budget.` :
    `The ${profile.year} shelter-cost benchmark would use ${result.incomeShare.toFixed(1)}% of the annual income you entered.${result.withinBudget === null ? "" : result.withinBudget ? " It is within your stated monthly budget." : " It exceeds your stated monthly budget."}`;
  return <aside className={styles.detailsPanel} aria-labelledby="neighbourhood-name">
    <div className={styles.panelScroll} ref={scroll}>
      <header className={styles.neighbourhoodHeading}><div><p className={styles.kicker}>TORONTO · {historical ? "HISTORICAL 140" : "CURRENT 158"}</p><h1 id="neighbourhood-name">{profile.geography.name}</h1><p className={styles.caption}>{profile.year} Census · Neighbourhood {profile.geography.code}</p></div><div className={styles.scoreBadge} aria-label="Overall match score not available"><strong>—</strong><span>/ 100</span></div></header>
      <section className={styles.explanation}><h2><span aria-hidden="true">✦</span> Your affordability snapshot</h2><p>{explanation}</p><p className={styles.caption}>Overall match score is unavailable. Commute, safety, amenity access and lifestyle factors are not scored.</p></section>
      <div className={styles.quickStats}>
        {[['Shelter / mo.', display(cost)], ['Income share', result.incomeShare === null ? '—' : `${result.incomeShare.toFixed(1)}%`], ['To work', '—'], ['To school', '—']].map(([label,value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
      </div>
      <section className={styles.panelSection}><h2>Score breakdown</h2><p className={styles.caption}>Shared match scores are not available yet.</p>
        {['Affordability', 'Commute to work', 'School distance', 'Nearby amenities', 'Safety', 'Lifestyle match'].map(label => <div className={styles.scoreRow} key={label}><div><span>{label}</span><span>Not scored</span></div><span className={styles.scoreTrack} /></div>)}
      </section>
      <EverydayNeeds geographyId={profile.geography.id} />
      <section className={styles.missingNotice}><h2>Missing data</h2><p>A dash means unavailable, never zero. Commute times, safety and overall scores are not available. {costValue === null && `${profile.year} housing costs are unavailable here. `}Current amenity records are not evidence of past services.</p></section>
      <section className={styles.contextCard}><h2>Historical context</h2><p className={styles.kicker}>TIME LENS · {profile.year} CENSUS</p><p>How did housing costs and household income shape everyday life here?</p><p className={styles.caption}>No verified historical accounts linked. This is an inquiry prompt, not an explanation of what caused change.</p></section>
      <section className={styles.panelSection} aria-labelledby="housing-title">
        <div className={styles.sectionHeading}><h2 id="housing-title">Housing &amp; affordability</h2><span className={styles.smallPill}>{profile.year}</span></div>
        <p className={styles.caption}>Published neighbourhood data · nominal dollars</p>
        <dl className={styles.measurements}>
          <div><dt>{cost.statistic === "median" ? "Median renter shelter cost" : profile.year < 2011 ? "Average gross rent" : "Average renter shelter cost"}<SourceNote measurement={cost} /></dt><dd>{display(cost)}<small>/ month</small></dd></div>
          <div><dt>Median household income<SourceNote measurement={householdIncome} /></dt><dd>{display(householdIncome)}<small>/ year</small></dd></div>
          <div><dt>{burden.unit === "households" ? "Households spending ≥30% on rent" : "Renters spending ≥30% on shelter"}<SourceNote measurement={burden} /></dt><dd>{display(burden)}</dd></div>
        </dl>
        <p className={styles.caption}>Shelter costs include applicable utilities. This is a Census benchmark across rented dwellings, not an advertised rent.</p>
      </section>
      <section className={styles.budgetBox} aria-labelledby="budget-title"><h2 id="budget-title">Try your own budget</h2><p className={styles.caption}>Before-tax household income · stays in this page</p>
        <label htmlFor="annual-income">Annual household income ($)<input id="annual-income" type="number" min="1" step="any" inputMode="decimal" placeholder="e.g. 72000" value={income} aria-invalid={!!result.incomeError} aria-describedby={result.incomeError ? 'income-error' : undefined} onChange={e => onIncomeChange(e.target.value)} /></label>
        {result.incomeError && <p id="income-error" className={styles.validation}>{result.incomeError}</p>}
        <label htmlFor="rent-budget">Monthly housing budget ($)<input id="rent-budget" type="number" min="0" step="any" inputMode="decimal" placeholder="e.g. 1800" value={budget} aria-invalid={!!result.budgetError} aria-describedby={result.budgetError ? 'budget-error' : undefined} onChange={e => onBudgetChange(e.target.value)} /></label>
        {result.budgetError && <p id="budget-error" className={styles.validation}>{result.budgetError}</p>}
        <div className={styles.budgetResult} aria-live="polite"><span>30% income guideline</span><strong>{result.monthlyLimit === null ? '—' : `${money(result.monthlyLimit)} / mo.`}</strong></div>
        <p className={styles.caption}>{result.meetsGuideline === null ? 'Enter income to compare the published housing cost with the 30% guideline.' : result.meetsGuideline ? 'The selected benchmark is at or below 30% of your entered income.' : 'The selected benchmark exceeds 30% of your entered income.'} This is a budget illustration, not the published housing-burden rate above.</p>
        {costValue !== null && result.incomeShare !== null && <p className={styles.caption}>You are comparing a {profile.year} cost with the income you enter. Use a matching income period for a historical budget check.</p>}
      </section>
      <section className={styles.panelSection} aria-labelledby="history-title"><h2 id="history-title">Housing through time</h2><p className={styles.caption}>Same neighbourhood boundary in every year · no filled gaps</p>
        <div className={styles.historyBars}>{profile.history.map(h => { const value = measuredNumber(h.cost); return <div key={h.year} aria-label={`${h.year}: ${value === null ? 'unavailable' : money(value)}`}><span>{h.year}</span><span className={styles.historyTrack}>{value !== null && <span style={{ width: `${value / historyMax * 100}%` }} />}</span><strong>{value === null ? '—' : money(value)}</strong></div>; })}</div>
        <p className={styles.caption}>Average renter shelter cost in every year (called gross rent in 2001 and 2006); the 2016 neighbourhood profile does not publish it. Dollars are nominal. Use “Compare this location across time” to see the change.</p>{profile.boundary_note && <p className={styles.caption}>{profile.boundary_note}</p>}
      </section>
      <section className={styles.panelSection}><h2>Sources and method</h2><p className={styles.verifiedTag}>PUBLISHED DATA · SOURCE YEARS SHOWN</p>
        {sources.map(source => <div className={styles.sourceItem} key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><p>{source.publisher}</p><p>{source.coverage}</p></div>)}
        <details><summary>Definitions, periods &amp; calculations</summary><p>{profile.method.housing}</p><p>{profile.method.income}</p><p>Personal income share = monthly shelter cost ÷ (entered annual income ÷ 12) × 100. The guideline uses 30% of before-tax income and is not an overall match score.</p><p>{profile.method.inflation}</p><p>{profile.method.comparison}</p><p>{profile.method.release_selection}</p>
          {Object.entries(profile.metrics).map(([key,m]) => <p key={key}><strong>{key}</strong>: {m.label ?? 'Not available'} · {m.status}{m.source && <> · Census {m.census_year}; reference {m.reference_year} · {m.source_locator} · release {m.source.id}</>}</p>)}
        </details>
      </section>
      <p className={styles.caption}>Scroll to explore all neighbourhood details ↑</p>
    </div>
    <footer className={styles.panelActions}><button type="button" className={styles.primaryButton} onClick={onCompare} disabled={!onCompare || saved || limitReached}>{saved ? 'Added to compare ✓' : limitReached ? '5 places saved' : 'Add to compare'}</button><button type="button" className={styles.secondaryButton} onClick={onAskTeacher} disabled={!onAskTeacher} title={!onAskTeacher ? 'AI teacher is not connected yet' : undefined}>Ask the AI teacher</button></footer>
  </aside>;
}

const NEEDS: [AmenityCategory | "park", string][] = [["school", "Schools"], ["grocery", "Groceries"], ["transit_stop", "Transit stops"], ["library", "Libraries"], ["park", "Parks"]];
/** Nearest present-day places, as calculated by the map for this same neighbourhood. */
function EverydayNeeds({ geographyId }: { geographyId: string }) {
  const snapshot = useSyncExternalStore(subscribeNearby, readNearby, () => null);
  return <EverydayNeedsTable geographyId={geographyId} snapshot={snapshot} />;
}
/** Shows the snapshot only when it is for this neighbourhood, so a stale one never appears. */
export function EverydayNeedsTable({ geographyId, snapshot }: { geographyId: string; snapshot: NearbySnapshot }) {
  const nearby = snapshot?.geographyId === geographyId ? snapshot : null;
  const caption = nearby
    ? `Present-day locations${nearby.asOf ? ` as of ${nearby.asOf}` : ""}, not historical. Walks start from ${nearby.originLabel}. ${nearby.routed
      ? "Nearest and Walk follow streets and paths (Mapbox walking routes; parks to their nearest edge)."
      : "Street routes are unavailable, so Nearest and Walk are straight-line estimates (~)."} “≤ 1 km” counts places within 1 km in a straight line.`
    : "Nearby distances appear once the map has loaded this neighbourhood.";
  return <section className={styles.panelSection}><h2>Everyday needs</h2><table className={styles.needsTable}><caption>{caption}</caption>
    <thead><tr><th>Amenity</th><th>≤ 1 km</th><th>Nearest</th><th>Walk</th></tr></thead>
    <tbody>{NEEDS.map(([category, name]) => {
      const s = nearby ? nearby.summaries[category] : null;
      const why = !s ? "Not calculated yet" : s.state === "loading" ? "Loading" : s.state === "error" ? s.message
        : s.state === "not_loaded" ? "Not loaded in this database" : !s.nearest ? "None nearby" : undefined;
      const ok = s?.state === "ok" ? s : null;
      return <tr key={name} title={why}><th scope="row">{name}</th>
        <td>{ok ? ok.within : "—"}</td>
        <td title={ok?.nearest ? `${ok.nearest.name}${ok.nearest.estimated ? " (straight-line estimate)" : " (by street)"}` : undefined}>
          {!ok?.nearest ? "—" : !ok.nearest.estimated && ok.nearest.metres === 0 ? "Inside" : `${ok.nearest.estimated ? "~" : ""}${formatDistance(ok.nearest.metres)}`}</td>
        <td>{!ok?.nearest ? "—" : `${ok.nearest.estimated ? "~" : ""}${ok.nearest.minutes} min`}</td></tr>;
    })}</tbody></table>
    {nearby && NEEDS.some(([category]) => { const s = nearby.summaries[category]; return s.state === "ok" && s.ranked.length > 0; }) && <details className={styles.closestWalks}>
      <summary>Closest walks for each</summary>
      {NEEDS.map(([category, name]) => { const s = nearby.summaries[category];
        return s.state === "ok" && s.ranked.length > 0 && <div key={category}><h3>{name}</h3>
          <ol>{s.ranked.slice(0, 3).map(p => <li key={`${p.name}|${p.straightMetres}`}><span>{p.name}</span><span>{placeText(p)}</span></li>)}</ol></div>; })}
    </details>}
    {nearby && Object.values(nearby.summaries).some(s => s.state === "not_loaded") && <p className={styles.caption}>Some lists are not loaded in this database yet; their rows show a dash, not zero.</p>}
  </section>;
}
