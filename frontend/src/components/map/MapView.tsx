/// <reference types="geojson" />
// mapbox-gl's feature types use the global GeoJSON namespace without importing it.
// TypeScript 6 no longer loads @types packages automatically, so the reference above
// requests it. It must stay above "use client" to count.
"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { MAPBOX_TOKEN, TORONTO_BBOX, TORONTO_CENTER, type Place } from "@/lib/mapbox";
import { boundsOf, type Boundaries } from "@/lib/boundaries";
import { POPULATION_SCALE } from "@/lib/population";
import { AMENITY_LAYERS, displayName, formatDistance, PARKS_LAYER, walkMinutes } from "@/lib/amenities";
import { LAND_USE_CATEGORIES } from "@/lib/landUse";
import styles from "./MapView.module.css";

type Props = {
  selected: Place | null;
  boundaries?: Boundaries | null;
  selectedGeographyId?: string;
  onGeographyClick?: (geographyId: string) => void;
  onPlaceDismiss?: () => void;
  // Mapbox Standard basemap options, toggled by the layer chips.
  show3dObjects?: boolean;
  showTransit?: boolean;
  // Population per geography id; null or absent means unknown (shown as "no data").
  shading?: Record<string, number | null> | null;
  /** Outlines of every neighbourhood. The selected one stays highlighted either way. */
  showBoundaries?: boolean;
  /** Present-day amenity points: properties category, name, label and optional metres. */
  amenities?: GeoJSON.FeatureCollection<GeoJSON.Point> | null;
  /** Zoning polygons in the selected neighbourhood, properties category, label and zone. */
  landUse?: GeoJSON.FeatureCollection | null;
  /** Park outlines with properties name and metres (distance to the park's edge). */
  parks?: GeoJSON.FeatureCollection | null;
  // Display-only map for the landing page: no controls, panning or zooming by the user.
  preview?: boolean;
  compact?: boolean;
  label?: string;
  className?: string;
};

const SOURCE = "neighbourhoods";
const AMENITY_SOURCE = "amenities";
const PARK_SOURCE = "parks";
const LAND_USE_SOURCE = "land-use";
const landUseColor = ["match", ["get", "category"], ...LAND_USE_CATEGORIES.flatMap((c) => [c.category, c.color]), "#495057"] as mapboxgl.ExpressionSpecification;
const NO_FEATURES: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const amenityColor = ["match", ["get", "category"], ...AMENITY_LAYERS.flatMap((l) => [l.category, l.color]), "#495057"] as mapboxgl.ExpressionSpecification;
const HOME = { center: TORONTO_CENTER, zoom: 11, pitch: 45, bearing: -17 };
const EMPTY: Boundaries = { type: "FeatureCollection", features: [] };
// Extra top/right padding keeps the shape clear of the overlays on the map.
const FIT = { padding: { top: 170, bottom: 60, left: 60, right: 90 }, maxZoom: 14, pitch: 45 };
const PREVIEW_FIT = { padding: { top: 90, bottom: 50, left: 50, right: 50 }, maxZoom: 13, pitch: 50 };
const isSelected = (id: string) => ["==", ["get", "geography_id"], id];
const HOVER_LAYERS = ["amenity-points", "park-areas", "land-use-fill", "neighbourhood-hit"];
type HoverProperties = Record<string, unknown> | undefined;

/** The single hover label: the topmost of an amenity point, a park, a zone or a neighbourhood. */
export function hoverText(amenity: HoverProperties, park: HoverProperties, neighbourhood: HoverProperties, zone?: HoverProperties): string | null {
  if (typeof amenity?.name === "string") {
    const away = typeof amenity.walk_minutes === "number" && typeof amenity.walk_metres === "number"
      ? ` · ${amenity.walk_minutes} min walk, ${formatDistance(amenity.walk_metres)} by street`
      : typeof amenity.metres === "number" ? ` · ${formatDistance(amenity.metres)} straight line, ~${walkMinutes(amenity.metres)} min walk (estimate)` : "";
    return `${amenity.name} (${amenity.label})${away}`;
  }
  if (typeof park?.name === "string") {
    const away = typeof park.metres === "number" ? (park.metres === 0 ? " · distances are measured from inside it" : ` · ${formatDistance(park.metres)} to its edge`) : "";
    return `${displayName(park.name)} (park)${away}`;
  }
  if (typeof zone?.label === "string") {
    if (zone.category === "unzoned_park") return `${zone.label} (City park)`;
    return `Zoned ${zone.label.toLowerCase()}${typeof zone.zone === "string" && zone.zone ? ` (${zone.zone})` : ""}`;
  }
  if (typeof neighbourhood?.name === "string") {
    const people = typeof neighbourhood.population === "number" ? `${neighbourhood.population.toLocaleString("en-CA")} people`
      : neighbourhood.shaded ? "Population unknown" : "";
    return people ? `${neighbourhood.name} · ${people}` : neighbourhood.name;
  }
  return null;
}
const { breaks, colors, noData } = POPULATION_SCALE;
const populationColor = ["case", ["has", "population"],
  ["step", ["get", "population"], colors[0], ...breaks.flatMap((b, i) => [b, colors[i + 1]])],
  noData] as mapboxgl.ExpressionSpecification;

export default function MapView({ selected, boundaries, selectedGeographyId, onGeographyClick, onPlaceDismiss, show3dObjects = true, showTransit = true, showBoundaries = true, amenities, parks, landUse, shading, preview = false, compact = false, label = "Map of Toronto", className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [flat, setFlat] = useState(false);
  // The load handler is registered once, so it reads the latest callback from a ref.
  const clickRef = useRef(onGeographyClick);
  // A neighbourhood picked on the map is already in view, so the camera stays put.
  const clickedIdRef = useRef<string | null>(null);
  const flatRef = useRef(false);

  const dismissRef = useRef(onPlaceDismiss);

  useEffect(() => { clickRef.current = onGeographyClick; }, [onGeographyClick]);
  useEffect(() => { dismissRef.current = onPlaceDismiss; }, [onPlaceDismiss]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!mapboxgl.supported()) {
      // Mapbox capability detection is an external initialization failure.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMapError("This browser cannot display the 3D map. Enable hardware acceleration or try another browser.");
      return;
    }
    mapboxgl.accessToken = MAPBOX_TOKEN;
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        // Standard style includes 3D buildings and landmarks out of the box.
        style: "mapbox://styles/mapbox/standard",
        ...HOME,
        interactive: !preview,
        scrollZoom: !compact,
        maxBounds: [
          [TORONTO_BBOX[0] - 0.3, TORONTO_BBOX[1] - 0.2],
          [TORONTO_BBOX[2] + 0.3, TORONTO_BBOX[3] + 0.2],
        ],
      });
    } catch {
      setMapError("The map could not start. Reload the page to try again.");
      return;
    }
    const onError = (event: mapboxgl.ErrorEvent) => {
      const status = (event.error as Error & { status?: number }).status;
      if (status === 401 || status === 403) {
        setMapError("Map access was denied. Check your Mapbox public token and its allowed website URLs.");
      } else if (!map.isStyleLoaded()) {
        setMapError("The map could not load. Check your connection and reload to try again.");
      }
    };
    map.on("error", onError);
    // The workspace can resize independently of the browser (panels, mobile layout).
    const resize = new ResizeObserver(() => map.resize());
    resize.observe(containerRef.current);
    if (!preview && !compact) map.addControl(new mapboxgl.ScaleControl({ unit: "metric" }), "bottom-left");
    mapRef.current = map;
    // Only the place popup has a close button. Popup "close" events can't be used:
    // they also fire when the user clicks elsewhere on the map.
    const container = map.getContainer();
    const onContainerClick = (event: MouseEvent) => {
      if ((event.target as Element).closest(".mapboxgl-popup-close-button")) dismissRef.current?.();
    };
    container.addEventListener("click", onContainerClick);

    map.on("load", () => {
      map.addSource(SOURCE, { type: "geojson", data: EMPTY });
      // The "middle" slot keeps these under the Standard style's labels and 3D buildings.
      // Transparent fill so a click anywhere inside a neighbourhood hits it.
      map.addLayer({ id: "neighbourhood-hit", type: "fill", source: SOURCE, slot: "middle",
        paint: { "fill-color": "#295738", "fill-opacity": 0 } });
      // Only features marked "shaded" are coloured; without population data the map stays plain.
      map.addLayer({ id: "population-fill", type: "fill", source: SOURCE, slot: "middle",
        filter: ["==", ["get", "shaded"], true],
        paint: { "fill-color": populationColor, "fill-opacity": 0.65 } });
      // Zoning sits with the population shading, under the neighbourhood outlines.
      map.addSource(LAND_USE_SOURCE, { type: "geojson", data: NO_FEATURES });
      map.addLayer({ id: "land-use-fill", type: "fill", source: LAND_USE_SOURCE, slot: "middle",
        paint: { "fill-color": landUseColor, "fill-opacity": 0.65 } });
      map.addLayer({ id: "land-use-edges", type: "line", source: LAND_USE_SOURCE, slot: "middle",
        paint: { "line-color": "#ffffff", "line-width": 0.5, "line-opacity": 0.8 } });
      // A light casing under a dark line keeps the outlines readable over the basemap,
      // 3D buildings and the orange population shading alike. Both widen as you zoom in.
      map.addLayer({ id: "neighbourhood-casing", type: "line", source: SOURCE, slot: "middle",
        layout: { "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-opacity": 0.7,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3, 14, 5] } });
      map.addLayer({ id: "neighbourhood-outline", type: "line", source: SOURCE, slot: "middle",
        layout: { "line-join": "round" },
        paint: { "line-color": "#1f4a2c", "line-opacity": 0.95,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 14, 2.5] } });
      map.addLayer({ id: "selected-fill", type: "fill", source: SOURCE, slot: "middle", filter: isSelected(""),
        paint: { "fill-color": "#295738", "fill-opacity": 0.25 } });
      // Thicker than the other outlines so the selection still stands out.
      map.addLayer({ id: "selected-outline", type: "line", source: SOURCE, slot: "middle", filter: isSelected(""),
        layout: { "line-join": "round" },
        paint: { "line-color": "#14331f", "line-width": ["interpolate", ["linear"], ["zoom"], 10, 3.5, 14, 5] } });
      // Park outlines under the amenity points; the basemap already tints parks, so these mark which ones are measured.
      map.addSource(PARK_SOURCE, { type: "geojson", data: NO_FEATURES });
      map.addLayer({ id: "park-areas", type: "fill", source: PARK_SOURCE, slot: "middle",
        paint: { "fill-color": PARKS_LAYER.color, "fill-opacity": 0.55 } });
      map.addLayer({ id: "park-edges", type: "line", source: PARK_SOURCE, slot: "middle",
        paint: { "line-color": "#14532d", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.5, 15, 2.5] } });
      // Amenity points sit above the 3D buildings so they are never hidden behind them.
      map.addSource(AMENITY_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "amenity-points", type: "circle", source: AMENITY_SOURCE, slot: "top",
        paint: { "circle-color": amenityColor, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.5, 15, 7] } });
      map.on("click", "neighbourhood-hit", (e) => {
        const id = e.features?.[0]?.properties?.geography_id;
        if (typeof id !== "string") return;
        clickedIdRef.current = id;
        clickRef.current?.(id);
      });
      // One label for whatever is on top under the cursor, so labels never stack:
      // an amenity point, else a park, else the neighbourhood.
      const hoverLabel = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
      map.on("mousemove", (e) => {
        const found = (id: string) => map.queryRenderedFeatures(e.point, { layers: [id] })[0]?.properties ?? undefined;
        const [amenity, park, zone, area] = HOVER_LAYERS.map(found);
        const text = hoverText(amenity, park, area, zone);
        map.getCanvas().style.cursor = text ? "pointer" : "";
        if (text) hoverLabel.setLngLat(e.lngLat).setText(text).addTo(map);
        else hoverLabel.remove();
      });
      map.on("mouseout", () => { map.getCanvas().style.cursor = ""; hoverLabel.remove(); });
      setMapError("");
      setReady(true);
    });

    return () => {
      resize.disconnect();
      container.removeEventListener("click", onContainerClick);
      markerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, [preview, compact]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    // Copy each neighbourhood's population onto its feature so the fill layer can colour it.
    // A missing value gets no "population" property, which the layer shows as "no data".
    const data = boundaries && shading ? {
      ...boundaries,
      features: boundaries.features.map((f) => {
        const population = shading[f.properties.geography_id];
        return { ...f, properties: { ...f.properties, shaded: true, ...(population == null ? {} : { population }) } };
      }),
    } : boundaries;
    map.getSource<mapboxgl.GeoJSONSource>(SOURCE)?.setData(data ?? EMPTY);
    // The green tint would muddy the population colours, so only the thick outline marks the selection.
    map.setPaintProperty("selected-fill", "fill-opacity", shading ? 0 : 0.25);
  }, [ready, boundaries, shading]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const layer of ["selected-fill", "selected-outline"]) map.setFilter(layer, isSelected(selectedGeographyId ?? ""));
    const fromClick = clickedIdRef.current === selectedGeographyId;
    clickedIdRef.current = null;
    const feature = boundaries?.features.find((f) => f.properties.geography_id === selectedGeographyId);
    if (fromClick) return;
    if (feature) {
      const fit = compact ? { padding: { top: 12, bottom: 35, left: 12, right: 12 }, maxZoom: 14, pitch: 45, duration: 0 } : preview ? PREVIEW_FIT : FIT;
      const narrow = map.getContainer().clientWidth < 900;
      map.fitBounds(boundsOf(feature.geometry), {
        ...fit,
        padding: !compact && !preview && narrow ? { top: 230, bottom: 45, left: 24, right: 70 } : fit.padding,
        pitch: flatRef.current ? 0 : fit.pitch,
      });
    }
  }, [ready, boundaries, selectedGeographyId, preview, compact]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setConfigProperty("basemap", "show3dObjects", show3dObjects);
    map.setConfigProperty("basemap", "showTransitLabels", showTransit);
  }, [ready, show3dObjects, showTransit]);

  useEffect(() => {
    if (!ready) return;
    mapRef.current?.getSource<mapboxgl.GeoJSONSource>(AMENITY_SOURCE)?.setData(amenities ?? NO_FEATURES);
  }, [ready, amenities]);

  useEffect(() => {
    if (!ready) return;
    mapRef.current?.getSource<mapboxgl.GeoJSONSource>(PARK_SOURCE)?.setData(parks ?? NO_FEATURES);
  }, [ready, parks]);

  useEffect(() => {
    if (!ready) return;
    mapRef.current?.getSource<mapboxgl.GeoJSONSource>(LAND_USE_SOURCE)?.setData(landUse ?? NO_FEATURES);
  }, [ready, landUse]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const layer of ["neighbourhood-casing", "neighbourhood-outline"]) {
      map.setLayoutProperty(layer, "visibility", showBoundaries ? "visible" : "none");
    }
  }, [ready, showBoundaries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    for (const layer of ["neighbourhood-casing", "neighbourhood-outline"]) {
      map.setLayoutProperty(layer, "visibility", showBoundaries ? "visible" : "none");
    }
  }, [ready, showBoundaries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRef.current?.remove();
    markerRef.current = null;
    if (!selected) return;
    markerRef.current = new mapboxgl.Marker({ color: "#2f5d3a" })
      .setLngLat(selected.coordinates)
      .setPopup(new mapboxgl.Popup({ offset: 24 }).setText(selected.address || selected.name))
      .addTo(map)
      .togglePopup();
    map.flyTo({ center: selected.coordinates, zoom: 15.5, pitch: flatRef.current ? 0 : 60, essential: true });
  }, [selected, ready]);

  return <div className={className}>
    <div ref={containerRef} className={styles.canvas} aria-label={label} role="region" />
    {mapError ? <div className={`${styles.status} ${compact ? styles.compactStatus : ""}`} role="alert"><strong>Map unavailable</strong><p>{mapError}</p><button type="button" onClick={() => window.location.reload()}>Try again</button></div>
      : !ready && <div className={styles.loading} role="status">Loading the map…</div>}
    {compact && !preview && <div className={styles.compactControls} role="group" aria-label={`${label} controls`}>
      <button type="button" aria-label={`Zoom in on ${label}`} onClick={() => mapRef.current?.zoomIn()}>+</button>
      <button type="button" aria-label={`Zoom out on ${label}`} onClick={() => mapRef.current?.zoomOut()}>−</button>
    </div>}
    {/* The landing preview is display-only, so it has no controls. */}
    {!preview && !compact && <div className={styles.controls} role="group" aria-label="Map controls">
      <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</button>
      <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button>
      <button type="button" aria-label="Reset rotation" title="Reset rotation" onClick={() => mapRef.current?.easeTo({ bearing: HOME.bearing, pitch: flat ? 0 : HOME.pitch })}>↻</button>
      <button type="button" aria-label="Show all of Toronto" title="Show all of Toronto" onClick={() => mapRef.current?.flyTo({ ...HOME, pitch: flat ? 0 : HOME.pitch, essential: true })}>⌂</button>
      <button type="button" aria-label={flat ? "Switch to 3D view" : "Switch to 2D view"} aria-pressed={!flat} title={flat ? "Switch to 3D view" : "Switch to 2D view"} onClick={() => {
        const next = !flat;
        flatRef.current = next;
        setFlat(next);
        mapRef.current?.easeTo({ pitch: next ? 0 : 60, duration: 600 });
      }}>{flat ? "3D" : "2D"}</button>
    </div>}
  </div>;
}
