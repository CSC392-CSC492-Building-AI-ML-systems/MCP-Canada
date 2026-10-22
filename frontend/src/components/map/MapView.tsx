"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { MAPBOX_TOKEN, TORONTO_BBOX, TORONTO_CENTER } from "@/lib/mapbox";

type Props = {
  className?: string;
};

export default function MapView({ className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

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
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new mapboxgl.ScaleControl({ unit: "metric" }), "bottom-left");
    mapRef.current = map;

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, []);

  return <div ref={containerRef} className={className} aria-label="Map of Toronto" role="region" />;
}
