import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScanIntake } from "./scan-intake";

describe("scan intake accessibility", () => {
  it("renders a programmatically focusable consent heading without adding a tab stop", () => {
    const html = renderToStaticMarkup(
      createElement(ScanIntake, {
        onFinish: () => undefined,
        onCancel: () => undefined,
      }),
    );

    expect(html).toContain('aria-labelledby="intake-heading"');
    expect(html).toContain(
      '<h1 id="intake-heading" tabindex="-1">Before your scan</h1>',
    );
  });

  it("keeps the first scan action unavailable until consent is given", () => {
    const html = renderToStaticMarkup(
      createElement(ScanIntake, {
        onFinish: () => undefined,
        onCancel: () => undefined,
      }),
    );

    expect(html).toContain(
      '<button type="button" class="scan-button scan-button-primary" disabled="">Continue</button>',
    );
    expect(html).toContain("I have permission to scan");
  });
});
