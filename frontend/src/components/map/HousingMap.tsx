"use client";

import { useEffect, useState } from "react";
import LocationSearch from "./LocationSearch";
import MapView from "./MapView";
import type { ExplorationSelection } from "@/components/explorer/types";
import { loadBoundaries, type Boundaries } from "@/lib/boundaries";
import { MAPBOX_TOKEN, type Place } from "@/lib/mapbox";
import styles from "./HousingMap.module.css";

/** Map and location search for the housing explorer's map slot. Outlines the
 * active boundary set and highlights the selected neighbourhood. */
export default function HousingMap({ selection }: { selection: ExplorationSelection }) {
  const [selected, setSelected] = useState<Place | null>(null);
  const [loaded, setLoaded] = useState<{ setId: string; data: Boundaries } | null>(null);
  // Ignore outlines from a previous boundary set while the new one loads.
  const boundaries = loaded?.setId === selection.boundarySetId ? loaded.data : null;

  useEffect(() => {
    const abort = new AbortController();
    const setId = selection.boundarySetId;
    loadBoundaries(setId, abort.signal)
      .then((data) => setLoaded({ setId, data }))
      // Without outlines the map still works; the details panel shows the selection.
      .catch((e) => { if (!abort.signal.aborted) console.error(e); });
    return () => abort.abort();
  }, [selection.boundarySetId]);

  if (!MAPBOX_TOKEN) {
    return <p className={styles.missingToken} role="alert">
      Add <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> to <code>frontend/.env.local</code> and restart <code>npm run dev</code> to show the map.
    </p>;
  }

  return <>
    <MapView selected={selected} boundaries={boundaries} selectedGeographyId={selection.geographyId} className={styles.map} />
    <div className={styles.search}>
      <LocationSearch onSelect={setSelected} />
    </div>
  </>;
}
