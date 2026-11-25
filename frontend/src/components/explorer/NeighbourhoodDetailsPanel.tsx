"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { loadComparisonExtras, type ComparisonExtras } from "../workflow/comparison-extras";
import { tripMinutes, useCommutes } from "../workflow/commutes";
import { explainScore, FACTORS, scoreBreakdown, screenScore, type Factor } from "../workflow/scoring";
import { useTeacherScores } from "../workflow/Teacher";
import { PROFILE_KEY, parseProfile, readSession, subscribeSession } from "../workflow/state";
import { TripValue, tripNote } from "../workflow/TripCells";
import { affordability } from "./affordability";
import type { Catalog } from "./data";
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

/** One row of the score breakdown: a number and bar when scored, otherwise why it is left out. */
function FactorRow({ factor }: { factor: Factor }) {
  const value = factor.status === "scored" ? `${factor.score} / 100` : factor.status === "off" ? "Off · weight 0" : "Unavailable";
  const note = factor.status === "scored" ? factor.detail : factor.status === "unavailable" ? `${factor.reason}. Left out of the score.` : null;
  return <div className={styles.scoreRow}>
    <div><span>{factor.label}{factor.status !== "off" && ` · weight ${factor.weight}`}</span><span>{value}</span></div>
    <span className={styles.scoreTrack}>{factor.status === "scored" && <span style={{ width: `${factor.score}%` }} />}</span>
    {note && <p className={styles.caption}>{note}</p>}
  </div>;
}

export function NeighbourhoodDetailsPanel({ profile, catalog, onCompare, saved, limitReached, onAskTeacher }: {
  profile: NeighbourhoodProfile;
  /** Needed to rank this place against all neighbourhoods for its match score. */
  catalog?: Catalog | null;
  onCompare?: () => void; saved?: boolean; limitReached?: boolean; onAskTeacher?: () => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }); }, [profile.geography.id]);
  const { cost, income: householdIncome, burden } = profile.metrics;
  const costValue = measuredNumber(cost);
  const sources = [...new Map(Object.values(profile.metrics).filter(m => m.source).map(m => [m.source!.id, m.source!])).values()];
  const historical = profile.geography.boundary_set === "toronto-140";
  const rawPreferences = useSyncExternalStore(subscribeSession, () => readSession(PROFILE_KEY), () => null);
  const preferences = useMemo(() => parseProfile(rawPreferences), [rawPreferences]);
  // Uses the same income and rent budget as the match score, so the two always agree.
  const result = affordability(costValue, preferences?.income ?? "", preferences?.rent ?? "");
  const commutePlaces = useMemo(() => [{ id: profile.geography.id, boundarySetId: profile.geography.boundary_set }], [profile.geography.id, profile.geography.boundary_set]);
  const commutes = useCommutes(commutePlaces, preferences);
  // Ranks, safety and lifestyle data for this place, ranked against every neighbourhood in its boundary set,
  // so the score matches what the comparison table and recommendations show for the same place.
  const extrasKey = `${profile.geography.id}:${profile.year}`;
  const [extras, setExtras] = useState<{ key: string; value: ComparisonExtras | null } | null>(null);
  useEffect(() => {
    if (!catalog) return;
    const abort = new AbortController();
    loadComparisonExtras(catalog, [profile], profile.year, abort.signal)
      .then(value => { if (!abort.signal.aborted) setExtras({ key: extrasKey, value }); })
      .catch(() => { if (!abort.signal.aborted) setExtras({ key: extrasKey, value: null }); });
    return () => abort.abort();
    // `extrasKey` captures the place and year.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, extrasKey]);
  const placeExtras = extras?.key === extrasKey ? extras.value?.byPlace[profile.geography.id] : undefined;
  const extrasLoading = !!catalog && extras?.key !== extrasKey;
  const breakdown = extrasLoading ? null : scoreBreakdown(costValue, placeExtras, preferences, {
    work: tripMinutes(commutes.work, profile.geography.id), school: tripMinutes(commutes.school, profile.geography.id),
  });
  const why = breakdown ? explainScore(breakdown) : [];
  useTeacherScores(breakdown && preferences ? [screenScore(profile.geography.name, breakdown)] : null);
  const historyMax =Math.max(1, ...profile.history.map(h => measuredNumber(h.cost) ?? 0));
  const explanation = costValue === null ? `Renter shelter cost is unavailable for this neighbourhood in ${profile.year}. It is excluded from your affordability check.` :
    !preferences ? `The published ${profile.year} renter shelter cost is ${money(costValue)} per month. Complete your profile with your income and rent budget to see how it fits.` :
    `The published ${profile.year} renter shelter cost is ${money(costValue)} per month${result.withinBudget === null ? "" : result.withinBudget ? `, within your rent budget of ${money(Number(preferences.rent))}` : `, over your rent budget of ${money(Number(preferences.rent))}`}. ` +
    (result.incomeShare === null ? "Add your yearly income in your profile to see its share of your income."
      : `That is ${result.incomeShare.toFixed(1)}% of your monthly income (the yearly income in your profile ÷ 12); the guideline is 30% or less.`) +
    (profile.year !== 2021 && result.incomeShare !== null ? ` This compares a ${profile.year} cost with today's income.` : "");
  return <aside className={styles.detailsPanel} aria-labelledby="neighbourhood-name">
    <div className={styles.panelScroll} ref={scroll}>
      <header className={styles.neighbourhoodHeading}><div><p className={styles.kicker}>TORONTO · {historical ? "HISTORICAL 140" : "CURRENT 158"}</p><h1 id="neighbourhood-name">{profile.geography.name}</h1><p className={styles.caption}>{profile.year} Census · Neighbourhood {profile.geography.code}</p></div><div className={styles.scoreBadge} aria-label={breakdown?.score != null ? `Match score ${breakdown.score} out of 100` : "Match score not available"}><strong>{breakdown?.score ?? "—"}</strong><span>/ 100</span></div></header>
      <section className={styles.explanation}><h2><span aria-hidden="true">✦</span> Your affordability snapshot</h2><p>{explanation}</p></section>
      <section className={styles.explanation} aria-labelledby="why-score"><h2 id="why-score"><span aria-hidden="true">✦</span> Why this score</h2>
        {!preferences ? <p>Complete your profile to see how well this neighbourhood matches your budget, trips and priorities.</p>
          : extrasLoading ? <p role="status">Working out the match score…</p>
          : <ul>{why.map(line => <li key={line}>{line}</li>)}</ul>}
      </section>
      <div className={styles.quickStats}>
        {[['Shelter / mo.', display(cost)], ['Income share', result.incomeShare === null ? '—' : `${result.incomeShare.toFixed(1)}%`]].map(([label,value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        {(['work', 'school'] as const).map(trip => <div key={trip}><span>To {trip}</span><strong><TripValue state={commutes[trip]} id={profile.geography.id} /></strong></div>)}
      </div>
      {(['work', 'school'] as const).some(trip => commutes[trip].status !== 'no-destination') || preferences
        ? <p className={styles.tripNote}>{(['work', 'school'] as const).map(trip => `To ${trip}${preferences ? ` (${preferences.mode.toLowerCase()})` : ''}: ${tripNote(trip, commutes[trip])}.`).join(' ')}</p>
        : <p className={styles.tripNote}>Add work or school addresses in your profile to see travel times.</p>}
      <section className={styles.panelSection}><h2>Score breakdown</h2>
        <p className={styles.caption}>{breakdown && breakdown.coverage.weighted
          ? `Based on ${breakdown.coverage.used} of the ${breakdown.coverage.weighted} factors you weighted. Factors without data are left out and the others share their weight; nothing is counted as zero.`
          : "Each factor is scored 0–100 and weighted by your profile."}</p>
        {breakdown ? breakdown.factors.map(f => <FactorRow key={f.key} factor={f} />)
          : FACTORS.map(f => <div className={styles.scoreRow} key={f.key}><div><span>{f.label}</span><span>{preferences ? "…" : "No profile"}</span></div><span className={styles.scoreTrack} /></div>)}
        {breakdown && <details><summary>How each factor is scored</summary>{FACTORS.map(f => <p key={f.key}><strong>{f.label}</strong>: {f.method}</p>)}</details>}
      </section>
      <section className={styles.panelSection}><h2>Everyday needs</h2><table className={styles.needsTable}><caption>Nearby distances have not been calculated.</caption><thead><tr><th>Amenity</th><th>≤ 1 km</th><th>Nearest</th><th>Walk</th></tr></thead><tbody>{['Schools', 'Groceries', 'Transit stops', 'Parks'].map(name => <tr key={name}><th scope="row">{name}</th><td>—</td><td>—</td><td>—</td></tr>)}</tbody></table></section>
      <section className={styles.missingNotice}><h2>Missing data</h2><p>A dash means unavailable, never zero. Nearby distances are not calculated here, and factors without data are left out of the match score. Travel times are present-day and start from a central point in the neighbourhood. {costValue === null && `${profile.year} housing costs are unavailable here. `}Current amenity records are not evidence of past services.</p></section>
      <section className={styles.contextCard}><h2>Historical context</h2><p className={styles.kicker}>TIME LENS · {profile.year} CENSUS</p><p>How did housing costs and household income shape everyday life here?</p><p className={styles.caption}>No verified historical accounts linked. This is an inquiry prompt, not an explanation of what caused change.</p></section>
      <section className={styles.panelSection} aria-labelledby="housing-title">
        <div className={styles.sectionHeading}><h2 id="housing-title">Housing &amp; affordability</h2><span className={styles.smallPill}>{profile.year}</span></div>
        <p className={styles.caption}>Published neighbourhood data · nominal dollars</p>
        <dl className={styles.measurements}>
          <div><dt>{cost.statistic === "average" ? "Average gross rent" : "Median renter shelter cost"}<SourceNote measurement={cost} /></dt><dd>{display(cost)}<small>/ month</small></dd></div>
          <div><dt>Median household income<SourceNote measurement={householdIncome} /></dt><dd>{display(householdIncome)}<small>/ year</small></dd></div>
          <div><dt>{burden.unit === "households" ? "Households spending ≥30% on rent" : "Renters spending ≥30% on shelter"}<SourceNote measurement={burden} /></dt><dd>{display(burden)}</dd></div>
        </dl>
        <p className={styles.caption}>Shelter costs include applicable utilities. This is a Census benchmark across rented dwellings, not an advertised rent.</p>
      </section>
      <section className={styles.panelSection} aria-labelledby="history-title"><h2 id="history-title">Housing through time</h2><p className={styles.caption}>Same {historical ? '140' : '158'} boundary set · no filled gaps</p>
        <div className={styles.historyBars}>{profile.history.map(h => { const value = measuredNumber(h.cost); return <div key={h.year} aria-label={`${h.year}: ${value === null ? 'unavailable' : money(value)}`}><span>{h.year}</span><span className={styles.historyTrack}>{value !== null && <span style={{ width: `${value / historyMax * 100}%` }} />}</span><strong>{value === null ? '—' : money(value)}</strong></div>; })}</div>
        <p className={styles.caption}>Earlier records use average gross rent; 2011 and 2021 use median renter shelter costs. No change percentage is calculated across different definitions or boundaries.</p>
      </section>
      <section className={styles.panelSection}><h2>Sources and method</h2><p className={styles.verifiedTag}>PUBLISHED DATA · SOURCE YEARS SHOWN</p>
        {sources.map(source => <div className={styles.sourceItem} key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><p>{source.publisher}</p><p>{source.coverage}</p></div>)}
        <details><summary>Definitions, periods &amp; calculations</summary><p>{profile.method.housing}</p><p>{profile.method.income}</p><p>Personal income share = monthly shelter cost ÷ (yearly income in your profile ÷ 12) × 100. The guideline uses 30% of before-tax income and is not an overall match score.</p><p>{profile.method.inflation}</p><p>{profile.method.comparison}</p><p>{profile.method.release_selection}</p>
          {Object.entries(profile.metrics).map(([key,m]) => <p key={key}><strong>{key}</strong>: {m.label ?? 'Not available'} · {m.status}{m.source && <> · Census {m.census_year}; reference {m.reference_year} · {m.source_locator} · release {m.source.id}</>}</p>)}
        </details>
      </section>
      <p className={styles.caption}>Scroll to explore all neighbourhood details ↑</p>
    </div>
    <footer className={styles.panelActions}><button type="button" className={styles.primaryButton} onClick={onCompare} disabled={!onCompare || saved || limitReached}>{saved ? 'Added to compare ✓' : limitReached ? '5 places saved' : 'Add to compare'}</button><button type="button" className={styles.secondaryButton} onClick={onAskTeacher} disabled={!onAskTeacher} title={!onAskTeacher ? 'AI teacher is not connected yet' : undefined}>Ask the AI teacher</button></footer>
  </aside>;
}
