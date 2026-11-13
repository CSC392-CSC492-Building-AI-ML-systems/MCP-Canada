import type { Metadata } from "next";
import "./globals.css";
import { DM_Sans } from "next/font/google";
import { TeacherProvider } from "@/components/workflow/Teacher";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });

export const metadata: Metadata = {
  title: "Neighbourhood Explorer | MCP Canada",
  description: "Explore Toronto neighbourhoods, historical Census periods, housing data and the evidence behind them.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={dmSans.variable}><TeacherProvider>{children}</TeacherProvider></body></html>;
}
