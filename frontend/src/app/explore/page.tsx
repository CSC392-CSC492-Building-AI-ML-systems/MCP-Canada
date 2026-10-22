"use client";

import MapView from "@/components/map/MapView";
import { MAPBOX_TOKEN } from "@/lib/mapbox";
import styles from "./explore.module.css";

export default function ExplorePage() {
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
      <MapView className={styles.map} />
    </div>
  );
}
