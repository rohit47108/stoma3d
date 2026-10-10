import { describe, expect, it } from "vitest";
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  StandardFonts,
  decodePDFRawStream,
  type PDFPage,
} from "pdf-lib";
import { DISCLAIMER } from "@stoma3d/contracts";
import { addReportPageFooters } from "../src/lib/reportPdf";

function pageContents(document: PDFDocument, page: PDFPage): string {
  const contents = page.node.Contents();
  const streams =
    contents instanceof PDFArray
      ? contents.asArray().map((ref) => document.context.lookup(ref))
      : [contents];
  return streams
    .filter((value): value is PDFRawStream => value instanceof PDFRawStream)
    .map((stream) =>
      new TextDecoder().decode(decodePDFRawStream(stream).decode()),
    )
    .join("\n");
}

function printedText(contents: string): string {
  return [...contents.matchAll(/<([0-9A-F]+)> Tj/g)]
    .map((match) => Buffer.from(match[1]!, "hex").toString("latin1"))
    .join("\n");
}

describe("native PDF page footers", () => {
  it("keeps original content and adds a notice and page number to every page", async () => {
    const original = await PDFDocument.create();
    original.setTitle("Stoma3D observation report");
    const font = await original.embedFont(StandardFonts.Helvetica);
    for (const [index, size] of [
      [612, 792],
      [595, 842],
      [792, 612],
    ].entries()) {
      original.addPage(size).drawText(`Original observation ${index + 1}`, {
        x: 24,
        y: 80,
        font,
        size: 12,
      });
    }
    const protectedBytes = await addReportPageFooters(await original.save());
    const reopened = await PDFDocument.load(protectedBytes);

    expect(reopened.getTitle()).toBe("Stoma3D observation report");
    expect(reopened.getPageCount()).toBe(3);
    for (const [index, page] of reopened.getPages().entries()) {
      const contents = pageContents(reopened, page);
      const text = printedText(contents);
      expect(text).toContain(`Original observation ${index + 1}`);
      expect(text).toContain(DISCLAIMER);
      expect(text).toContain(`${index + 1} / 3`);
      // 34 CSS-pixel print margins reserve 25.5 PDF points. Both footer
      // baselines stay below that content boundary, not over the page body.
      expect(contents.match(/1 0 0 1 [\d.]+ 12 Tm/g)).toHaveLength(2);
    }
  });

  it("refuses unreadable PDFs rather than treating missing page notices as success", async () => {
    await expect(
      addReportPageFooters(new TextEncoder().encode("not a PDF")),
    ).rejects.toThrow();
  });

  it("refuses an empty rendered document rather than saving a blank report", async () => {
    const empty = await PDFDocument.create();
    await expect(
      addReportPageFooters(await empty.save({ addDefaultPage: false })),
    ).rejects.toThrow("The report has no pages");
  });
});
