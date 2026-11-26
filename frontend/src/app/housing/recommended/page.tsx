"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { HousingExplorer } from "@/components/map/HousingExplorer";
import { loadWorkspaceData } from "@/components/explorer/data";
import type { ExplorerPlace } from "@/components/explorer/PlacesSidebar";
import { RECOMMENDED_KEY, readProfile, writeSession } from "@/components/workflow/state";
import { costById, rankByMatch, type Candidate } from "@/components/workflow/recommendations";
import { loadAllExtras, loadCostRows, loadTripTimes } from "@/components/workflow/recommendation-data";
import styles from "@/components/workflow/workflow.module.css";

export default function RecommendedMapPage() {
  const [result, setResult] = useState<{ places: ExplorerPlace[]; notice: string } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      const profile = readProfile();
      if (!profile) { setError("Complete your profile to find neighbourhoods that match it."); return; }
      const { catalog } = await loadWorkspaceData(abort.signal);
      const [rows, extras] = await Promise.all([loadCostRows(catalog, abort.signal), loadAllExtras(catalog, abort.signal)]);
      const costs = costById(rows);
      const candidates: Candidate[] = catalog.geographies.filter(g => g.geography_set_id === "toronto-158")
        .map(g => ({ id: g.id, name: g.name, cost: costs.get(g.id) ?? null, extras: extras.byPlace[g.id] }));
      // Travel times cost one routing request per 10 places, so rank every place without them first,
      // then fetch times for the 20 best and rank those again with their trips included.
      let places = rankByMatch(candidates, profile, profile.workPoint || profile.schoolPoint ? 20 : 5);
      let tripNote = "";
      if (profile.workPoint || profile.schoolPoint) {
        try {
          const trips = await loadTripTimes(places.map(p => p.id), profile, abort.signal);
          places = rankByMatch(candidates.filter(c => trips[c.id]).map(c => ({ ...c, trips: trips[c.id] })), profile);
          tripNote = " Travel times were checked for the 20 best matches before trips, then ranked again with them.";
        } catch (e) {
          if (abort.signal.aborted) return;
          places = places.slice(0, 5);
          tripNote = ` Travel times could not be loaded (${e instanceof Error ? e.message : "routing unavailable"}), so trips are left out of these scores.`;
        }
      }
      if (abort.signal.aborted) return;
      // The list keeps only what the sidebar shows; each panel rebuilds the full breakdown itself.
      const listed = places.map(({ id, name, year, boundary, score, summary }) => ({ id, name, year, boundary, score, summary }));
      writeSession(RECOMMENDED_KEY, JSON.stringify(listed));
      setResult({ places: listed, notice: places.length
        ? `Your top ${places.length} of Toronto's 158 neighbourhoods by match score, using the weights in your profile. Each score counts only the factors with data; open a place to see its breakdown and why it scored that way. Rent is the 2021 Census median, not current listings.${tripNote}`
        : "No neighbourhood could be scored: none of the factors you weighted have data. Raise a weight in your profile, or explore the map directly." });
      setError("");
    }
    load().catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [retry]);
  // No personal profile fields are included in requests or URLs.
  if (error) return <div className={styles.page}><main className={styles.empty}><p className={styles.kicker}>YOUR RECOMMENDATIONS</p><h1>Let’s find a starting point</h1><p role="alert">{error}</p><div className={styles.actions}><Link href="/housing/profile/" className={styles.primary}>Complete your profile →</Link><Link href="/housing/" className={styles.secondary}>Explore the map</Link><button type="button" className={styles.secondary} onClick={() => { setError(""); setRetry(n => n + 1); }}>Try again</button></div></main></div>;
  if (!result) return <div className={styles.page}><main className={styles.empty} role="status"><p className={styles.kicker}>YOUR RECOMMENDATIONS</p><h1>Finding neighbourhoods…</h1><p>Scoring all 158 neighbourhoods against your profile.</p><Link href="/housing/">Explore without recommendations →</Link></main></div>;
  return <HousingExplorer initialSidebar="recommended" recommendedPlaces={result.places} recommendationNotice={result.notice} />;
}
