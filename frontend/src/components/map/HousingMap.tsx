"use client";

import { useState } from "react";
import LocationSearch from "./LocationSearch";
import MapView from "./MapView";
import { MAPBOX_TOKEN, type Place } from "@/lib/mapbox";
import styles from "./HousingMap.module.css";

/** Map and location search for the housing explorer's map slot. */
export default function HousingMap() {
  const [selected, setSelected] = useState<Place | null>(null);

  if (!MAPBOX_TOKEN) {
    return <p className={styles.missingToken} role="alert">
      Add <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> to <code>frontend/.env.local</code> and restart <code>npm run dev</code> to show the map.
    </p>;
  }

  return <>
    <MapView selected={selected} className={styles.map} />
    <div className={styles.search}>
      <LocationSearch onSelect={setSelected} />
    </div>
  </>;
}
