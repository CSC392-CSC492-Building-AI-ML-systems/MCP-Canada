import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PlacesSidebar, type ExplorerPlace, type SidebarMode } from "./PlacesSidebar";

const saved: ExplorerPlace[] = [{ id: "toronto-158-1", name: "Test neighbourhood", boundary: "toronto-158", year: 2021 }];
function render(mode: SidebarMode, recommended: ExplorerPlace[] = []) {
  return renderToStaticMarkup(createElement(PlacesSidebar, { mode, saved, recommended, onModeChange: () => {}, onSelect: () => {}, onPreview: () => {}, onRemove: () => {}, onCompare: () => {}, notice: "" }));
}
it("02A exposes a collapsed rail with the actual saved count", () => {
  const html = render("collapsed");
  expect(html).toContain("Expand saved places");
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("Test neighbourhood");
});
it("02B1 lists persisted places and does not invent match scores", () => {
  const html = render("saved");
  expect(html).toContain("Test neighbourhood");
  expect(html).toContain("Match score unavailable");
  expect(html).toContain("Remove Test neighbourhood 2021");
});
it("02B2 renders supplied recommendations with their summaries", () => {
  const html = render("recommended", [{ ...saved[0], summary: "Published summary", score: 70 }]);
  expect(html).toContain("Recommended places");
  expect(html).toContain("Published summary");
  expect(html).toContain("Match score 70 out of 100");
  expect(html).not.toContain("Remove Test neighbourhood");
});
it("shows an honest empty state when recommendations are not connected", () => {
  expect(render("recommended")).toContain("Personalized recommendations are not connected yet");
});
