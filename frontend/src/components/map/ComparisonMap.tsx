"use client";
import { useEffect, useState } from "react";
import { loadBoundaries, type Boundaries } from "@/lib/boundaries";
import { MAPBOX_TOKEN } from "@/lib/mapbox";
import MapView from "./MapView";
import styles from "./ComparisonMap.module.css";

// All comparison columns in one boundary set share a single download.
const requests = new Map<string, Promise<Boundaries>>();
export function comparisonBoundaries(setId: string) {
  let request = requests.get(setId);
  if (!request) {
    request = loadBoundaries(setId).catch(error => { requests.delete(setId); throw error; });
    requests.set(setId, request);
  }
  return request;
}

export default function ComparisonMap({ geographyId, boundarySetId, name }: {
  geographyId: string; boundarySetId: string; name: string;
}) {
  const [result, setResult] = useState<{ setId: string; data?: Boundaries; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!MAPBOX_TOKEN) return;
    let current = true;
    comparisonBoundaries(boundarySetId)
      .then(data => { if (current) setResult({ setId: boundarySetId, data }); })
      .catch(() => { if (current) setResult({ setId: boundarySetId, error: "Could not load this neighbourhood’s boundary." }); });
    return () => { current = false; };
  }, [boundarySetId, attempt]);
  const data = result?.setId === boundarySetId ? result.data : undefined;
  const error = result?.setId === boundarySetId ? result.error : undefined;
  const feature = data?.features.find(f => f.properties.geography_id === geographyId);
  return <div className={styles.frame}>
    {!MAPBOX_TOKEN ? <p className={styles.message}>Map unavailable. Configure your map access token to view live maps.</p>
      : error ? <div className={styles.message} role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(n => n + 1)}>Try again</button></div>
      : !data ? <p className={styles.message} role="status">Loading {name} map…</p>
      : !feature ? <p className={styles.message} role="status">No boundary is available for this location.</p>
      : <MapView compact selected={null} boundaries={data} selectedGeographyId={geographyId} label={`Map of ${name}`} className={styles.map} />}
  </div>;
}
