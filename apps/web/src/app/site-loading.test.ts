import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

describe("page loading layout", () => {
  it("reserves a full viewport while the page content streams in", () => {
    // The shorter loading placeholder exposed the footer before the page arrived.
    const loadingRule = styles.match(/\.loading-page\s*\{([^}]+)\}/)?.[1];
    expect(loadingRule).toMatch(/min-height:\s*100dvh\s*;/);
  });

  it("keeps empty and error pages at their existing minimum height", () => {
    const stateRule = styles.match(
      /\.loading-page,\s*\.state-page\s*\{([^}]+)\}/,
    )?.[1];
    expect(stateRule).toMatch(/min-height:\s*65dvh\s*;/);
  });
});
