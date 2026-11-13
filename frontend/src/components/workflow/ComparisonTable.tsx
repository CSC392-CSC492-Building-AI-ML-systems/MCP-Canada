"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { measuredNumber, money } from "../explorer/NeighbourhoodDetailsPanel";
import type { NeighbourhoodProfile } from "../explorer/types";
import type { SearchProfile } from "./state";
import styles from "./workflow.module.css";

const ComparisonMap = dynamic(() => import("../map/ComparisonMap"), {
  ssr: false, loading: () => <div style={{ height: 180 }} role="status">Loading map…</div>,
});

export function ComparisonTable({ profiles, preferences }: { profiles: NeighbourhoodProfile[]; preferences: SearchProfile | null }) {
  const costs = profiles.map(p => measuredNumber(p.metrics.cost));
  const cheapest = Math.min(...costs.filter((n): n is number => n !== null));
  const show = (p: NeighbourhoodProfile, key: "cost" | "income" | "burden") => {
    const m = p.metrics[key]; const n = measuredNumber(m);
    return n === null ? "—" : m.unit?.startsWith("CAD") ? money(n) : m.unit === "percent" ? `${n.toFixed(1)}%` : n.toLocaleString("en-CA");
  };
  return <div className={styles.tableScroll}><table className={styles.compareTable} style={{ minWidth: 220 + profiles.length * 272 }}><caption className={styles.srOnly}>Neighbourhoods compared for one shared Census year and boundary set</caption><thead><tr><th scope="col">{profiles[0]?.year} snapshot</th>{profiles.map(p => <th key={p.geography.id} scope="col">
    <ComparisonMap geographyId={p.geography.id} boundarySetId={p.geography.boundary_set} name={p.geography.name} /><Link href={`/housing/?neighbourhood=${encodeURIComponent(p.geography.id)}&year=${p.year}`}>{p.geography.name}</Link><small>Toronto · {p.year} Census<br />Live map · present-day basemap</small></th>)}</tr></thead><tbody>
    <tr><th scope="row">Overall match score</th>{profiles.map(p => <td key={p.geography.id}>—</td>)}</tr>
    <tr><th scope="row">Renter shelter / month</th>{profiles.map((p, i) => <td key={p.geography.id} className={costs[i] !== null && costs[i] === cheapest ? styles.best : undefined}>{show(p, "cost")}</td>)}</tr>
    <tr><th scope="row">Published household income / year</th>{profiles.map(p => <td key={p.geography.id}>{show(p, "income")}</td>)}</tr>
    <tr><th scope="row">Share of your entered income</th>{profiles.map((p, i) => <td key={p.geography.id}>{costs[i] !== null && preferences?.income && Number(preferences.income) > 0 ? `${(costs[i]! / (Number(preferences.income) / 12) * 100).toFixed(1)}%` : "—"}</td>)}</tr>
    <tr><th scope="row">Within your rent budget</th>{profiles.map((p, i) => <td key={p.geography.id}>{costs[i] !== null && preferences ? costs[i]! <= Number(preferences.rent) ? "Yes" : "No" : "—"}</td>)}</tr>
    <tr><th scope="row">Published housing burden{profiles[0]?.metrics.burden.unit === "households" ? " (households)" : " (%)"}</th>{profiles.map(p => <td key={p.geography.id}>{show(p, "burden")}</td>)}</tr>
    {["To work", "To school", "Schools within 1 km", "Nearest grocery", "Transit stops within 1 km", "Parks within 1 km", "Safety", "Lifestyle match"].map(label => <tr key={label}><th scope="row">{label}</th>{profiles.map(p => <td key={p.geography.id}>—</td>)}</tr>)}
    <tr><th scope="row">Data gaps</th>{profiles.map(p => <td key={p.geography.id}>Commute, amenities, safety, lifestyle{measuredNumber(p.metrics.cost) === null ? ", shelter cost" : ""}</td>)}</tr>
  </tbody></table></div>;
}
