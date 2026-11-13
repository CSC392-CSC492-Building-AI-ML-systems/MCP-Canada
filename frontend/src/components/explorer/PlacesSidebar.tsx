"use client";
import Link from "next/link";
import styles from "./explorer.module.css";

export type ExplorerPlace = {
  id: string; name: string; year: number; boundary: string;
  summary?: string; score?: number | null;
};
export type SidebarMode = "collapsed" | "saved" | "recommended";

/* eslint-disable @next/next/no-img-element -- fixed-size local Figma SVG assets */
export function PlacesSidebar({ mode, onModeChange, saved, recommended, selectedId, onSelect, onPreview, onRemove, onCompare, notice }: {
  mode: SidebarMode; onModeChange: (mode: SidebarMode) => void;
  saved: ExplorerPlace[]; recommended: ExplorerPlace[]; selectedId?: string;
  onSelect: (place: ExplorerPlace) => void; onPreview: (place: ExplorerPlace | null) => void;
  onRemove: (place: ExplorerPlace) => void; onCompare: (places: ExplorerPlace[]) => void; notice: string;
}) {
  if (mode === "collapsed") return <aside className={styles.savedRail} aria-label="Saved places">
    <button type="button" aria-label="Expand saved places" aria-expanded={false} onClick={() => onModeChange("saved")}>
      <img src="/icons/explorer/bookmark.svg" width={24} height={24} alt="" />
      <span className={styles.railCount}>{saved.length}</span><span>SAVED</span>
      <img src="/icons/explorer/expand.svg" width={24} height={24} alt="" />
    </button>
  </aside>;
  const recommendations = mode === "recommended";
  const places = (recommendations ? recommended : saved).slice(0, 5);
  return <aside className={styles.placesSidebar} aria-label={recommendations ? "Recommended places" : "Saved places"}>
    <div className={styles.placesScroll}>
      <p className={styles.kicker}>YOUR COMPARISON LIST</p>
      <div className={styles.sidebarHeading}><h2>{recommendations ? "Recommended places" : "Saved places"}</h2>
        <button type="button" aria-label="Collapse places sidebar" aria-expanded={true} onClick={() => onModeChange("collapsed")}><img src="/icons/explorer/collapse.svg" width={20} height={20} alt="" /></button>
      </div>
      <div className={styles.sidebarTabs} role="group" aria-label="Places list">
        <button type="button" aria-pressed={!recommendations} onClick={() => onModeChange("saved")}>Saved · {saved.length}</button>
        <button type="button" aria-pressed={recommendations} onClick={() => onModeChange("recommended")}>Recommended</button>
      </div>
      <p className={styles.caption}>{recommendations ? "Your recommended places. Hover or focus a card to preview its location and data." : "Save up to 5 locations to compare at the same time period."}</p>
      {!recommendations && <p className={styles.caption}>Click “Add to compare” in the right details panel to save the location you’re viewing.</p>}
      {notice && <p className={styles.caption} role="status">{notice}</p>}
      {places.length ? <ul className={styles.placeList} onMouseLeave={() => onPreview(null)}>{places.map(place => <li key={`${place.id}:${place.year}`}>
        <button type="button" className={styles.placeCard} aria-pressed={selectedId === place.id} onClick={() => onSelect(place)} onMouseEnter={() => onPreview(place)} onFocus={() => onPreview(place)} onBlur={() => onPreview(null)}>
          <span><strong>{place.name}</strong><small>{place.summary ?? `${place.year} Census · ${place.boundary === "toronto-140" ? "Historical 140" : "Current 158"}`}</small></span>
          <span className={styles.placeScore} aria-label={place.score == null ? "Match score unavailable" : `Match score ${place.score} out of 100`}>{place.score ?? "—"}</span>
        </button>
        {!recommendations && <button type="button" className={styles.removePlace} aria-label={`Remove ${place.name} ${place.year}`} onClick={() => onRemove(place)}>Remove</button>}
      </li>)}</ul> : <div className={styles.sidebarEmpty}><h3>{recommendations ? "Your search, your places" : "Start your saved list"}</h3><p>{recommendations ? "No starting points are available yet. Update your profile or explore the map and save places yourself." : "Select a neighbourhood on the map, then add it to compare."}</p>{recommendations && <Link href="/housing/profile/">Personalize your search →</Link>}</div>}
      {!recommendations && <button type="button" className={styles.addMore} onClick={() => onModeChange("collapsed")}>+ Add more to compare</button>}
    </div>
    <footer className={styles.sidebarFooter}><button type="button" className={styles.primaryButton} disabled={places.length < 2} onClick={() => onCompare(places)}>{recommendations ? "Compare all recommended places →" : "Compare saved places →"}</button><p className={styles.caption}>Up to 5 places · same period</p></footer>
  </aside>;
}
