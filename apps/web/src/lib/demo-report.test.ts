import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { createDemoReportPdf, demoReportLines } from "./demo-report";

describe("the sample report", () => {
  it("uses the same observation and clearly identifies prepared data", async () => {
    expect(demoReportLines(true).join(" ")).toContain("SYNTHETIC SAMPLE");
    expect(demoReportLines(true).join(" ")).toContain("3.2%");
    expect(demoReportLines(true).join(" ")).toContain("20% smaller");
    const bytes = await createDemoReportPdf(true);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe("Stoma3D - Sample observation report");
  });
  it("does not claim a confirmed comparison if the visitor skipped it", () => {
    const text = demoReportLines(false).join(" ");
    expect(text).toContain("not confirmed");
    expect(text).not.toContain("20% smaller");
  });
});
