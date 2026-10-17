import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("sample and real-scan boundaries", () => {
  it("keeps prepared data out of the live workspace and request client", () => {
    for (const file of [
      "../components/scan-workspace.tsx",
      "./scan-client.ts",
      "./guest-storage.ts",
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(
        /from ["'].*(?:demo-tour|guided-demo|demo-report)/,
      );
    }
  });
  it("keeps the tour out of live storage and network services", () => {
    for (const file of [
      "../components/guided-demo.tsx",
      "../components/demo-report.tsx",
      "./demo-tour.ts",
      "./demo-report.ts",
    ]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(
        /\b(?:fetch|saveGuestUpdate|addGuestCapture|createGuestSession|encryptGuestRecord)\s*\(/,
      );
      expect(source).not.toMatch(
        /from ["'].*(?:guest-storage|guest-save|scan-client)/,
      );
    }
  });
});
