"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { MAPBOX_TOKEN, TORONTO_BBOX, TORONTO_CENTER, type Place } from "@/lib/mapbox";

type Props = {
  selected: Place | null;
  className?: string;
};

export default function MapView({ selected, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

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

    return () => {
      markerRef.current = null;
      mapRef.current = null;
      map.remove();
    };
  }, []);

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
