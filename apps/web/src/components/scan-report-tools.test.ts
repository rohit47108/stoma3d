import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createGuestSession } from "@/lib/guest-scan";
import { ScanReportTools } from "./scan-report-tools";

describe("guest report actions", () => {
  it("offers local PDF creation separately from the browser print dialog", () => {
    const html = renderToStaticMarkup(
      createElement(ScanReportTools, {
        session: createGuestSession("test-report"),
      }),
    );
    expect(html).toContain("Create PDF report");
    expect(html).toContain("Print report");
    expect(html).not.toContain("Sign in");
    expect(html).not.toContain("Save or print report");
  });
});
