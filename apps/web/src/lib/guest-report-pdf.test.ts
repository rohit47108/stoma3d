import { describe, expect, it } from "vitest";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import {
  CONTRACT_VERSION,
  DISCLAIMER,
  MOUTH_REGIONS,
  type MouthRegion,
} from "@stoma3d/contracts";
import {
  createGuestSession,
  confirmGuestObservation,
  regionDetail,
  type GuestCapture,
  type GuestSession,
} from "./guest-scan";
import { createGuestReportPdf } from "./guest-report-pdf";

// A team-generated, solid-color JPEG. No medical input or model output fixture.
const photo =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD0iiiig4wooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/Z";

function capture(region: MouthRegion): GuestCapture {
  return {
    id: `capture-${region}`,
    region,
    capturedAt: "2026-10-09T12:00:00.000Z",
    image: photo,
    width: 64,
    height: 48,
    analysis: {
      contractVersion: CONTRACT_VERSION,
      captureId: `capture-${region}`,
      region,
      quality: {
        accepted: true,
        blurScore: 0.9,
        exposureScore: 0.8,
        glareScore: 0,
        obstructionScore: 0,
        faceDetected: false,
        reasons: [],
      },
      anatomyPrediction: {
        region,
        confidence: 0.9,
        supported: true,
        selectedRegionMatches: true,
      },
      candidateMask: null,
      descriptors: null,
      appearanceOutput: null,
      diseaseResearchOutput: null,
      uncertainty: {
        overallConfidence: 0.87,
        imageQualityConfidence: 0.9,
        datasetSimilarity: null,
        modelAgreement: null,
        limitations: ["Image-relative measurements are approximate."],
      },
      abstentionReasons: [],
      modelVersions: {
        anatomy: "anatomy-test-only",
        segmentation: "segmentation-test-only",
      },
      inputOrigin: "live_capture",
      analysisOrigin: "live_model",
      status: "complete",
      disclaimer: DISCLAIMER,
    },
  };
}

function session(regions = MOUTH_REGIONS.slice()): GuestSession {
  return {
    ...createGuestSession("report-test-session", "2026-10-09T12:00:00.000Z"),
    captures: regions.map(capture),
  };
}

async function readReport(bytes: Uint8Array) {
  const document = await PDFDocument.load(bytes);
  const text = document.context
    .enumerateIndirectObjects()
    .map(([, value]) => value)
    .filter(
      (value): value is PDFRawStream =>
        value instanceof PDFRawStream &&
        !value.dict.has(document.context.obj("Subtype")),
    )
    .flatMap((stream) => {
      const contents = new TextDecoder().decode(
        decodePDFRawStream(stream).decode(),
      );
      return [...contents.matchAll(/<([0-9A-F]+)> Tj/g)].map((match) =>
        new TextDecoder("windows-1252").decode(Buffer.from(match[1]!, "hex")),
      );
    })
    .join("\n");
  return { document, text };
}

describe("local browser PDF reports", () => {
  it("creates a reopenable report with every accepted capture and original provenance", async () => {
    const saved = session(MOUTH_REGIONS.slice().reverse());
    const { document, text } = await readReport(
      await createGuestReportPdf(saved),
    );
    expect(document.getTitle()).toBe("Stoma3D observation report");
    expect(document.getPageCount()).toBe(9);
    expect(text).toContain("8 of 8 regions captured");
    expect(text).toContain(saved.id);
    for (const region of MOUTH_REGIONS) {
      expect(text).toContain(regionDetail(region).label);
      expect(text).toContain(`capture-${region}`);
    }
    expect(text).toContain("Input: your photo. Analysis: live model");
    expect(text).toContain("Confidence: 87%");
    expect(text).toContain("anatomy-test-only");
    expect(text).toContain("segmentation-test-only");
    expect(text).toContain(DISCLAIMER);
    expect(text).toContain("No candidate area detected");
    expect(text).not.toContain("Color:");
    expect(text).not.toContain("diagnosed");
    expect(
      document
        .getPages()[1]!
        .node.Resources()!
        .get(document.context.obj("XObject")),
    ).toBeDefined();
  });

  it("prints candidate measurements and descriptors without confirming a suggested observation", async () => {
    const saved = session(["left_buccal_mucosa", "right_buccal_mucosa"]);
    for (const item of saved.captures) {
      item.analysis.candidateMask = {
        polygon: [
          [0.1, 0.2],
          [0.4, 0.2],
          [0.3, 0.5],
        ],
        boundingBox: [0.1, 0.2, 0.3, 0.3],
        normalizedArea: 0.09,
      };
      item.analysis.descriptors = {
        normalizedArea: 0.09,
        perimeter: 0.4,
        borderIrregularity: 1.6,
        meanRedness: 0.7,
        meanBrightness: 0.5,
        textureContrast: 0.4,
        measurementLabel: "approximate",
      };
    }
    const confirmed = confirmGuestObservation(saved, saved.captures[0]!.id);
    const { text } = await readReport(await createGuestReportPdf(confirmed));
    expect(text).toContain("approximately 9.0% of the image");
    expect(text).toContain("Observation confirmed by user");
    expect(text).toContain("Not confirmed by user");
    expect(text).toContain("Redder tone");
    expect(text).toContain("Uneven outline");
    expect(text).toContain("More varied surface texture");
    expect(confirmed.pins).toHaveLength(1);
  });

  it("keeps partial coverage and abstention reasons distinct from an analyzed empty mask", async () => {
    const saved = session(["dorsal_tongue"]);
    saved.captures[0]!.analysis.status = "abstained";
    saved.captures[0]!.analysis.analysisOrigin = "unavailable";
    saved.captures[0]!.analysis.abstentionReasons = [
      "Segmentation confidence was insufficient.",
    ];
    const { text } = await readReport(await createGuestReportPdf(saved));
    expect(text).toContain("1 of 8 regions captured");
    expect(text).toContain("Analysis needs another try");
    expect(text).toContain("Segmentation confidence was insufficient");
    expect(text).toContain("Analysis: unavailable");
    expect(text).not.toContain("No candidate area detected");
  });

  it("paginates long model details instead of clipping or silently dropping them", async () => {
    const saved = session(["dorsal_tongue"]);
    saved.captures[0]!.analysis.uncertainty.limitations = Array.from(
      { length: 80 },
      (_, index) =>
        `Limitation ${index}: ${"image-relative detail ".repeat(8)}`,
    );
    const { document, text } = await readReport(
      await createGuestReportPdf(saved),
    );
    expect(document.getPageCount()).toBeGreaterThan(2);
    expect(text).toContain("Limitation 79:");
    for (const page of document.getPages())
      expect(page.getSize()).toEqual({ width: 612, height: 792 });
  });

  it("refuses empty scans, rejected captures, and unreadable photos", async () => {
    await expect(createGuestReportPdf(session([]))).rejects.toThrow(
      "Add a photo",
    );
    const saved = session(["dorsal_tongue"]);
    saved.captures[0]!.analysis.quality.accepted = false;
    await expect(createGuestReportPdf(saved)).rejects.toThrow();
    saved.captures[0]!.analysis.quality.accepted = true;
    saved.captures[0]!.image = "data:image/jpeg;base64,dGVzdA==";
    await expect(createGuestReportPdf(saved)).rejects.toThrow();
  });

  it("cancels an export when its signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createGuestReportPdf(session(), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
