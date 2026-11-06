import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Neighbourhood Explorer | MCP Canada",
  description: "Explore Toronto neighbourhoods, historical Census periods, housing data and the evidence behind them.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
