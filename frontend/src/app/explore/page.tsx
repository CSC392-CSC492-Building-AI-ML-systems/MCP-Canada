"use client";

import { useState } from "react";
import LocationSearch from "@/components/map/LocationSearch";
import MapView from "@/components/map/MapView";
import { MAPBOX_TOKEN, type Place } from "@/lib/mapbox";
import styles from "./explore.module.css";

export default function ExplorePage() {
  const [selected, setSelected] = useState<Place | null>(null);

  if (!MAPBOX_TOKEN) {
    return (
      <div className={styles.missingToken}>
        <h1>Mapbox token missing</h1>
        <p>
          Add <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> to <code>frontend/.env.local</code> and restart <code>npm run dev</code>.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.explorer}>
      <MapView selected={selected} className={styles.map} />
      <div className={styles.searchPanel}>
        <LocationSearch onSelect={setSelected} />
        {selected && (
          <div className={styles.selected} aria-live="polite">
            <strong>{selected.name}</strong>
            <span>{selected.address}</span>
          </div>
        )}
      </div>
    </div>
  );
}
