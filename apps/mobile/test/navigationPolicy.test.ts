import { describe, expect, it } from "vitest";

import { routeRequiresConsent } from "../src/lib/navigationPolicy";

describe("consent route policy", () => {
  it("lets users explore home and the map before starting a scan", () => {
    expect(routeRequiresConsent([])).toBe(false);
    expect(routeRequiresConsent(["index"])).toBe(false);
    expect(routeRequiresConsent(["onboarding"])).toBe(false);
    expect(routeRequiresConsent(["(tabs)", "home"])).toBe(false);
    expect(routeRequiresConsent(["(tabs)", "map"])).toBe(false);
    expect(routeRequiresConsent(["(tabs)", "scan"])).toBe(false);
    expect(routeRequiresConsent(["(tabs)", "timeline"])).toBe(false);
    expect(routeRequiresConsent(["(tabs)", "settings"])).toBe(false);
    expect(routeRequiresConsent(["learn", "scan-practice"])).toBe(false);
    expect(routeRequiresConsent(["capture", "[region]"])).toBe(true);
    expect(routeRequiresConsent(["report"])).toBe(true);
  });

  it("requires consent for saved health records and capture", () => {
    expect(routeRequiresConsent(["result", "[captureId]"])).toBe(true);
    expect(routeRequiresConsent(["compare"])).toBe(true);
  });
});
