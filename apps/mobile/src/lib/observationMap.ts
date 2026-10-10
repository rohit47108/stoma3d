import {
  MOUTH_REGIONS,
  type AnalysisResult,
  type MouthRegion,
} from "@stoma3d/contracts";

import { ORAL_MAP_ASSET_VERSION } from "../constants";
import type { CaptureRecord, ObservationPin } from "../types";

export const ORAL_SCAN_PATH = [...MOUTH_REGIONS] as readonly MouthRegion[];

export type ObservationMapLayer = "coverage" | "status" | "confidence";
export type ObservationMapView = "whole" | "exploded" | "focus" | "path";

export interface RegionObservationSummary {
  region: MouthRegion;
  acceptedCaptureCount: number;
  latestCaptureAt: string | null;
  averageAnalysisConfidence: number | null;
  confirmedPinCount: number;
  rejectedCaptureCount: number;
  retakeRequiredCount: number;
  visuallyChangedPinCount: number;
}

export interface ScanPhonePose {
  position: [number, number, number];
  rotation: [number, number, number];
}

export interface ScanPathCue {
  phonePosition: string;
  tissuePosition: string;
  camera: string;
  helperRecommended: boolean;
}

export interface ObservationReplayFrame {
  id: string;
  cutoffAt: string;
  sessionId: string;
  acceptedCaptureCount: number;
  summaries: Record<MouthRegion, RegionObservationSummary>;
  completedRegions: MouthRegion[];
  visiblePinIds: string[];
}

type MapCapture = Pick<
  CaptureRecord,
  | "id"
  | "sessionId"
  | "region"
  | "capturedAt"
  | "inputOrigin"
  | "quality"
  | "samplePlaceholder"
>;

const REGION_POSITIONS: Record<MouthRegion, [number, number, number]> = {
  dorsal_tongue: [0, -0.36, 0.28],
  ventral_tongue: [0, -0.72, -0.02],
  left_buccal_mucosa: [-1.02, 0, 0],
  right_buccal_mucosa: [1.02, 0, 0],
  upper_lip: [0, 0.82, 0.34],
  lower_lip: [0, -1.03, 0.32],
  upper_dental_arch: [0, 0.45, -0.02],
  lower_dental_arch: [0, -0.52, -0.2],
};

const SCAN_PHONE_POSES: Record<MouthRegion, ScanPhonePose> = {
  dorsal_tongue: { position: [0, -0.2, 1.72], rotation: [0.04, 0, 0] },
  ventral_tongue: { position: [0, -1.12, 1.42], rotation: [-0.34, 0, 0] },
  left_buccal_mucosa: {
    position: [-1.72, 0.02, 1.18],
    rotation: [0, 0.52, 0.12],
  },
  right_buccal_mucosa: {
    position: [1.72, 0.02, 1.18],
    rotation: [0, -0.52, -0.12],
  },
  upper_lip: { position: [0, 1.37, 1.42], rotation: [0.28, 0, 0] },
  lower_lip: { position: [0, -1.48, 1.42], rotation: [-0.2, 0, 0] },
  upper_dental_arch: {
    position: [0, 0.82, 1.38],
    rotation: [0.38, 0, 0],
  },
  lower_dental_arch: {
    position: [0, -0.92, 1.34],
    rotation: [-0.4, 0, 0],
  },
};

const SCAN_PATH_CUES: Record<MouthRegion, ScanPathCue> = {
  dorsal_tongue: {
    phonePosition:
      "Hold the phone level and point toward the center of the tongue.",
    tissuePosition: "Extend the tongue gently and keep its top surface flat.",
    camera: "Rear camera recommended",
    helperRecommended: false,
  },
  ventral_tongue: {
    phonePosition: "Hold the phone slightly below the mouth and tilt upward.",
    tissuePosition: "Lift the tongue toward the roof of the mouth.",
    camera: "Rear camera recommended",
    helperRecommended: true,
  },
  left_buccal_mucosa: {
    phonePosition: "Move the phone toward the left side and angle inward.",
    tissuePosition: "Pull the left cheek outward without covering the tissue.",
    camera: "Rear camera recommended",
    helperRecommended: true,
  },
  right_buccal_mucosa: {
    phonePosition: "Move the phone toward the right side and angle inward.",
    tissuePosition: "Pull the right cheek outward without covering the tissue.",
    camera: "Rear camera recommended",
    helperRecommended: true,
  },
  upper_lip: {
    phonePosition:
      "Raise the phone slightly and keep the lens parallel to the lip.",
    tissuePosition: "Lift the upper lip so the inner surface is visible.",
    camera: "Rear camera recommended",
    helperRecommended: true,
  },
  lower_lip: {
    phonePosition:
      "Lower the phone slightly and keep the lens parallel to the lip.",
    tissuePosition: "Pull the lower lip down so the inner surface is visible.",
    camera: "Rear camera recommended",
    helperRecommended: true,
  },
  upper_dental_arch: {
    phonePosition: "Hold the phone near center and tilt the lens upward.",
    tissuePosition: "Open wide and keep the upper teeth and gums unobstructed.",
    camera: "Rear camera recommended",
    helperRecommended: true,
  },
  lower_dental_arch: {
    phonePosition: "Hold the phone near center and tilt the lens downward.",
    tissuePosition: "Open wide and keep the lower teeth and gums unobstructed.",
    camera: "Rear camera recommended",
    helperRecommended: true,
  },
};

export const REGION_SCALES: Record<MouthRegion, [number, number, number]> = {
  dorsal_tongue: [1.15, 0.72, 0.42],
  ventral_tongue: [0.72, 0.26, 0.3],
  left_buccal_mucosa: [0.42, 1.26, 0.6],
  right_buccal_mucosa: [0.42, 1.26, 0.6],
  upper_lip: [1.48, 0.26, 0.35],
  lower_lip: [1.35, 0.26, 0.35],
  upper_dental_arch: [1.1, 0.26, 0.25],
  lower_dental_arch: [1.08, 0.24, 0.25],
};

const isUsableCapture = (capture: MapCapture, cutoffAt?: string): boolean => {
  const capturedAt = Date.parse(capture.capturedAt);
  const cutoff = cutoffAt ? Date.parse(cutoffAt) : Number.POSITIVE_INFINITY;
  return (
    capture.inputOrigin === "live_capture" &&
    !capture.samplePlaceholder &&
    capture.quality.accepted &&
    Number.isFinite(capturedAt) &&
    capturedAt <= cutoff
  );
};

const isRelevantLiveCapture = (
  capture: MapCapture,
  cutoffAt?: string,
): boolean => {
  const capturedAt = Date.parse(capture.capturedAt);
  const cutoff = cutoffAt ? Date.parse(cutoffAt) : Number.POSITIVE_INFINITY;
  return (
    capture.inputOrigin === "live_capture" &&
    !capture.samplePlaceholder &&
    Number.isFinite(capturedAt) &&
    capturedAt <= cutoff
  );
};

const isVisiblePin = (pin: ObservationPin, cutoffAt?: string): boolean => {
  if (!pin.userConfirmed || pin.assetVersion !== ORAL_MAP_ASSET_VERSION) {
    return false;
  }
  if (!cutoffAt) return true;
  const observedAt = Date.parse(pin.firstObservedAt);
  return Number.isFinite(observedAt) && observedAt <= Date.parse(cutoffAt);
};

export function buildRegionObservationSummaries(
  captures: readonly MapCapture[],
  analyses: Readonly<Record<string, AnalysisResult | undefined>>,
  pins: readonly ObservationPin[],
  cutoffAt?: string,
): Record<MouthRegion, RegionObservationSummary> {
  const usableCaptureIds = new Set(
    captures
      .filter((capture) => isUsableCapture(capture, cutoffAt))
      .map((capture) => capture.id),
  );
  return Object.fromEntries(
    ORAL_SCAN_PATH.map((region) => {
      const regionCaptures = captures
        .filter(
          (capture) =>
            capture.region === region && isUsableCapture(capture, cutoffAt),
        )
        .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
      const confidences = regionCaptures.flatMap((capture) => {
        const analysis = analyses[capture.id];
        return analysis?.captureId === capture.id &&
          analysis.region === region &&
          analysis.inputOrigin === "live_capture" &&
          analysis.analysisOrigin === "live_model" &&
          analysis.status === "complete" &&
          analysis.quality.accepted
          ? [analysis.uncertainty.overallConfidence]
          : [];
      });
      const visiblePins = pins.filter(
        (pin) =>
          pin.region === region &&
          isVisiblePin(pin, cutoffAt) &&
          pin.captureIds.some((captureId) => usableCaptureIds.has(captureId)),
      );
      const rejectedCaptureCount = captures.filter(
        (capture) =>
          capture.region === region &&
          isRelevantLiveCapture(capture, cutoffAt) &&
          !capture.quality.accepted,
      ).length;
      const latest = regionCaptures.at(-1);
      const summary: RegionObservationSummary = {
        region,
        acceptedCaptureCount: regionCaptures.length,
        latestCaptureAt: latest?.capturedAt ?? null,
        averageAnalysisConfidence: confidences.length
          ? confidences.reduce((sum, confidence) => sum + confidence, 0) /
            confidences.length
          : null,
        confirmedPinCount: visiblePins.length,
        rejectedCaptureCount,
        retakeRequiredCount:
          rejectedCaptureCount +
          visiblePins.filter((pin) => pin.status === "retake_required").length,
        visuallyChangedPinCount: visiblePins.filter(
          (pin) => pin.status === "visually_changed",
        ).length,
      };
      return [region, summary];
    }),
  ) as Record<MouthRegion, RegionObservationSummary>;
}

export function deriveScanPhonePose(region: MouthRegion): ScanPhonePose {
  const pose = SCAN_PHONE_POSES[region];
  return {
    position: [...pose.position],
    rotation: [...pose.rotation],
  };
}

export function scanPathCue(region: MouthRegion): ScanPathCue {
  return { ...SCAN_PATH_CUES[region] };
}

export function buildObservationReplayFrames(
  captures: readonly MapCapture[],
  analyses: Readonly<Record<string, AnalysisResult | undefined>>,
  pins: readonly ObservationPin[],
): ObservationReplayFrame[] {
  const usable = captures.filter((capture) => isUsableCapture(capture));
  const usableCaptureIds = new Set(usable.map((capture) => capture.id));
  const sessions = new Map<string, MapCapture[]>();
  for (const capture of usable) {
    const sessionCaptures = sessions.get(capture.sessionId) ?? [];
    sessionCaptures.push(capture);
    sessions.set(capture.sessionId, sessionCaptures);
  }

  return [...sessions.entries()]
    .map(([sessionId, sessionCaptures]) => ({
      sessionId,
      sessionCaptures,
      cutoffAt: sessionCaptures
        .map((capture) => capture.capturedAt)
        .sort()
        .at(-1)!,
    }))
    .sort((left, right) => left.cutoffAt.localeCompare(right.cutoffAt))
    .map(({ sessionId, sessionCaptures, cutoffAt }) => {
      const captureIdsThroughCutoff = new Set(
        usable
          .filter((capture) => capture.capturedAt <= cutoffAt)
          .map((capture) => capture.id),
      );
      const summaries = buildRegionObservationSummaries(
        captures,
        analyses,
        pins,
        cutoffAt,
      );
      return {
        id: `${sessionId}:${cutoffAt}`,
        sessionId,
        cutoffAt,
        acceptedCaptureCount: sessionCaptures.length,
        summaries,
        completedRegions: ORAL_SCAN_PATH.filter(
          (region) => summaries[region].acceptedCaptureCount > 0,
        ),
        visiblePinIds: pins
          .filter(
            (pin) =>
              isVisiblePin(pin, cutoffAt) &&
              pin.captureIds.some(
                (captureId) =>
                  usableCaptureIds.has(captureId) &&
                  captureIdsThroughCutoff.has(captureId),
              ),
          )
          .map((pin) => pin.id),
      };
    });
}

export function observationReplayIndexForCapture(
  frames: readonly ObservationReplayFrame[],
  captures: readonly MapCapture[],
  captureId?: string,
): number {
  const capture = captures.find(
    (item) => item.id === captureId && isUsableCapture(item),
  );
  const requestedIndex = capture
    ? frames.findIndex((frame) => frame.sessionId === capture.sessionId)
    : -1;
  return requestedIndex >= 0 ? requestedIndex : Math.max(0, frames.length - 1);
}

export function capturesForObservationPin(
  pin: ObservationPin,
  capturesById: ReadonlyMap<string, MapCapture>,
  cutoffAt?: string,
): MapCapture[] {
  return [...new Set(pin.captureIds)]
    .flatMap((id) => {
      const capture = capturesById.get(id);
      return capture &&
        capture.region === pin.region &&
        isUsableCapture(capture, cutoffAt)
        ? [capture]
        : [];
    })
    .sort(
      (left, right) =>
        Date.parse(left.capturedAt) - Date.parse(right.capturedAt),
    );
}

export function nextScanPathRegion(
  completedRegions: readonly MouthRegion[],
  selectedRegion: MouthRegion | null,
  direction: -1 | 1,
): MouthRegion {
  const selectedIndex = selectedRegion
    ? ORAL_SCAN_PATH.indexOf(selectedRegion)
    : -1;
  if (selectedIndex >= 0) {
    return ORAL_SCAN_PATH[
      (selectedIndex + direction + ORAL_SCAN_PATH.length) %
        ORAL_SCAN_PATH.length
    ]!;
  }
  return (
    ORAL_SCAN_PATH.find((region) => !completedRegions.includes(region)) ??
    ORAL_SCAN_PATH[0]!
  );
}

export function deriveRegionWorldPosition(
  region: MouthRegion,
  exploded: boolean,
): [number, number, number] {
  const base = REGION_POSITIONS[region];
  if (!exploded) return [...base];
  return [
    base[0] + Math.sign(base[0]) * 0.38,
    base[1] + Math.sign(base[1]) * 0.16,
    base[2],
  ];
}

export function derivePinWorldPosition(
  pin: Pick<ObservationPin, "region" | "uvX" | "uvY">,
  exploded: boolean,
): [number, number, number] {
  const base = deriveRegionWorldPosition(pin.region, exploded);
  const scale = REGION_SCALES[pin.region];
  return [
    base[0] + (pin.uvX - 0.5) * scale[0] * 0.65,
    base[1] + (0.5 - pin.uvY) * scale[1] * 0.65,
    base[2] + 0.35 + scale[2] * 0.25,
  ];
}
