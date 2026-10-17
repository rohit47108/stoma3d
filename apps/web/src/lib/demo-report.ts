import { MOUTH_REGION_DETAILS } from "@stoma3d/contracts";
import { sampleCase } from "./demo-tour";

export function demoReportLines(matchConfirmed: boolean): string[] {
  const observation = sampleCase.observations[0];
  return [
    "SYNTHETIC SAMPLE - Prepared demonstration, not a patient record",
    "Sample scan: October 17, 2026 | 8 of 8 regions",
    "",
    "Observation: Left inner cheek - Small red area",
    `Approximate normalized area: ${observation.currentAreaPercent}% of the image`,
    `Shape: ${observation.shape}`,
    `Color: ${observation.color}`,
    `Texture: ${observation.texture}`,
    "",
    "Comparison: October 3 to October 17, 2026 (sample visits)",
    ...(matchConfirmed
      ? [
          "Sample match confirmed in the tour.",
          "Illustrative normalized area: 4.0% to 3.2% (20% smaller).",
        ]
      : ["Sample match not confirmed; change is not reported."]),
    "One synthetic image and two authored outlines illustrate comparison.",
    "These values are not physical measurements or model predictions.",
    "",
    "Regions included:",
    ...MOUTH_REGION_DETAILS.map((region, i) => `${i + 1}. ${region.label}`),
    "",
    "Input: AI-generated synthetic artwork; no patient photographs.",
    "Analysis: Prepared manual fixture, not live analysis.",
    `Case: ${sampleCase.id}`,
    "Map: procedural-v1 oral observation map; not personalized anatomy.",
    "",
    "This result is not a diagnosis.",
  ];
}

export async function createDemoReportPdf(
  matchConfirmed: boolean,
): Promise<Uint8Array<ArrayBuffer>> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle("Stoma3D - Sample observation report");
  pdf.setSubject(
    "Synthetic sample images and prepared results; not a patient record",
  );
  pdf.setCreator("Stoma3D");
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText("Stoma3D", {
    x: 44,
    y: 788,
    font: bold,
    size: 22,
    color: rgb(0.035, 0.427, 0.404),
  });
  page.drawText("Sample observation report", {
    x: 44,
    y: 756,
    font: bold,
    size: 16,
  });
  let y = 724;
  for (const line of demoReportLines(matchConfirmed)) {
    page.drawText(line, {
      x: 44,
      y,
      size: 10,
      font: regular,
      color: rgb(0.08, 0.176, 0.192),
    });
    y -= 19;
  }
  return new Uint8Array(await pdf.save());
}
