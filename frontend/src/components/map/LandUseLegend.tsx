"use client";
import { useEffect, useState } from "react";
import { formatShare, landUseColor, loadLandUse, type LandUse } from "@/lib/landUse";
import styles from "./HousingMap.module.css";

type Result = { key: string; landUse?: LandUse; error?: string };

/** Zoning for one neighbourhood, loaded only while the layer is on. */
export function useLandUse(geographyId: string | undefined, enabled: boolean): Result | undefined {
  const [result, setResult] = useState<Result | undefined>();
  const key = enabled && geographyId ? geographyId : "";
  useEffect(() => {
    if (!key) return;
    const abort = new AbortController();
    loadLandUse(key, abort.signal)
      .then((landUse) => setResult({ key, landUse }))
      .catch((e) => { if (!abort.signal.aborted) setResult({ key, error: e.message }); });
    return () => abort.abort();
  }, [key]);
  return key && result?.key === key ? result : undefined;
}

/** What share of the neighbourhood each zoning category covers (a section of the map legend). */
export function LandUseKey({ result }: { result: Result | undefined }) {
  const landUse = result?.landUse;
  if (!result) return <p>Loading zoning…</p>;
  if (result.error) return <p>Zoning unavailable: {result.error}</p>;
  if (!landUse!.loaded) return <p>Zoning is not loaded in this database. Run the official data setup to add it.</p>;
  return <>
    <ul className={styles.landUseList}>
      {landUse!.shares.map((s) => <li key={s.category}><span style={{ background: landUseColor(s.category) }} />{s.label}<strong>{formatShare(s.percent)}</strong></li>)}
      {landUse!.notCoveredPercent !== null && landUse!.notCoveredPercent >= 0.5 && <li title="Roads, rail, water and lands still under older by-laws: no zone in the City's file and not a City park">
        <span className={styles.unzonedSwatch} />No zone in the file<strong>{formatShare(landUse!.notCoveredPercent)}</strong></li>}
    </ul>
    <p className={styles.legendNote}>What land is zoned for, not what is built. Present day, not historical.</p>
    <p className={styles.legendSource}>Share of the neighbourhood&apos;s area. {landUse!.source?.publisher}, {landUse!.source?.title} (amendments to June 2023){landUse!.asOf ? `, retrieved ${landUse!.asOf}` : ""}.{landUse!.parkSource && ` Unzoned City parks: ${landUse!.parkSource.publisher}, ${landUse!.parkSource.title}.`}</p>
  </>;
}
