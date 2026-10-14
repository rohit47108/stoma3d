import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureRecord, ObservationPin } from "../src/types";

const boundary = vi.hoisted(() => ({
  print: vi.fn(),
  encrypt: vi.fn(),
  deleteFile: vi.fn(),
  fileInfo: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  footers: vi.fn(),
  resizeImage: vi.fn(),
  files: new Set<string>(),
}));

vi.mock("expo-crypto", () => ({ randomUUID: () => "test-report" }));
vi.mock("expo-print", () => ({ printToFileAsync: boundary.print }));
vi.mock("expo-sharing", () => ({}));
vi.mock("expo-image-manipulator", () => ({
  manipulateAsync: boundary.resizeImage,
  SaveFormat: { JPEG: "jpeg" },
}));
vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  deleteAsync: boundary.deleteFile,
  getInfoAsync: boundary.fileInfo,
  EncodingType: { Base64: "base64" },
  readAsStringAsync: boundary.readFile,
  writeAsStringAsync: boundary.writeFile,
  readDirectoryAsync: async (directory: string) =>
    [...boundary.files]
      .filter((uri) => uri.startsWith(directory))
      .map((uri) => uri.slice(directory.length)),
}));
vi.mock("@/constants", () => import("../src/constants"));
vi.mock(
  "@/lib/analysisPresentation",
  () => import("../src/lib/analysisPresentation"),
);
vi.mock("@/lib/guidanceRules", () => import("../src/lib/guidanceRules"));
vi.mock("@/lib/reportPolicy", () => import("../src/lib/reportPolicy"));
vi.mock(
  "@/lib/reportCalibration",
  () => import("../src/lib/reportCalibration"),
);
vi.mock("@/lib/reportMarkup", () => import("../src/lib/reportMarkup"));
vi.mock("@/lib/reportPdf", () => ({ addReportPageFooters: boundary.footers }));
vi.mock("@/lib/resultCopy", () => import("../src/lib/resultCopy"));
vi.mock("@/lib/tempFiles", () => import("../src/lib/tempFiles"));
vi.mock("@/lib/secureFiles", () => ({
  encryptFile: boundary.encrypt,
  decryptToTemporaryFile: vi.fn(),
  removeTemporaryFile: vi.fn(),
}));

import { generateEncryptedObservationReport } from "../src/lib/report";
import {
  purgeStoma3DBackgroundTemporaryFiles,
  purgeStoma3DTemporaryFiles,
  removeReportTemporaryFile,
} from "../src/lib/tempFiles";

const input = {
  session: {
    id: "test-session",
    createdAt: "2026-10-10T12:00:00.000Z",
    demo: false,
    label: "Test scan",
    protocol: "standard_eight_region" as const,
  },
  captures: [],
  analyses: {},
  comparisons: [],
  pins: [],
  profile: null,
  consentedAt: "2026-10-10T12:00:00.000Z",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  boundary.files.clear();
  boundary.fileInfo.mockReset();
  boundary.fileInfo.mockImplementation(async (uri: string) => ({
    exists: [...boundary.files].some((file) => file.startsWith(uri)),
  }));
  boundary.deleteFile.mockReset();
  boundary.deleteFile.mockImplementation(async (uri: string) => {
    for (const file of boundary.files) {
      if (file === uri || (uri.endsWith("/") && file.startsWith(uri))) {
        boundary.files.delete(file);
      }
    }
  });
  boundary.encrypt.mockResolvedValue("file:///protected/test-report.enc");
  boundary.readFile.mockResolvedValue("cGRm");
  boundary.footers.mockResolvedValue(new TextEncoder().encode("stamped pdf"));
  boundary.writeFile.mockResolvedValue(undefined);
  boundary.resizeImage.mockResolvedValue({
    uri: "file:///cache/report-photo.jpg",
    base64: "AQID",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("native report file recovery", () => {
  it("labels a saved pin clearly while keeping review priority disabled", async () => {
    boundary.print.mockResolvedValue({
      uri: "file:///cache/Print/pin-status.pdf",
    });
    const pin: ObservationPin = {
      id: "saved-pin",
      region: "right_buccal_mucosa",
      meshId: "buccal_right",
      uvX: 0.5,
      uvY: 0.5,
      assetVersion: "procedural-v1",
      userConfirmed: true,
      firstObservedAt: input.session.createdAt,
      status: "review_unavailable",
      captureIds: ["confirmed-photo"],
    };

    await generateEncryptedObservationReport({ ...input, pins: [pin] });

    const html = boundary.print.mock.calls[0][0].html as string;
    expect(html).toContain("<td>Observation saved</td>");
    expect(html).not.toContain("<td>review unavailable</td>");
    expect(html).toContain(
      "<strong>Review priority:</strong> disabled / unavailable",
    );
    expect(pin.status).toBe("review_unavailable");
  });

  it.each([
    ["live_capture", "photo_library", "Uploaded photo"],
    ["live_capture", "camera", "Camera photo"],
    ["live_capture", "video_sweep", "Video frame"],
    ["live_capture", undefined, "Photo"],
    ["bundled_demo", "developer_demo", "Sample photo"],
  ] as const)(
    "prints accurate input provenance for %s/%s",
    async (inputOrigin, captureSource, expected) => {
      boundary.print.mockResolvedValue({
        uri: "file:///cache/Print/provenance.pdf",
      });
      const capture: CaptureRecord = {
        id: "test-photo",
        sessionId: input.session.id,
        capturedAt: input.session.createdAt,
        region: "dorsal_tongue",
        angle: "primary",
        mediaKind: "image",
        encryptedUri: "file:///protected/photo.enc",
        mimeType: "image/jpeg",
        inputOrigin,
        captureSource,
        quality: {
          accepted: true,
          blurScore: 0.9,
          exposureScore: 0.9,
          glareScore: 0,
          obstructionScore: 0,
          faceDetected: false,
          reasons: [],
        },
      };
      await generateEncryptedObservationReport({
        ...input,
        captures: [capture],
      });
      const html = boundary.print.mock.calls[0][0].html as string;
      expect(html).toContain(`<strong>Input:</strong> ${expected}</p>`);
      expect(html).not.toContain("Live user capture");
    },
  );

  it("keeps layout notices out of fixed CSS that overlaps headings", async () => {
    boundary.print.mockResolvedValue({ uri: "file:///cache/Print/layout.pdf" });

    await generateEncryptedObservationReport(input);

    const html = boundary.print.mock.calls[0][0].html as string;
    expect(html).not.toMatch(/position:\s*fixed/);
    expect(html).toContain("This result is not a diagnosis.");
  });

  it("uses explicit print typography and compact paragraph spacing", async () => {
    boundary.print.mockResolvedValue({ uri: "file:///cache/Print/layout.pdf" });

    await generateEncryptedObservationReport(input);

    const html = boundary.print.mock.calls[0][0].html as string;
    expect(html).toMatch(/body\s*\{[^}]*font-size:\s*13px/);
    expect(html).toMatch(/p\s*\{[^}]*margin:\s*6px\s+0/);
    expect(html).toMatch(/\.observation\s*\{[^}]*break-inside:\s*avoid/);
  });

  it("protects an on-time PDF and removes its unencrypted source", async () => {
    const uri = "file:///cache/Print/on-time.pdf";
    boundary.files.add(uri);
    boundary.print.mockResolvedValue({ uri });

    const report = await generateEncryptedObservationReport(input);

    expect(report.encryptedUri).toBe("file:///protected/test-report.enc");
    expect(boundary.footers).toHaveBeenCalledWith(
      new TextEncoder().encode("pdf"),
    );
    expect(boundary.writeFile).toHaveBeenCalledWith(uri, "c3RhbXBlZCBwZGY=", {
      encoding: "base64",
    });
    expect(boundary.writeFile.mock.invocationCallOrder[0]).toBeLessThan(
      boundary.encrypt.mock.invocationCallOrder[0]!,
    );
    expect(boundary.files.has(uri)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["reading", "stamping", "writing"])(
    "cleans up and refuses to save a report when footer %s fails",
    async (stage) => {
      const uri = "file:///cache/Print/failed.pdf";
      boundary.files.add(uri);
      boundary.print.mockResolvedValue({ uri });
      const operation = {
        reading: boundary.readFile,
        stamping: boundary.footers,
        writing: boundary.writeFile,
      }[stage]!;
      operation.mockRejectedValueOnce(new Error("Report file unavailable"));

      await expect(generateEncryptedObservationReport(input)).rejects.toThrow();

      expect(boundary.encrypt).not.toHaveBeenCalled();
      expect(boundary.files.has(uri)).toBe(false);
    },
  );

  it("removes a PDF that finishes after the renderer deadline", async () => {
    let finishPrint!: (value: { uri: string }) => void;
    boundary.print.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPrint = resolve;
        }),
    );
    const outcome = generateEncryptedObservationReport(input).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await outcome).toBeInstanceOf(Error);
    expect(boundary.encrypt).not.toHaveBeenCalled();

    const uri = "file:///cache/Print/late.pdf";
    boundary.files.add(uri);
    finishPrint({ uri });
    await vi.advanceTimersByTimeAsync(0);

    expect(boundary.files.has(uri)).toBe(false);
    expect(boundary.encrypt).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a failed late PDF deletion without keeping a report", async () => {
    let finishPrint!: (value: { uri: string }) => void;
    boundary.print.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPrint = resolve;
        }),
    );
    const outcome = generateEncryptedObservationReport(input).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await outcome).toBeInstanceOf(Error);

    const uri = "file:///cache/Print/retry.pdf";
    boundary.files.add(uri);
    boundary.deleteFile.mockRejectedValueOnce(
      new Error("Temporary I/O failure"),
    );
    finishPrint({ uri });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(boundary.files.has(uri)).toBe(false);
    expect(boundary.encrypt).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("records persistent late cleanup failure and clears the Print cache on recovery", async () => {
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    let finishPrint!: (value: { uri: string }) => void;
    boundary.print.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPrint = resolve;
        }),
    );
    const outcome = generateEncryptedObservationReport(input).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await outcome;
    const uri = "file:///cache/Print/recover.pdf";
    boundary.files.add(uri);
    boundary.deleteFile
      .mockRejectedValueOnce(new Error("I/O failure"))
      .mockRejectedValueOnce(new Error("Still unavailable"));
    finishPrint({ uri });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(boundary.files.has(uri)).toBe(true);
    expect(warning).toHaveBeenCalledWith(
      "[STOMA3D_LATE_REPORT_CLEANUP_FAILED]",
    );
    await purgeStoma3DTemporaryFiles();
    expect(boundary.files.has(uri)).toBe(false);
    expect(boundary.encrypt).not.toHaveBeenCalled();
  });

  it("clears an abandoned Print PDF without touching protected or exported reports", async () => {
    boundary.files.add("file:///cache/Print/abandoned.pdf");
    boundary.files.add("file:///protected/saved.enc");
    boundary.files.add("file:///downloads/exported.pdf");

    await purgeStoma3DTemporaryFiles();

    expect([...boundary.files]).toEqual([
      "file:///protected/saved.enc",
      "file:///downloads/exported.pdf",
    ]);
  });

  it("does not purge a PDF while it is being protected", async () => {
    let finishEncryption!: (uri: string) => void;
    boundary.encrypt.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishEncryption = resolve;
        }),
    );
    const uri = "file:///cache/Print/in-use.pdf";
    boundary.files.add(uri);
    boundary.print.mockResolvedValue({ uri });
    const outcome = generateEncryptedObservationReport(input);
    await vi.advanceTimersByTimeAsync(0);
    await purgeStoma3DBackgroundTemporaryFiles();
    expect(boundary.files.has(uri)).toBe(true);

    finishEncryption("file:///protected/report.enc");
    await outcome;
    expect(boundary.files.has(uri)).toBe(false);
  });

  it("does not delete a report that starts while a cache sweep is awaiting storage", async () => {
    let finishLookup!: (value: { exists: boolean }) => void;
    boundary.fileInfo.mockImplementation(async (uri: string) => {
      if (uri === "file:///cache/Print/") {
        return new Promise((resolve) => {
          finishLookup = resolve;
        });
      }
      return { exists: false };
    });
    const sweep = purgeStoma3DBackgroundTemporaryFiles();
    let finishEncryption!: (uri: string) => void;
    boundary.encrypt.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishEncryption = resolve;
        }),
    );
    const uri = "file:///cache/Print/new-report.pdf";
    boundary.files.add(uri);
    boundary.print.mockResolvedValue({ uri });
    const outcome = generateEncryptedObservationReport(input);
    await vi.advanceTimersByTimeAsync(0);
    finishLookup({ exists: true });
    await sweep;
    const remained = boundary.files.has(uri);
    finishEncryption("file:///protected/report.enc");
    await outcome;

    expect(remained).toBe(true);
    expect(boundary.files.has(uri)).toBe(false);
  });

  it("refuses cleanup paths outside Expo Print's cache directory", async () => {
    const uri = "file:///cache/Print/../protected/report.pdf";
    boundary.files.add(uri);
    await expect(removeReportTemporaryFile(uri)).rejects.toThrow();
    expect(boundary.files.has(uri)).toBe(true);
    expect(boundary.deleteFile).not.toHaveBeenCalled();
  });

  it("keeps a timed-out renderer protected from a background sweep until it returns", async () => {
    let finishPrint!: (value: { uri: string }) => void;
    boundary.print.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPrint = resolve;
        }),
    );
    const outcome = generateEncryptedObservationReport(input).catch(
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    await outcome;
    const uri = "file:///cache/Print/still-rendering.pdf";
    boundary.files.add(uri);
    await purgeStoma3DBackgroundTemporaryFiles();
    expect(boundary.files.has(uri)).toBe(true);
    finishPrint({ uri });
    await vi.advanceTimersByTimeAsync(0);
    expect(boundary.files.has(uri)).toBe(false);
  });
});
