import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  permanentRedirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("@/components/scan-experience", () => ({
  ScanExperience: () =>
    createElement("main", { id: "main-content" }, "Scan workspace"),
}));

import HomePage from "./page";
import ScanPage from "./scan/page";
import { SiteChrome } from "@/components/site-chrome";

describe("the clean scan URL", () => {
  it("renders scanning directly at the root without the marketing page", () => {
    expect(renderToStaticMarkup(createElement(HomePage))).toContain(
      "Scan workspace",
    );
  });
  it("does not wrap the root workspace in marketing navigation", () => {
    expect(
      renderToStaticMarkup(createElement(SiteChrome, null, "workspace")),
    ).toBe("workspace");
  });
  it("sends legacy scan bookmarks back to the clean root URL", () => {
    expect(() => ScanPage()).toThrow("redirect:/");
  });
});
