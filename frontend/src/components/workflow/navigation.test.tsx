import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/" }));
import PersonalizePage from "@/app/housing/personalize/page";
import ProfilePage from "@/app/housing/profile/page";
import { WorkflowHeader } from "./WorkflowHeader";

it("offers the two workflow branches from the choice page", () => {
  const html = renderToStaticMarkup(createElement(PersonalizePage));
  expect(html).toMatch(/href="\/housing\/profile\/?"/);
  expect(html).toMatch(/href="\/housing\/?"/);
  expect(html).toContain("Fill out my preferences");
  expect(html).toContain("Skip for now");
});
it("profile has a real submit action and working comparison navigation", () => {
  const html = renderToStaticMarkup(createElement(ProfilePage));
  expect(html).toContain('type="submit"');
  expect(html).toContain("Find my neighbourhoods");
  expect(html).toMatch(/href="\/housing\/compare\/?"/);
  expect(html).not.toContain('aria-disabled="true"');
});
it("comparison navigation leads back to the map and the editable profile", () => {
  const html = renderToStaticMarkup(createElement(WorkflowHeader, { compare: true }));
  expect(html).toMatch(/href="\/housing\/?"/);
  expect(html).toMatch(/href="\/housing\/profile\/?"/);
  expect(html).toContain('aria-current="page"');
});
