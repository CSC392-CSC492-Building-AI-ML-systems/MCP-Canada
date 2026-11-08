"use client";

import { useEffect, useState } from "react";
import LocationSearch from "./LocationSearch";
import MapView from "./MapView";
import type { ExplorationSelection } from "@/components/explorer/types";
import { findBoundary, loadBoundaries, type Boundaries } from "@/lib/boundaries";
import { MAPBOX_TOKEN, placeFromSearch, type Place } from "@/lib/mapbox";
import styles from "./HousingMap.module.css";

const OUTSIDE_NOTICE = "This location is outside the loaded neighbourhood boundaries, so the selection did not change.";

/** Map and location search for the housing explorer's map slot. Outlines the
 * active boundary set and highlights the selected neighbourhood;
 * clicking a neighbourhood, or searching an address inside one, selects it. */
export default function HousingMap({ selection, onSelectionChange }: {
  selection: ExplorationSelection;
  onSelectionChange: (selection: ExplorationSelection) => void;
}) {
  // A place chosen on the landing page arrives in the URL. Its neighbourhood, if it
  // has one, is already selected by the workspace from ?neighbourhood=.
  const [selected, setSelected] = useState<Place | null>(() => typeof window === "undefined" ? null : placeFromSearch(window.location.search));
  const [notice, setNotice] = useState(() => selected && !new URLSearchParams(window.location.search).has("neighbourhood") ? OUTSIDE_NOTICE : "");
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

  function onPlace(place: Place) {
    setSelected(place);
    // Only the active boundary set is searched; a point is never mapped to another set.
    const match = boundaries && findBoundary(boundaries, place.coordinates);
    setNotice(match ? "" : OUTSIDE_NOTICE);
    if (match) onSelectionChange({ ...selection, geographyId: match.properties.geography_id });
  }

  if (!MAPBOX_TOKEN) {
    return <p className={styles.missingToken} role="alert">
      Add <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> to <code>frontend/.env.local</code> and restart <code>npm run dev</code> to show the map.
    </p>;
  }

  return <>
    <MapView selected={selected} boundaries={boundaries} selectedGeographyId={selection.geographyId}
      onGeographyClick={(geographyId) => onSelectionChange({ ...selection, geographyId })} className={styles.map} />
    <div className={styles.search}>
      <LocationSearch onSelect={onPlace} />
      {notice && <p className={styles.notice} role="status">{notice}</p>}
    </div>
  </>;
}
