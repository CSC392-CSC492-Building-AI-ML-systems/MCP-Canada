// Loaded from a server layout so the stylesheet is in the initial HTML before
// the map initializes; Mapbox checks for it when the Map is constructed.
import "mapbox-gl/dist/mapbox-gl.css";

export default function ExploreLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
