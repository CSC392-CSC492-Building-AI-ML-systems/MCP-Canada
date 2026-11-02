"use client";

import { ExplorationWorkspace } from "@/components/explorer/ExplorationWorkspace";
import HousingMap from "@/components/map/HousingMap";

export default function HousingPage() {
  return <ExplorationWorkspace renderMap={selection => <HousingMap selection={selection} />} />;
}
