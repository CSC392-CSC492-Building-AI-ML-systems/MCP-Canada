"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { measuredNumber, money } from "../explorer/NeighbourhoodDetailsPanel";
import type { NeighbourhoodProfile } from "../explorer/types";
import type { SearchProfile } from "./state";
import { lifestyleMatch, matchScore, type ComparisonExtras, type NearbyCategory, type PlaceExtras } from "./comparison-extras";
import styles from "./workflow.module.css";

const ComparisonMap = dynamic(() => import("../map/ComparisonMap"), {
  ssr: false, loading: () => <div style={{ height: 180 }} role="status">Loading map…</div>,
});

const nearbyRows: [keyof Pick<PlaceExtras, "libraries" | "schools" | "groceries" | "transitStops">, string, string, NearbyCategory][] = [
  ["libraries", "Libraries within 1 km", "Current branch list", "library"],
  ["schools", "Schools within 1 km", "City school list, all types", "school"],
  ["groceries", "Supermarkets & grocers within 1 km", "OpenStreetMap; convenience stores excluded", "grocery"],
  ["transitStops", "Transit stops within 1 km", "TTC schedule feed; each platform or direction counts", "transit_stop"],
];

export function ComparisonTable({ profiles, preferences, extras }: { profiles: NeighbourhoodProfile[]; preferences: SearchProfile | null; extras: ComparisonExtras | null }) {
  const costs = profiles.map(p => measuredNumber(p.metrics.cost));
  const cheapest = Math.min(...costs.filter((n): n is number => n !== null));
  const show = (p: NeighbourhoodProfile, key: "cost" | "income" | "burden") => {
    const m = p.metrics[key]; const n = measuredNumber(m);
    return n === null ? "—" : m.unit?.startsWith("CAD") ? money(n) : m.unit === "percent" ? `${n.toFixed(1)}%` : n.toLocaleString("en-CA");
  };
  const num = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString("en-CA");
  const pct = (n: number | null | undefined) => n == null ? "—" : `${n.toFixed(1)}%`;
  return <div className={styles.tableScroll}><table className={styles.compareTable} style={{ minWidth: 220 + profiles.length * 272 }}><caption className={styles.srOnly}>Neighbourhoods compared for one shared Census year and boundary set</caption><thead><tr><th scope="col">{profiles[0]?.year} snapshot</th>{profiles.map(p => <th key={p.geography.id} scope="col">
    <ComparisonMap geographyId={p.geography.id} boundarySetId={p.geography.boundary_set} name={p.geography.name} /><Link href={`/housing/?neighbourhood=${encodeURIComponent(p.data_geography?.id ?? p.geography.id)}&year=${p.year}`}>{p.geography.name}</Link><small>Toronto · {p.year} Census<br />Live map · present-day basemap</small></th>)}</tr></thead><tbody>
    <tr><th scope="row">Partial match score<small>Only factors with data, weighted by your profile</small></th>{profiles.map((p, i) => { const m = extras ? matchScore(costs[i], extras.byPlace[p.geography.id], preferences) : null;
      return <td key={p.geography.id}>{m ? <>{m.score} / 100<small>Covers {m.covers.join(" & ")}</small></> : extras ? "—" : "…"}</td>; })}</tr>
    <tr><th scope="row">Renter shelter / month</th>{profiles.map((p, i) => <td key={p.geography.id} className={costs[i] !== null && costs[i] === cheapest ? styles.best : undefined}>{show(p, "cost")}</td>)}</tr>
    <tr><th scope="row">Published household income / year</th>{profiles.map(p => <td key={p.geography.id}>{show(p, "income")}</td>)}</tr>
    <tr><th scope="row">Share of your entered income</th>{profiles.map((p, i) => <td key={p.geography.id}>{costs[i] !== null && preferences?.income && Number(preferences.income) > 0 ? `${(costs[i]! / (Number(preferences.income) / 12) * 100).toFixed(1)}%` : "—"}</td>)}</tr>
    <tr><th scope="row">Within your rent budget</th>{profiles.map((p, i) => <td key={p.geography.id}>{costs[i] !== null && preferences ? costs[i]! <= Number(preferences.rent) ? "Yes" : "No" : "—"}</td>)}</tr>
    <tr><th scope="row">Toronto average rent, {extras?.cityRent?.label ?? "your bedrooms"}<small>CMHC, Toronto-wide (not by neighbourhood){extras?.cityRent ? ` · ${extras.cityRent.period}` : ""}</small></th>{profiles.map(p => <td key={p.geography.id}>{extras?.cityRent ? <>{money(extras.cityRent.value)}{preferences && Number(preferences.rent) > 0 && <small>{extras.cityRent.value <= Number(preferences.rent) ? "Within" : "Above"} your budget</small>}</> : "—"}</td>)}</tr>
    <tr><th scope="row">Published housing burden{profiles.find(p => p.metrics.burden.unit)?.metrics.burden.unit === "households" ? " (households)" : " (%)"}</th>{profiles.map(p => <td key={p.geography.id}>{show(p, "burden")}</td>)}</tr>
    <tr><th scope="row">Population</th>{profiles.map(p => <td key={p.geography.id}>{num(extras?.byPlace[p.geography.id]?.population)}</td>)}</tr>
    <tr><th scope="row">Children (0–14)</th>{profiles.map(p => <td key={p.geography.id}>{pct(extras?.byPlace[p.geography.id]?.childrenPct)}</td>)}</tr>
    <tr><th scope="row">Seniors (65+)</th>{profiles.map(p => <td key={p.geography.id}>{pct(extras?.byPlace[p.geography.id]?.seniorsPct)}</td>)}</tr>
    {(["To work", "To school"] as const).map(label => <tr key={label}><th scope="row">{label}<small>Needs address routing, not available yet</small></th>{profiles.map(p => <td key={p.geography.id}>—</td>)}</tr>)}
    {nearbyRows.map(([key, label, note, category]) => <tr key={key}><th scope="row">{label}<small>{note}{extras?.asOf[category] ? ` · ${extras.asOf[category]}` : ""}, not historical</small></th>{profiles.map(p => { const place = extras?.byPlace[p.geography.id]; const r = place?.ranks?.[key];
      return <td key={p.geography.id}>{extras ? <>{num(place?.[key])}{r != null && <small>Denser than about {r}% of {p.geography.boundary_set === "toronto-140" ? "the 140" : "the 158"} neighbourhoods</small>}</> : "…"}</td>; })}</tr>)}
    <tr><th scope="row">Parks within 1 km<small>City Green Spaces{extras?.asOf.park ? ` · ${extras.asOf.park}` : ""}, current, not historical · green space as share of area</small></th>{profiles.map(p => { const place = extras?.byPlace[p.geography.id];
      return <td key={p.geography.id}>{!extras ? "…" : place?.parks == null ? "—" : <>{num(place.parks)}{place.greenSharePct != null && <small>{place.greenSharePct.toFixed(1)}% of the area is green space</small>}</>}</td>; })}</tr>
    <tr><th scope="row">Safety: reported major crime<small>Per 100,000 residents · Toronto Police; assault, auto theft, break and enter, robbery, theft over $5,000</small></th>{profiles.map(p => { const place = extras?.byPlace[p.geography.id]; const s = place?.safety;
      return <td key={p.geography.id}>{s ? <>{Math.round(s.rate).toLocaleString("en-CA")}<small>Lower than {s.saferThanPct}% of Toronto neighbourhoods · {s.year} · median {Math.round(s.cityMedian).toLocaleString("en-CA")}</small></> : extras ? <>—{place?.safetyGap && <small>{place.safetyGap}</small>}</> : "…"}</td>; })}</tr>
    <tr><th scope="row">Lifestyle match<small>Your chosen lifestyle priorities that have data</small></th>{profiles.map(p => { const m = extras ? lifestyleMatch(extras.byPlace[p.geography.id], preferences?.priorities) : null;
      return <td key={p.geography.id}>{!extras ? "…" : !m ? <>—<small>Choose lifestyle priorities in your profile</small></> : <>{m.score === null ? "—" : `${m.score} / 100`}<small>{[m.scored.length ? `Scored: ${m.scored.join(", ")}` : "", m.unscored.length ? `Not scored (no data): ${m.unscored.join(", ")}` : ""].filter(Boolean).join(" · ")}</small></>}</td>; })}</tr>
    <tr><th scope="row">Data gaps</th>{profiles.map(p => { const place = extras?.byPlace[p.geography.id];
      const gaps = ["commute", ...(extras && place?.parks == null ? ["parks"] : []), ...(extras && lifestyleMatch(place, preferences?.priorities)?.score == null ? ["lifestyle"] : []), ...(extras && !place?.safety ? ["safety"] : []), ...nearbyRows.flatMap(([key, , , category]) => extras && place?.[key] == null ? [category.replace("_", " ") + "s"] : []), ...(measuredNumber(p.metrics.cost) === null ? ["shelter cost"] : [])];
      return <td key={p.geography.id}>{p.available_years.length === 0 ? `No ${p.year} Census data for this area (boundaries changed in 2021). ` : ""}{gaps.join(", ").replace(/^./, c => c.toUpperCase())}</td>; })}</tr>
  </tbody></table></div>;
}
