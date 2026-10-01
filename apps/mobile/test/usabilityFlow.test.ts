import { describe, expect, it } from "vitest";
import { MOUTH_REGIONS, type QualityResult } from "@stoma3d/contracts";
import {
  nextScanCapture,
  resumableSession,
  intakeProfileForScan,
} from "../src/lib/usabilityFlow";
import type { CaptureRecord, ScanSession } from "../src/types";

const quality: QualityResult = {
  accepted: true,
  blurScore: 0.9,
  exposureScore: 0.9,
  glareScore: 0,
  obstructionScore: 0,
  faceDetected: false,
  reasons: [],
};
const session = (
  id: string,
  protocol: ScanSession["protocol"] = "standard_eight_region",
): ScanSession => ({
  id,
  protocol,
  createdAt: "2026-10-01T00:00:00Z",
  demo: false,
  label: "Scan",
});
const capture = (
  sessionId: string,
  region: CaptureRecord["region"],
  angle: CaptureRecord["angle"] = "primary",
): CaptureRecord => ({
  id: `${sessionId}-${region}-${angle}`,
  sessionId,
  region,
  angle,
  mediaKind: "image",
  capturedAt: "2026-10-01T00:00:00Z",
  encryptedUri: null,
  mimeType: "image/jpeg",
  inputOrigin: "live_capture",
  quality,
});

describe("simple scan progression", () => {
  it("resumes the first missing region, not an already accepted one", () => {
    expect(
      nextScanCapture(session("one"), [capture("one", "dorsal_tongue")]),
    ).toEqual({ region: "ventral_tongue", angle: "primary" });
  });
  it("keeps older multi-angle scans and resumes their missing angle", () => {
    expect(
      nextScanCapture(session("one", "detailed_multi_angle"), [
        capture("one", "dorsal_tongue", "straight"),
      ]),
    ).toEqual({ region: "dorsal_tongue", angle: "left_oblique" });
  });
  it("does not start another capture when all eight regions are accepted", () => {
    expect(
      nextScanCapture(
        session("one"),
        MOUTH_REGIONS.map((region) => capture("one", region)),
      ),
    ).toBeNull();
  });
  it("keeps the active unfinished scan and excludes demo sessions", () => {
    const sessions = [
      session("old"),
      session("active"),
      { ...session("demo"), demo: true },
    ];
    expect(resumableSession(sessions, [], "active")?.id).toBe("active");
    expect(resumableSession(sessions, [], null)?.id).toBe("active");
  });
});

describe("brief intake", () => {
  it("does not invent a date or duration for no symptoms", () => {
    const profile = intakeProfileForScan({
      symptoms: [],
      firstNoticed: "",
      durationDays: "",
      change: "rapid_change",
    });
    expect(profile).toMatchObject({
      symptoms: [],
      firstNoticed: "",
      change: "not_sure",
    });
    expect(profile.durationDays).toBeUndefined();
  });
  it("accepts not sure without making up days", () => {
    const profile = intakeProfileForScan({
      symptoms: ["pain"],
      firstNoticed: "Not sure",
      durationDays: "",
      change: "not_sure",
    });
    expect(profile.firstNoticed).toBe("Not sure");
    expect(profile.durationDays).toBeUndefined();
  });
  it("rejects invalid durations instead of saving NaN or huge values", () => {
    expect(() =>
      intakeProfileForScan({
        symptoms: ["pain"],
        firstNoticed: "",
        durationDays: "99999",
        change: "not_sure",
      }),
    ).toThrow("days");
  });
});
