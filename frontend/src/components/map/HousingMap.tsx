"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import LocationSearch from "./LocationSearch";
import MapView from "./MapView";
import type { ExplorationSelection } from "@/components/explorer/types";
import { findBoundary, loadBoundaries, type Boundaries } from "@/lib/boundaries";
import { MAPBOX_TOKEN, placeFromSearch, type Place } from "@/lib/mapbox";
import { loadPopulation, POPULATION_SCALE, type PopulationLayer } from "@/lib/population";
import { readAmenityLayers, readShowBoundaries, readShowLandUse, readShowPopulation, subscribeMapPreferences, writeAmenityLayers, writeShowBoundaries, writeShowLandUse, writeShowPopulation } from "@/lib/mapPreferences";
import { LandUseKey, useLandUse } from "./LandUseLegend";
import { LayersPanel, type LayerGroup } from "./LayersPanel";
import { MapLegend, type LegendSection } from "./MapLegend";
import { AMENITY_LAYERS, type AmenityCategory } from "@/lib/amenities";
import { amenityPoints, nearbyOrigin, useNearbyAmenities, useNearbyParks, useWalkingRoutes } from "./NearbyAmenities";
import { parkCandidates, PARKS_LAYER, pointCandidates, summarizeNearby, summarizeParks, type NearbySummary } from "@/lib/amenities";
import { publishNearby } from "@/lib/nearbyStore";
import styles from "./HousingMap.module.css";

const ALL_AMENITIES = AMENITY_LAYERS.map((l) => l.category);
const OUTSIDE_NOTICE = "This location is outside the loaded neighbourhood boundaries, so the selection did not change.";

/** Map and location search for the housing explorer's map slot. Outlines the
 * active boundary set and highlights the selected neighbourhood;
 * clicking a neighbourhood, or searching an address inside one, selects it.
 * Neighbourhoods are shaded by population for the selected Census year. */
export default function HousingMap({ selection, onSelectionChange }: {
  selection: ExplorationSelection | null;
  onSelectionChange: (selection: ExplorationSelection) => void;
}) {
  // A place chosen on the landing page arrives in the URL. Its neighbourhood, if it
  // has one, is already selected by the workspace from ?neighbourhood=.
  const [selected, setSelected] = useState<{ place: Place; geographyId: string | undefined } | null>(() => {
    const place = typeof window === "undefined" ? null : placeFromSearch(window.location.search);
    return place && { place, geographyId: selection?.geographyId };
  });
  const [notice, setNotice] = useState(() => selected && !new URLSearchParams(window.location.search).has("neighbourhood") ? OUTSIDE_NOTICE : "");
  // A searched place only stays marked while the neighbourhood selected with it does.
  if (selected && selected.geographyId !== selection?.geographyId) {
    setSelected(null);
    setNotice("");
  }
  const [loaded, setLoaded] = useState<{ setId: string; data: Boundaries } | null>(null);
  // Ignore outlines from a previous boundary set while the new one loads.
  const boundaries = loaded && loaded.setId === selection?.boundarySetId ? loaded.data : null;
  const [show3d, setShow3d] = useState(true);
  const [showTransit, setShowTransit] = useState(true);
  // Remembered per browser; the server render always starts with outlines shown.
  const showBoundaries = useSyncExternalStore(subscribeMapPreferences, readShowBoundaries, () => true);
  const showPopulation = useSyncExternalStore(subscribeMapPreferences, readShowPopulation, () => true);
  const showLandUse = useSyncExternalStore(subscribeMapPreferences, readShowLandUse, () => false);
  // Zoning and population colour the same areas, so only one is shown at a time.
  function togglePopulation() { if (!showPopulation) writeShowLandUse(false); writeShowPopulation(!showPopulation); }
  function toggleLandUse() { if (!showLandUse) writeShowPopulation(false); writeShowLandUse(!showLandUse); }
  const amenityLayers = useSyncExternalStore(subscribeMapPreferences, readAmenityLayers, () => "");
  const enabledAmenities = useMemo(() => AMENITY_LAYERS.map((l) => l.category).filter((c) => amenityLayers.split(",").includes(c)), [amenityLayers]);
  const selectedFeature = boundaries?.features.find((f) => f.properties.geography_id === selection?.geographyId);
  const selectedName = selectedFeature?.properties.name;
  // Every kind is loaded for the details panel; the chips only choose what the map draws.
  const allLists = useNearbyAmenities(selectedFeature, ALL_AMENITIES);
  const amenityLists = useMemo(() => Object.fromEntries(enabledAmenities.map((c) => [c, allLists[c]])) as typeof allLists, [allLists, enabledAmenities]);
  const searchedPoint = selected?.place.coordinates ?? null;
  const origin = useMemo(() => selectedFeature ? nearbyOrigin(selectedFeature, searchedPoint) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute per area and searched point, not per boundary reload
    [selectedFeature?.properties.geography_id, searchedPoint?.[0], searchedPoint?.[1]]);
  const parksResult = useNearbyParks(selectedFeature, origin);
  const landUseResult = useLandUse(selectedFeature?.properties.geography_id, showLandUse);
  const showParks = amenityLayers.split(",").includes(PARKS_LAYER.category);
  // The closest few of each kind (by straight line) get a street walking route.
  const candidates = useMemo(() => origin ? [
    ...ALL_AMENITIES.flatMap((c) => allLists[c]?.list ? pointCandidates(c, allLists[c]!.list!, origin.point) : []),
    ...(parksResult?.parks ? parkCandidates(parksResult.parks) : []),
  ] : [], [allLists, parksResult, origin]);
  const walking = useWalkingRoutes(origin, candidates);
  // One set of summaries for the map card and the details panel, so they always agree.
  const summaries = useMemo(() => origin ? {
    ...Object.fromEntries(ALL_AMENITIES.map((c) => [c, summarizeNearby(allLists[c], origin.point, walking)])) as Record<AmenityCategory, NearbySummary>,
    park: summarizeParks(parksResult, walking),
  } : null, [allLists, parksResult, origin, walking]);
  const asOf = [...Object.values(allLists).flatMap((r) => r?.list?.places.map((p) => p.validOn) ?? []), ...(parksResult?.parks?.asOf ? [parksResult.parks.asOf] : [])].sort();
  const points = useMemo(() => enabledAmenities.length ? amenityPoints(amenityLists, origin, walking) : null, [amenityLists, origin, walking, enabledAmenities.length]);
  useEffect(() => {
    const id = selectedFeature?.properties.geography_id;
    if (!id || !origin || !summaries) { publishNearby(null); return; }
    publishNearby({ geographyId: id, originLabel: origin.label, asOf: asOf.at(-1) ?? null, routed: walking.status === "ok", summaries });
    // asOf and walking are derived from the same inputs as summaries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaries, origin, selectedFeature?.properties.geography_id]);
  useEffect(() => () => publishNearby(null), []);
  function toggleLayer(category: string) {
    const on = amenityLayers.split(",").filter(Boolean);
    writeAmenityLayers(on.includes(category) ? on.filter((c) => c !== category) : [...on, category]);
  }
  const localOptions = useMemo(() => boundaries?.features.map((f) => ({
    id: f.properties.geography_id, name: f.properties.name, detail: `Toronto neighbourhood ${f.properties.code}`,
  })) ?? [], [boundaries]);
  const populationKey = selection ? `${selection.boundarySetId}:${selection.year}` : "";
  const [population, setPopulation] = useState<{ key: string; layer?: PopulationLayer; error?: string } | null>(null);
  // Only shade with numbers for the boundary set and year on screen, never stale ones.
  const current = population?.key === populationKey ? population : null;

  useEffect(() => {
    const abort = new AbortController();
    const setId = selection?.boundarySetId;
    if (!setId) return;
    loadBoundaries(setId, abort.signal)
      .then((data) => setLoaded({ setId, data }))
      // Without outlines the map still works; the details panel shows the selection.
      .catch((e) => { if (!abort.signal.aborted) console.error(e); });
    return () => abort.abort();
  }, [selection?.boundarySetId]);

  useEffect(() => {
    const setId = selection?.boundarySetId, year = selection?.year;
    // Nothing is fetched while the shading is turned off.
    if (!setId || !year || !showPopulation) return;
    const abort = new AbortController();
    const key = `${setId}:${year}`;
    loadPopulation(setId, year, abort.signal)
      .then((layer) => setPopulation({ key, layer }))
      .catch((e) => { if (!abort.signal.aborted) setPopulation({ key, error: e.message }); });
    return () => abort.abort();
  }, [selection?.boundarySetId, selection?.year, showPopulation]);

  function onPlace(place: Place) {
    // Only the active boundary set is searched; a point is never mapped to another set.
    const match = boundaries && findBoundary(boundaries, place.coordinates);
    setSelected({ place, geographyId: match ? match.properties.geography_id : selection?.geographyId });
    setNotice(match ? "" : OUTSIDE_NOTICE);
    if (match && selection) onSelectionChange({ ...selection, geographyId: match.properties.geography_id });
  }

  if (!MAPBOX_TOKEN) {
    return <p className={styles.missingToken} role="alert">
      Add <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> to <code>frontend/.env.local</code> and restart <code>npm run dev</code> to show the map.
    </p>;
  }

  const nearbyLayers = [...AMENITY_LAYERS, PARKS_LAYER];
  const isNearbyOn = (category: string) => category === PARKS_LAYER.category ? showParks : enabledAmenities.includes(category as AmenityCategory);
  const layerGroups: LayerGroup[] = [
    { title: "Colour the map by", counted: true, items: [
      { id: "population", label: "Population", hint: "For the year on the timeline", checked: showPopulation, onChange: togglePopulation },
      { id: "land-use", label: "Land use", hint: "City zoning in the selected area, present day", checked: showLandUse, onChange: toggleLandUse },
    ] },
    { title: "Nearby places", counted: true, items: nearbyLayers.map(({ category, label, color }) => ({
      id: category, label, swatch: color, checked: isNearbyOn(category), onChange: () => toggleLayer(category) })) },
    { title: "Map", items: [
      { id: "boundaries", label: "Neighbourhood outlines", checked: showBoundaries, onChange: () => writeShowBoundaries(!showBoundaries) },
      { id: "3d", label: "3D buildings", checked: show3d, onChange: () => setShow3d((v) => !v) },
      { id: "transit-labels", label: "Transit labels", checked: showTransit, onChange: () => setShowTransit((v) => !v) },
      { id: "historic", label: "Historic imagery", hint: "Not available yet", checked: false, onChange: () => {}, disabled: true },
    ] },
  ];
  const activeNearby = nearbyLayers.filter((l) => isNearbyOn(l.category));
  const legendSections: LegendSection[] = [
    ...(selection && showPopulation ? [{ id: "population", title: `Population, ${selection.year}`, content: current?.layer ? <>
      <ul>
        {POPULATION_SCALE.labels.map((label, i) => <li key={label}><span style={{ background: POPULATION_SCALE.colors[i] }} />{label}</li>)}
        <li><span style={{ background: POPULATION_SCALE.noData }} />No data</li>
      </ul>
      {current.layer.note && <p className={styles.legendNote}>{current.layer.note}</p>}
      <p className={styles.legendSource}>Same scale for every year. Source: {current.layer.source.publisher}, {current.layer.source.title}.</p>
    </> : <p>{current?.error ? `Population unavailable: ${current.error}` : "Loading population…"}</p>,
      source: current?.layer ? `Same scale for every year. Source: ${current.layer.source.publisher}, ${current.layer.source.title}.` : undefined }] : []),
    ...(showLandUse && selectedName ? [{ id: "land-use", title: `Zoning in ${selectedName}`, content: <LandUseKey result={landUseResult} />,
      source: landUseResult?.landUse?.source ? `${landUseResult.landUse.source.publisher}, ${landUseResult.landUse.source.title} (amendments to June 2023). What land is zoned for, not what is built.` : undefined }] : []),
    ...(activeNearby.length ? [{ id: "nearby", title: "Nearby places", content: <>
      <ul>{activeNearby.map((l) => <li key={l.category}><span className={styles.legendDot} style={{ background: l.color }} />{l.label}</li>)}</ul>
      <p className={styles.legendSource}>Present day. Hover a place for its walk; the closest walks are under Everyday needs.</p>
    </> }] : []),
  ];

  return <div className={styles.stage}>
    <MapView selected={selected?.place ?? null} boundaries={boundaries} selectedGeographyId={selection?.geographyId}
      onGeographyClick={(geographyId) => { if (selection) onSelectionChange({ ...selection, geographyId }); }}
      onPlaceDismiss={() => { setSelected(null); setNotice(""); }}
      show3dObjects={show3d} showTransit={showTransit} showBoundaries={showBoundaries} amenities={points} landUse={showLandUse ? landUseResult?.landUse?.features : null} parks={showParks ? parksResult?.parks?.outlines : null} shading={showPopulation ? current?.layer?.values : null} className={styles.map} />
    <div className={styles.topRow}>
      <LayersPanel groups={layerGroups} />
      <div className={styles.search}>
        <LocationSearch onSelect={onPlace} localOptions={localOptions} onLocalSelect={(id) => { setNotice(""); if (selection) onSelectionChange({ ...selection, geographyId: id }); }} />
        {notice && <p className={styles.notice} role="status">{notice}</p>}
      </div>
    </div>
    <MapLegend sections={legendSections} />
  </div>;
}
