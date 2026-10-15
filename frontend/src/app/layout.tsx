import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MCP Canada",
  description: "Next.js and Django project starter",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
