import { expect, it } from "vitest";
import { parseProfile, profileForSave, type SearchProfile } from "./state";
import { scoreBreakdown } from "./scoring";
import type { PlaceExtras } from "./comparison-extras";

const work = { lng: -79.38, lat: 43.65 };
const school = { lng: -79.4, lat: 43.66 };
const saved: SearchProfile = { version: 1, income: "72000", rent: "2400", mode: "Transit", work: "100 King St W", school: "UofT",
  trip: 45, priorities: [1, 2], weights: [5, 4, 3, 3, 2, 1], interests: [], notes: "", workPoint: work, schoolPoint: school };

it("accepts a blank rent but still rejects invalid rents", () => {
  expect(parseProfile(JSON.stringify({ ...saved, rent: "" }))).toEqual({ ...saved, rent: "" });
  expect(parseProfile(JSON.stringify({ ...saved, rent: "0" }))).toBeNull();
  expect(parseProfile(JSON.stringify({ ...saved, rent: "abc" }))).toBeNull();
});

it("saves valid fields when another field is invalid, keeping that field's last saved value", () => {
  const { profile, held } = profileForSave({ ...saved, income: "-5", trip: 60, weights: [0, 5, 5, 5, 5, 5] }, saved);
  expect(held).toEqual(["income"]);
  expect(profile).toMatchObject({ income: "72000", trip: 60, weights: [0, 5, 5, 5, 5, 5] });
  expect(parseProfile(JSON.stringify(profile))).not.toBeNull();
});

it("saves blank optional fields, but keeps the saved rent while the rent box is cleared", () => {
  const cleared = profileForSave({ ...saved, income: "", rent: "", notes: "" }, saved);
  expect(cleared.profile).toMatchObject({ income: "", rent: "2400" });
  expect(cleared.held).toEqual(["rent"]);
  // With no rent ever saved, everything else is still saved with a blank rent.
  const first = profileForSave({ ...saved, rent: "" }, null);
  expect(first.held).toEqual([]);
  expect(first.profile).toMatchObject({ rent: "", trip: 45, workPoint: work });
  expect(profileForSave({ ...saved, rent: "0" }, null)).toMatchObject({ held: ["rent"], profile: { rent: "" } });
});

it("keeps each saved address and its coordinates while a new one is typed, independently", () => {
  const { profile, held } = profileForSave({ ...saved, work: "200 Ba", workPoint: null }, saved);
  expect(held).toEqual(["work"]);
  expect(profile).toMatchObject({ work: "100 King St W", workPoint: work, school: "UofT", schoolPoint: school });
  // Clearing an address is deliberate and removes only that trip.
  expect(profileForSave({ ...saved, work: "", workPoint: null }, saved).profile).toMatchObject({ work: "", workPoint: null, schoolPoint: school });
  // A newly chosen suggestion replaces the old one.
  const next = { lng: -79.5, lat: 43.7 };
  expect(profileForSave({ ...saved, work: "New place", workPoint: next }, saved).profile).toMatchObject({ work: "New place", workPoint: next });
  // A point outside the Toronto area is never saved.
  expect(profileForSave({ ...saved, work: "Ottawa", workPoint: { lng: -75.7, lat: 45.4 } }, null).profile).toMatchObject({ work: "Ottawa", workPoint: null });
  // Typed text with nothing saved before is kept as text, without coordinates.
  expect(profileForSave({ ...saved, school: "Some school", schoolPoint: null }, null)).toMatchObject({ held: [], profile: { school: "Some school", schoolPoint: null } });
});

it("persists intentional clearing of income, notes and both addresses", () => {
  const filled = { ...saved, notes: "Near a park" };
  const { profile, held } = profileForSave({ ...filled, income: "", notes: "", work: "", workPoint: null, school: "", schoolPoint: null }, filled);
  expect(held).toEqual([]);
  expect(profile).toMatchObject({ income: "", notes: "", work: "", workPoint: null, school: "", schoolPoint: null, rent: "2400" });
  // Once cleared, the old address can't come back when something new is typed without picking a suggestion.
  expect(profileForSave({ ...filled, work: "Some", workPoint: null }, profile).profile).toMatchObject({ work: "Some", workPoint: null });
});

it("is stable once saved, so autosave doesn't loop", () => {
  const draft = { ...saved, rent: "", income: "x", work: "typing", workPoint: null };
  const once = profileForSave(draft, saved).profile;
  expect(profileForSave(draft, once).profile).toEqual(once);
});

const noRanks = { libraries: null, schools: null, groceries: null, transitStops: null, dining: null, errands: null, childcare: null, culturalSpaces: null };
const extras: PlaceExtras = { population: null, childrenPct: null, seniorsPct: null, lowRisePct: null, immigrantPct: null, visibleMinorityPct: null,
  ...noRanks, ranks: { ...noRanks, libraries: 80, schools: 80, groceries: 80, transitStops: 80 }, safety: null, safetyGap: null, parks: null, greenSharePct: null, greenRank: null };

it("leaves a blank rent and a missing work address out of the score instead of counting them as 0", () => {
  const profile = { ...saved, rent: "", workPoint: null, weights: [5, 5, 5, 5, 0, 0] };
  const b = scoreBreakdown(1800, extras, profile, { school: 20 })!;
  const status = Object.fromEntries(b.factors.map(f => [f.key, f.status]));
  expect(status).toMatchObject({ affordability: "unavailable", commute: "unavailable", school: "scored", amenities: "scored" });
  expect(b.coverage).toEqual({ used: 2, weighted: 4 });
  // Only scored factors count: school (100) and amenities (80), equally weighted.
  expect(b.score).toBe(90);
  expect(b.flags).not.toContain("over_budget");
});
