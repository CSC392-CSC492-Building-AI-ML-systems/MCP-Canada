// Loaded from a server layout so the stylesheet is in the initial HTML before
// the map initializes; Mapbox checks for it when the Map is constructed.
import "mapbox-gl/dist/mapbox-gl.css";
import { DM_Sans } from "next/font/google";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });

export default function HousingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className={dmSans.variable} style={{ display: "contents" }}>{children}</div>;
}
