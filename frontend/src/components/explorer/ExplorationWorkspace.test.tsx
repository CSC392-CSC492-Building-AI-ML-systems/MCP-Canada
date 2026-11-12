import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ExplorationWorkspace } from "./ExplorationWorkspace";

it("mounts the map before Census data or a neighbourhood selection is available", () => {
  const selections: unknown[] = [];
  const html = renderToStaticMarkup(createElement(ExplorationWorkspace, {
    renderMap: (selection) => {
      selections.push(selection);
      return createElement("div", { "data-testid": "live-map" }, "Toronto map");
    },
  }));
  expect(selections).toEqual([null]);
  expect(html).toContain('data-testid="live-map"');
  expect(html).not.toContain("Loading neighbourhoods…");
});
