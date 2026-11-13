"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { loadWorkspaceData } from "../explorer/data";
import type { BoundarySet } from "../explorer/types";
import MapView from "../map/MapView";
import { loadBoundaries, type Boundaries } from "@/lib/boundaries";
import { MAPBOX_TOKEN } from "@/lib/mapbox";
import styles from "./home.module.css";

// Highlighted in the preview. Looked up by name within one boundary set at a
// time; it does not claim the area is the same across boundary sets.
const FEATURED_NAME = "Annex";

function canShowMap() {
  return !!MAPBOX_TOKEN && !!document.createElement("canvas").getContext("webgl2");
}

/** Live, non-interactive map for the landing page. The timeline shows the Census
 * years that are really loaded and switches to the boundaries of the chosen year. */
export default function LandingMapPreview() {
  const [showMap] = useState(canShowMap);
  const [sets, setSets] = useState<BoundarySet[]>([]);
  const [year, setYear] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<{ setId: string; data: Boundaries } | null>(null);
  const requests = useRef(new Map<string, Promise<Boundaries>>());
  const years = sets.flatMap((s) => s.years).sort((a, b) => a - b);
  const activeYear = year ?? years.at(-1);
  const activeSet = sets.find((s) => activeYear !== undefined && s.years.includes(activeYear));
  const featured = activeSet?.neighbourhoods.find((n) => n.name === FEATURED_NAME) ?? activeSet?.neighbourhoods[0];
  const activeSetId = activeSet?.id;
  const boundaries = loaded && loaded.setId === activeSetId ? loaded.data : null;

  useEffect(() => {
    const abort = new AbortController();
    // Without Census data the map still shows Toronto; the timeline is left out.
    loadWorkspaceData(abort.signal).then((data) => setSets(data.boundary_sets)).catch(() => {});
    return () => abort.abort();
  }, []);

  useEffect(() => {
    if (!activeSetId) return;
    let current = true;
    let request = requests.current.get(activeSetId);
    if (!request) {
      request = loadBoundaries(activeSetId);
      requests.current.set(activeSetId, request);
    }
    request
      .then((data) => { if (current) setLoaded({ setId: activeSetId, data }); })
      .catch(() => { requests.current.delete(activeSetId); });
    return () => { current = false; };
  }, [activeSetId]);

  const openLabel = featured ? `Open ${featured.name} in the 3D Map Explorer` : "Open the 3D Map Explorer";
  const href = featured ? `/housing/?neighbourhood=${encodeURIComponent(featured.id)}` : "/housing/";

  return <div className={styles.previewCard}>
    <div className={styles.previewHeader}><div>{featured ? `${featured.name}, Toronto` : "Toronto"}</div><span className={styles.previewBadge}>Live 3D preview</span></div>
    <div className={styles.previewStage}>
      {showMap ? <>
        <MapView preview selected={null} boundaries={boundaries} selectedGeographyId={featured?.id} className={styles.previewMap} />
        <Link href={href} className={styles.previewLink} aria-label={openLabel} />
        <p className={styles.mapCaption}>Present-day basemap</p>
      </> : <p className={styles.previewFallback}>The map preview can&apos;t load here. <Link href={href}>Open the explorer</Link> to browse Toronto&apos;s neighbourhoods.</p>}
      {activeYear !== undefined && <div className={styles.previewTimeline}>
        <div><p className={styles.kicker}>MOVE THROUGH TIME</p><span>{activeYear}</span></div>
        <div className={styles.previewYears} role="group" aria-label="Choose a Census year">{years.map(y => <button type="button" key={y} aria-pressed={y === activeYear} onClick={() => setYear(y)}><span />{y}</button>)}</div>
      </div>}
    </div>
    <p className={styles.previewFootnote}>Browse in 3D · Scrub the timeline · See data change</p>
  </div>;
}
