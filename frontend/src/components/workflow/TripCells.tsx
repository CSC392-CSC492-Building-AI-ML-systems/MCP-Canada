import { clockLabel, routeSummary } from "@/lib/routing";
import type { Trip, TripState } from "./commutes";

const destinationName: Record<Trip, string> = { work: "workplace", school: "school" };

/** Caption under a trip row heading: how the times were found, or why they are missing. */
export function tripNote(trip: Trip, state: TripState): string {
  switch (state.status) {
    case "no-destination": return `Choose a ${destinationName[trip]} address in your profile`;
    case "loading": return "Calculating travel times…";
    case "error": return state.message;
    case "ready": {
      const r = state.result;
      return r.mode === "Transit"
        ? `TTC schedule, arriving by ${clockLabel(r.arriveBy)} on a weekday · from a central point in each neighbourhood`
        : `${r.mode} route from Mapbox · from a central point in each neighbourhood`;
    }
  }
}

/** One place's travel time with its route and how it compares with the user's limit. */
export function TripValue({ state, id, limit }: { state: TripState; id: string; limit?: number }) {
  if (state.status === "loading") return <>…</>;
  if (state.status !== "ready") return <>—</>;
  const c = state.result.byId[id];
  if (!c || c.minutes === null) return <>—{c?.reason && <small>{c.reason}</small>}</>;
  const detail = state.result.mode === "Transit"
    ? c.walkOnly ? "Walking is quicker than any scheduled TTC trip" : `${routeSummary(c.legs)} · leave by ${clockLabel(c.leaveBy)}`
    : c.km != null ? `${c.km.toLocaleString("en-CA")} km` : "";
  return <>{c.minutes} min{detail && <small>{detail}</small>}{limit != null && limit > 0 && <small>{c.minutes <= limit ? "Within" : "Over"} your {limit} min limit</small>}</>;
}
