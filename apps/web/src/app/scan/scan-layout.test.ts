import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./scan.css", import.meta.url), "utf8");

describe("scan layout safeguards", () => {
  it("allows scan progress to wrap below the heading when text is enlarged", () => {
    // Guard the rule behind the real-browser enlarged-text overflow regression.
    const headingRule = styles.match(/\.scan-page-heading\s*\{([^}]+)\}/)?.[1];
    expect(headingRule).toMatch(/flex-wrap:\s*wrap\s*;/);
  });

  it("reserves keyboard scroll space above the fixed mobile navigation", () => {
    const rootRule = styles.match(
      /html:has\(\.scan-shell\)\s*\{([^}]+)\}/,
    )?.[1];
    expect(rootRule).toMatch(
      /scroll-padding-bottom:\s*var\(\s*--scan-navigation-inset,/,
    );
  });

  it("anchors expanded rotation controls above the complete zoom-control group", () => {
    const rotationRule = styles.match(/\.scan-map-rotation\s*\{([^}]+)\}/)?.[1];
    expect(rotationRule).toMatch(/position:\s*static\s*;/);
  });
});
