/// <reference types="geojson" />
// mapbox-gl's feature types use the global GeoJSON namespace without importing it.
// TypeScript 6 no longer loads @types packages automatically, so the reference above
// requests it. It must stay above "use client" to count.
"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { MAPBOX_TOKEN, TORONTO_BBOX, TORONTO_CENTER, type Place } from "@/lib/mapbox";
import { boundsOf, type Boundaries } from "@/lib/boundaries";
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
  // Display-only map for the landing page: no controls, panning or zooming by the user.
  preview?: boolean;
  compact?: boolean;
  label?: string;
  className?: string;
};

const SOURCE = "neighbourhoods";
const HOME = { center: TORONTO_CENTER, zoom: 11, pitch: 45, bearing: -17 };
const EMPTY: Boundaries = { type: "FeatureCollection", features: [] };
// Extra top/right padding keeps the shape clear of the overlays on the map.
const FIT = { padding: { top: 170, bottom: 60, left: 60, right: 90 }, maxZoom: 14, pitch: 45 };
const PREVIEW_FIT = { padding: { top: 90, bottom: 50, left: 50, right: 50 }, maxZoom: 13, pitch: 50 };
const isSelected = (id: string) => ["==", ["get", "geography_id"], id];

export default function MapView({ selected, boundaries, selectedGeographyId, onGeographyClick, onPlaceDismiss, show3dObjects = true, showTransit = true, preview = false, compact = false, label = "Map of Toronto", className }: Props) {
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
      map.addLayer({ id: "neighbourhood-outline", type: "line", source: SOURCE, slot: "middle",
        paint: { "line-color": "#295738", "line-width": 1, "line-opacity": 0.5 } });
      map.addLayer({ id: "selected-fill", type: "fill", source: SOURCE, slot: "middle", filter: isSelected(""),
        paint: { "fill-color": "#295738", "fill-opacity": 0.25 } });
      map.addLayer({ id: "selected-outline", type: "line", source: SOURCE, slot: "middle", filter: isSelected(""),
        paint: { "line-color": "#295738", "line-width": 3 } });
      map.on("click", "neighbourhood-hit", (e) => {
        const id = e.features?.[0]?.properties?.geography_id;
        if (typeof id !== "string") return;
        clickedIdRef.current = id;
        clickRef.current?.(id);
      });
      const hoverLabel = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
      map.on("mousemove", "neighbourhood-hit", (e) => {
        const name = e.features?.[0]?.properties?.name;
        if (typeof name !== "string") return;
        map.getCanvas().style.cursor = "pointer";
        hoverLabel.setLngLat(e.lngLat).setText(name).addTo(map);
      });
      map.on("mouseleave", "neighbourhood-hit", () => {
        map.getCanvas().style.cursor = "";
        hoverLabel.remove();
      });
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
    if (!ready) return;
    mapRef.current?.getSource<mapboxgl.GeoJSONSource>(SOURCE)?.setData(boundaries ?? EMPTY);
  }, [ready, boundaries]);

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
