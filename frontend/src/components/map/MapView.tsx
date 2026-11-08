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
  className?: string;
};

const SOURCE = "neighbourhoods";
const HOME = { center: TORONTO_CENTER, zoom: 11, pitch: 45, bearing: -17 };
const EMPTY: Boundaries = { type: "FeatureCollection", features: [] };
const isSelected = (id: string) => ["==", ["get", "geography_id"], id];
const { breaks, colors, noData } = POPULATION_SCALE;
const populationColor = ["case", ["has", "population"],
  ["step", ["get", "population"], colors[0], ...breaks.flatMap((b, i) => [b, colors[i + 1]])],
  noData] as mapboxgl.ExpressionSpecification;

export default function MapView({ selected, boundaries, selectedGeographyId, onGeographyClick, onPlaceDismiss, show3dObjects = true, showTransit = true, shading, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [ready, setReady] = useState(false);
  // The load handler is registered once, so it reads the latest callback from a ref.
  const clickRef = useRef(onGeographyClick);
  // A neighbourhood picked on the map is already in view, so the camera stays put.
  const clickedIdRef = useRef<string | null>(null);

  const dismissRef = useRef(onPlaceDismiss);

  useEffect(() => { clickRef.current = onGeographyClick; }, [onGeographyClick]);
  useEffect(() => { dismissRef.current = onPlaceDismiss; }, [onPlaceDismiss]);

  useEffect(() => {
    if (!containerRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      // Standard style includes 3D buildings and landmarks out of the box.
      style: "mapbox://styles/mapbox/standard",
      ...HOME,
      maxBounds: [
        [TORONTO_BBOX[0] - 0.3, TORONTO_BBOX[1] - 0.2],
        [TORONTO_BBOX[2] + 0.3, TORONTO_BBOX[3] + 0.2],
      ],
    });
    map.addControl(new mapboxgl.ScaleControl({ unit: "metric" }), "bottom-left");
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
        const properties = e.features?.[0]?.properties;
        if (typeof properties?.name !== "string") return;
        map.getCanvas().style.cursor = "pointer";
        const people = typeof properties.population === "number" ? `${properties.population.toLocaleString("en-CA")} people`
          : properties.shaded ? "Population unknown" : "";
        hoverLabel.setLngLat(e.lngLat).setText(people ? `${properties.name} · ${people}` : properties.name).addTo(map);
      });
      map.on("mouseleave", "neighbourhood-hit", () => {
        map.getCanvas().style.cursor = "";
        hoverLabel.remove();
      });
      setReady(true);
    });

    return () => {
      container.removeEventListener("click", onContainerClick);
      markerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

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
    // Extra top/right padding keeps the shape clear of the overlays on the map.
    if (feature) map.fitBounds(boundsOf(feature.geometry), { padding: { top: 170, bottom: 60, left: 60, right: 90 }, maxZoom: 14, pitch: 45 });
  }, [ready, boundaries, selectedGeographyId]);

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
    map.flyTo({ center: selected.coordinates, zoom: 15.5, pitch: 60, essential: true });
  }, [selected]);

  return <div className={className}>
    <div ref={containerRef} className={styles.canvas} aria-label="Map of Toronto" role="region" />
    <div className={styles.controls} role="group" aria-label="Map controls">
      <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</button>
      <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button>
      <button type="button" aria-label="Reset rotation" title="Reset rotation" onClick={() => mapRef.current?.easeTo({ bearing: HOME.bearing, pitch: HOME.pitch })}>↻</button>
      <button type="button" aria-label="Show all of Toronto" title="Show all of Toronto" onClick={() => mapRef.current?.flyTo({ ...HOME, essential: true })}>⌂</button>
    </div>
  </div>;
}
