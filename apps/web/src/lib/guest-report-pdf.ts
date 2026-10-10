import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { DISCLAIMER, MOUTH_REGION_DETAILS } from "@stoma3d/contracts";
import mouthAsset from "../../../../assets/mouth/manifest.json";
import { analysisOriginLabel, inputOriginLabel } from "./analysis-provenance";
import {
  captureSummary,
  guestSessionSchema,
  regionDetail,
  type GuestSession,
} from "./guest-scan";
import { visualDescriptorDescriptions } from "./visual-descriptor-descriptions";

const margin = 48;
const pageWidth = 612;
const pageHeight = 792;
const contentWidth = pageWidth - margin * 2;
const ink = rgb(0.09, 0.18, 0.18);
const teal = rgb(0.04, 0.39, 0.37);
const muted = rgb(0.31, 0.38, 0.38);

/** Create a local PDF from validated saved data. No network, storage write, or inferred finding. */
export async function createGuestReportPdf(
  session: GuestSession,
  signal?: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
  signal?.throwIfAborted();
  const saved = guestSessionSchema.parse(session);
  if (!saved.captures.length)
    throw new Error("Add a photo before creating a report.");
  const metadata = JSON.stringify({
    ...saved,
    captures: saved.captures.map((item) => ({ ...item, image: undefined })),
  });
  if (
    metadata.length > 100_000 ||
    saved.captures.some(
      (item) =>
        item.image.length > 35_000_000 || item.analysis.quality.faceDetected,
    )
  ) {
    throw new Error(
      "This scan cannot be exported. Review its saved photos and details.",
    );
  }

  // API: https://pdf-lib.js.org/docs/api/classes/pdfdocument#embedfont
  const document = await PDFDocument.create();
  document.setTitle("Stoma3D observation report");
  document.setCreator("Stoma3D");
  document.setLanguage("en-US");
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page!: PDFPage;
  let cursor = 0;

  function newPage(title: string) {
    signal?.throwIfAborted();
    if (document.getPageCount() >= 100)
      throw new Error("This report is too long to export.");
    page = document.addPage([pageWidth, pageHeight]);
    page.drawText("Stoma3D", {
      x: margin,
      y: pageHeight - 44,
      size: 12,
      font: bold,
      color: teal,
    });
    page.drawLine({
      start: { x: margin, y: pageHeight - 57 },
      end: { x: pageWidth - margin, y: pageHeight - 57 },
      thickness: 1,
      color: teal,
    });
    cursor = pageHeight - 90;
    paragraph(title, 20, bold);
    cursor -= 8;
  }

  function paragraph(text: string, size = 10, font: PDFFont = regular) {
    // Preserve content; normalize typographic punctuation, but never silently drop an unsupported word.
    const normalized = text
      .replace(/[\u2010-\u2015]/g, "-")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"');
    const lineHeight = size * 1.45;
    const lines: string[] = [];
    let line = "";
    // Font-metric wrapping also splits long IDs/version hashes that contain no spaces.
    // https://pdf-lib.js.org/docs/api/classes/pdffont#widthoftextatsize
    for (const word of normalized.split(/\s+/)) {
      if (!word) continue;
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= contentWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      for (const character of word) {
        if (
          line &&
          font.widthOfTextAtSize(line + character, size) > contentWidth
        ) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    if (line) lines.push(line);
    for (const item of lines) {
      if (cursor - lineHeight < 72) newPage("Details (continued)");
      page.drawText(item, { x: margin, y: cursor, font, size, color: ink });
      cursor -= lineHeight;
    }
    cursor -= 8;
  }

  newPage("Observation report");
  paragraph(`${saved.captures.length} of 8 regions captured`, 14, bold);
  paragraph(`Scan started: ${new Date(saved.createdAt).toLocaleString()}`);
  paragraph(`Session: ${saved.id}`);
  paragraph(
    `Symptoms: ${saved.intake.symptoms.join(", ") || "None reported / not sure"}. Duration: ${saved.intake.duration}. Change: ${saved.intake.change}.`,
  );
  paragraph(
    `${DISCLAIMER} Measurements are approximate and relative to the image, not millimeters.`,
  );
  cursor -= 8;
  paragraph("Region coverage", 14, bold);
  for (const region of MOUTH_REGION_DETAILS) {
    paragraph(
      `${region.label}: ${saved.captures.some((item) => item.region === region.id) ? "Photo accepted" : "Not captured"}`,
    );
  }
  paragraph(
    `Map asset: ${mouthAsset.assetVersion}. A general oral observation map, not a reconstructed model of the user's mouth.`,
    9,
  );

  // Canonical order matches the capture guide and coverage list, even after a region is retaken.
  for (const region of MOUTH_REGION_DETAILS) {
    const capture = saved.captures.find((item) => item.region === region.id);
    if (!capture) continue;
    signal?.throwIfAborted();
    newPage(regionDetail(capture.region).label);
    paragraph(`Capture: ${capture.id}`, 9);
    paragraph(`Captured: ${new Date(capture.capturedAt).toLocaleString()}`, 9);
    const image = await document.embedJpg(capture.image);
    signal?.throwIfAborted();
    if (image.width !== capture.width || image.height !== capture.height) {
      throw new Error(
        "The saved photo dimensions do not match. Open the result and try again.",
      );
    }
    const scale = Math.min(contentWidth / image.width, 280 / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    const x = margin + (contentWidth - width) / 2;
    const top = cursor - 4;
    page.drawImage(image, { x, y: top - height, width, height });
    const mask = capture.analysis.candidateMask;
    if (mask) {
      const path =
        mask.polygon
          .map(
            ([nx, ny], index) =>
              `${index ? "L" : "M"} ${nx * width},${ny * height}`,
          )
          .join(" ") + " Z";
      // SVG coordinates are top-down; drawSvgPath handles the PDF y-axis flip.
      // https://pdf-lib.js.org/docs/api/classes/pdfpage#drawsvgpath
      page.drawSvgPath(path, {
        x,
        y: top,
        color: teal,
        opacity: 0.28,
        borderColor: rgb(1, 1, 1),
        borderWidth: 1,
        borderOpacity: 0.9,
      });
    }
    cursor = top - height - 20;
    paragraph(
      mask
        ? `Candidate area: approximately ${(mask.normalizedArea * 100).toFixed(1)}% of the image. ${saved.pins.some((pin) => pin.captureId === capture.id) ? "Observation confirmed by user." : "Not confirmed by user."}`
        : captureSummary(capture),
      12,
      bold,
    );
    if (capture.analysis.descriptors) {
      for (const { label, description } of visualDescriptorDescriptions(
        capture.analysis.descriptors,
      ))
        paragraph(`${label}: ${description}.`);
    }
    paragraph(
      `Input: ${inputOriginLabel(capture.analysis.inputOrigin)}. Analysis: ${analysisOriginLabel(capture.analysis.analysisOrigin)}. Status: ${capture.analysis.status}. Confidence: ${Math.round(capture.analysis.uncertainty.overallConfidence * 100)}%.`,
    );
    for (const reason of [
      ...capture.analysis.abstentionReasons,
      ...capture.analysis.uncertainty.limitations,
    ])
      paragraph(reason, 9);
    paragraph(
      `Model versions: ${Object.entries(capture.analysis.modelVersions)
        .map(([name, version]) => `${name}: ${version}`)
        .join("; ")}`,
      9,
    );
  }
  for (const [index, reportPage] of document.getPages().entries()) {
    reportPage.drawText(DISCLAIMER, {
      x: margin,
      y: 36,
      size: 8,
      font: regular,
      color: muted,
    });
    reportPage.drawText(`${index + 1} / ${document.getPageCount()}`, {
      x: pageWidth - margin - 35,
      y: 36,
      size: 8,
      font: regular,
      color: muted,
    });
  }
  signal?.throwIfAborted();
  const bytes = await document.save();
  signal?.throwIfAborted();
  return new Uint8Array(bytes);
}
