"use client";

import { ExplorationWorkspace } from "@/components/explorer/ExplorationWorkspace";
import HousingMap from "@/components/map/HousingMap";

export default function HousingPage() {
  return <ExplorationWorkspace renderMap={(selection, onSelectionChange) => <HousingMap selection={selection} onSelectionChange={onSelectionChange} />} />;
}
