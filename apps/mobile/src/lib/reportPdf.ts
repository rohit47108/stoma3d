import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { DISCLAIMER } from "@stoma3d/contracts";

/** Add page notices to the rendered native PDF before it is encrypted. */
export async function addReportPageFooters(
  bytes: Uint8Array,
): Promise<Uint8Array> {
  // Stamp after native pagination: Android WebView can place fixed HTML
  // footers over headings. The HTML reserves a 34px / 25.5pt bottom margin.
  // https://pdf-lib.js.org/docs/api/classes/pdfdocument#load
  // https://pdf-lib.js.org/docs/api/classes/pdfpage#drawtext
  const document = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = document.getPages();
  if (!pages.length) throw new Error("The report has no pages. Try again.");
  const font = await document.embedFont(StandardFonts.Helvetica);
  const margin = 21;
  const size = 8;
  const color = rgb(0.36, 0.43, 0.49);
  for (const [index, page] of pages.entries()) {
    const number = `${index + 1} / ${pages.length}`;
    page.drawText(DISCLAIMER, { x: margin, y: 12, size, font, color });
    page.drawText(number, {
      x: page.getWidth() - margin - font.widthOfTextAtSize(number, size),
      y: 12,
      size,
      font,
      color,
    });
  }
  return document.save();
}
