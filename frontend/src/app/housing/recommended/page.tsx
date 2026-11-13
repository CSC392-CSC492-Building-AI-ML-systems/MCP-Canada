"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { HousingExplorer } from "@/components/map/HousingExplorer";
import { loadWorkspaceData } from "@/components/explorer/data";
import type { ExplorerPlace } from "@/components/explorer/PlacesSidebar";
import { RECOMMENDED_KEY, readProfile, writeSession } from "@/components/workflow/state";
import { budgetStartingPoints } from "@/components/workflow/recommendations";
import { loadCostRows } from "@/components/workflow/recommendation-data";
import styles from "@/components/workflow/workflow.module.css";

export default function RecommendedMapPage() {
  const [result, setResult] = useState<{ places: ExplorerPlace[]; notice: string } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      const profile = readProfile();
      if (!profile) { setError("Complete your profile to find budget-based starting points."); return; }
      const { catalog } = await loadWorkspaceData(abort.signal);
      const rows = await loadCostRows(catalog, abort.signal);
      const places = budgetStartingPoints(rows, profile);
      if (abort.signal.aborted) return;
      writeSession(RECOMMENDED_KEY, JSON.stringify(places));
      setResult({ places, notice: profile.weights[0] === 0 ? "Affordability has zero weight. Enable it in your profile to find budget-based starting points; other matching factors are unavailable." : "Starting points within your budget, ordered by lowest published 2021 shelter cost. If none fit, the lowest available benchmarks are marked above budget. These are Census benchmarks, not current listings or bedroom-specific rents. Commute, lifestyle, safety and overall match scores are unavailable." });
      setError("");
    }
    load().catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [retry]);
  // No personal profile fields are included in requests or URLs.
  if (error) return <div className={styles.page}><main className={styles.empty}><p className={styles.kicker}>YOUR RECOMMENDATIONS</p><h1>Let’s find a starting point</h1><p role="alert">{error}</p><div className={styles.actions}><Link href="/housing/profile/" className={styles.primary}>Complete your profile →</Link><Link href="/housing/" className={styles.secondary}>Explore the map</Link><button type="button" className={styles.secondary} onClick={() => { setError(""); setRetry(n => n + 1); }}>Try again</button></div></main></div>;
  if (!result) return <div className={styles.page}><main className={styles.empty} role="status"><p className={styles.kicker}>YOUR RECOMMENDATIONS</p><h1>Finding neighbourhoods…</h1><p>Reading the published housing data for your budget.</p><Link href="/housing/">Explore without recommendations →</Link></main></div>;
  return <HousingExplorer initialSidebar="recommended" recommendedPlaces={result.places} recommendationNotice={result.notice} />;
}
