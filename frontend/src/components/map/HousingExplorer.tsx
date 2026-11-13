"use client";
import { ExplorationWorkspace } from "@/components/explorer/ExplorationWorkspace";
import type { ExplorerPlace, SidebarMode } from "@/components/explorer/PlacesSidebar";
import HousingMap from "./HousingMap";
export function HousingExplorer({ initialSidebar = "collapsed", initialAcrossTime = false, recommendedPlaces, recommendationNotice }: {
  initialSidebar?: SidebarMode; initialAcrossTime?: boolean; recommendedPlaces?: ExplorerPlace[]; recommendationNotice?: string;
}) {
  return <ExplorationWorkspace initialSidebar={initialSidebar} initialAcrossTime={initialAcrossTime} recommendedPlaces={recommendedPlaces} recommendationNotice={recommendationNotice}
    renderMap={(selection, onSelectionChange) => <HousingMap selection={selection} onSelectionChange={onSelectionChange} />} />;
}
