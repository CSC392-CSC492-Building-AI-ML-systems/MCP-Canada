"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { MAPBOX_TOKEN, TORONTO_BBOX, TORONTO_CENTER, type Place } from "@/lib/mapbox";
import { boundsOf, type Boundaries } from "@/lib/boundaries";

type Props = {
  selected: Place | null;
  boundaries?: Boundaries | null;
  selectedGeographyId?: string;
  onGeographyClick?: (geographyId: string) => void;
  className?: string;
};

const SOURCE = "neighbourhoods";
const EMPTY: Boundaries = { type: "FeatureCollection", features: [] };
const isSelected = (id: string) => ["==", ["get", "geography_id"], id];

export default function MapView({ selected, boundaries, selectedGeographyId, onGeographyClick, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [ready, setReady] = useState(false);
  // The load handler is registered once, so it reads the latest callback from a ref.
  const clickRef = useRef(onGeographyClick);
  // A neighbourhood picked on the map is already in view, so the camera stays put.
  const clickedIdRef = useRef<string | null>(null);

  useEffect(() => { clickRef.current = onGeographyClick; }, [onGeographyClick]);

  useEffect(() => {
    if (!containerRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      // Standard style includes 3D buildings and landmarks out of the box.
      style: "mapbox://styles/mapbox/standard",
      center: TORONTO_CENTER,
      zoom: 11,
      pitch: 45,
      bearing: -17,
      maxBounds: [
        [TORONTO_BBOX[0] - 0.3, TORONTO_BBOX[1] - 0.2],
        [TORONTO_BBOX[2] + 0.3, TORONTO_BBOX[3] + 0.2],
      ],
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");
    map.addControl(new mapboxgl.ScaleControl({ unit: "metric" }), "bottom-left");
    mapRef.current = map;

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
      map.on("mouseenter", "neighbourhood-hit", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "neighbourhood-hit", () => { map.getCanvas().style.cursor = ""; });
      setReady(true);
    });

    return () => {
      markerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

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
    // Extra top/bottom padding keeps the shape clear of the workspace's selects and timeline.
    if (feature) map.fitBounds(boundsOf(feature.geometry), { padding: { top: 200, bottom: 300, left: 60, right: 60 }, maxZoom: 14, pitch: 45 });
  }, [ready, boundaries, selectedGeographyId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected) return;
    markerRef.current?.remove();
    markerRef.current = new mapboxgl.Marker({ color: "#2f5d3a" })
      .setLngLat(selected.coordinates)
      .setPopup(new mapboxgl.Popup({ offset: 24 }).setText(selected.address || selected.name))
      .addTo(map)
      .togglePopup();
    map.flyTo({ center: selected.coordinates, zoom: 15.5, pitch: 60, essential: true });
  }, [selected]);

  return <div ref={containerRef} className={className} aria-label="Map of Toronto" role="region" />;
}
