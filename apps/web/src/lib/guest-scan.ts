import { z } from "zod";
import {
  analysisResultSchema,
  MOUTH_REGIONS,
  MOUTH_REGION_DETAILS,
  mouthRegionSchema,
  type AnalysisResult,
  type MouthRegion,
} from "@stoma3d/contracts";
import mouthAsset from "../../../../assets/mouth/manifest.json";

export const guestCaptureSchema = z
  .object({
    id: z.string().min(1),
    region: mouthRegionSchema,
    capturedAt: z.string().datetime(),
    image: z.string().startsWith("data:image/jpeg;base64,"),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    analysis: analysisResultSchema,
  })
  .strict()
  .superRefine((capture, context) => {
    if (
      capture.analysis.captureId !== capture.id ||
      capture.analysis.region !== capture.region ||
      !capture.analysis.quality.accepted ||
      !capture.analysis.anatomyPrediction.supported ||
      capture.analysis.anatomyPrediction.region !== capture.region ||
      !capture.analysis.anatomyPrediction.selectedRegionMatches ||
      !["complete", "abstained"].includes(capture.analysis.status) ||
      !["live_model", "unavailable"].includes(
        capture.analysis.analysisOrigin,
      ) ||
      capture.analysis.inputOrigin !== "live_capture"
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Only privacy-checked, quality-accepted photos with matching anatomy can be saved in a scan.",
      });
    }
  });
export type GuestCapture = z.infer<typeof guestCaptureSchema>;

const guestPinSchema = z
  .object({
    captureId: z.string().min(1),
    region: mouthRegionSchema,
    meshId: z.string().min(1),
    uvX: z.number().min(0).max(1),
    uvY: z.number().min(0).max(1),
    assetVersion: z.literal(mouthAsset.assetVersion),
    confirmedAt: z.string().datetime(),
  })
  .strict();
export type GuestPin = z.infer<typeof guestPinSchema>;

export const guestSessionSchema = z
  .object({
    version: z.literal(1),
    id: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    protocol: z.literal("standard_eight_region"),
    intake: z
      .object({
        symptoms: z.array(z.string()).max(8),
        duration: z.string(),
        change: z.string(),
      })
      .strict(),
    captures: z.array(guestCaptureSchema).max(8),
    pins: z.array(guestPinSchema).max(8),
  })
  .strict()
  .superRefine((session, context) => {
    if (
      new Set(session.captures.map((item) => item.region)).size !==
      session.captures.length
    ) {
      context.addIssue({
        code: "custom",
        message: "A standard scan keeps one accepted photo per region.",
      });
    }
    if (
      session.pins.some(
        (pin) =>
          !session.captures.some(
            (capture) =>
              capture.id === pin.captureId &&
              capture.region === pin.region &&
              capture.analysis.candidateMask,
          ),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Every pin needs a matching accepted observation.",
      });
    }
  });
export type GuestSession = z.infer<typeof guestSessionSchema>;

export function createGuestSession(
  id: string,
  now = new Date().toISOString(),
): GuestSession {
  return {
    version: 1,
    id,
    createdAt: now,
    updatedAt: now,
    protocol: "standard_eight_region",
    intake: { symptoms: [], duration: "Not sure", change: "Not sure" },
    captures: [],
    pins: [],
  };
}

export function guestCompletedRegions(
  session: GuestSession | null,
): MouthRegion[] {
  return session?.captures.map((capture) => capture.region) ?? [];
}

export function nextGuestRegion(
  session: GuestSession | null,
): MouthRegion | null {
  const completed = guestCompletedRegions(session);
  return MOUTH_REGIONS.find((region) => !completed.includes(region)) ?? null;
}

export function addGuestCapture(
  session: GuestSession,
  capture: GuestCapture,
): GuestSession {
  guestCaptureSchema.parse(capture);
  return guestSessionSchema.parse({
    ...session,
    updatedAt: new Date().toISOString(),
    captures: [
      ...session.captures.filter((item) => item.region !== capture.region),
      capture,
    ],
    pins: session.pins.filter((pin) => pin.region !== capture.region),
  });
}

export function confirmGuestObservation(
  session: GuestSession,
  captureId: string,
): GuestSession {
  const capture = session.captures.find((item) => item.id === captureId);
  if (
    !capture?.analysis.candidateMask ||
    capture.analysis.status !== "complete"
  ) {
    throw new Error("Choose an analyzed observation first.");
  }
  const [x, y, width, height] = capture.analysis.candidateMask.boundingBox;
  const mesh = mouthAsset.targetRegions.find(
    (item) => item.regionId === capture.region,
  );
  if (!mesh) throw new Error("This region is not available on the map.");
  return guestSessionSchema.parse({
    ...session,
    updatedAt: new Date().toISOString(),
    pins: [
      ...session.pins.filter((pin) => pin.captureId !== captureId),
      {
        captureId,
        region: capture.region,
        meshId: mesh.meshId,
        uvX: x + width / 2,
        uvY: y + height / 2,
        assetVersion: mouthAsset.assetVersion,
        confirmedAt: new Date().toISOString(),
      },
    ],
  });
}

export function regionDetail(region: MouthRegion) {
  return MOUTH_REGION_DETAILS.find((item) => item.id === region)!;
}

export function captureSummary(capture: GuestCapture): string {
  if (capture.analysis.status !== "complete")
    return "Photo accepted · Analysis needs another try";
  return capture.analysis.candidateMask
    ? "Candidate area outlined"
    : "No candidate area detected";
}

export function suggestedRetryRegion(
  result: AnalysisResult,
): MouthRegion | null {
  const anatomy = result.anatomyPrediction;
  return ["abstained", "unsupported"].includes(result.status) &&
    result.quality.accepted &&
    !result.quality.faceDetected &&
    anatomy.supported &&
    !anatomy.selectedRegionMatches &&
    anatomy.region !== result.region
    ? anatomy.region
    : null;
}

export function resultProblem(result: AnalysisResult): string | null {
  if (result.status === "complete") return null;
  if (result.quality.faceDetected)
    return "Crop the photo to show only the mouth, then try again.";
  const reasons = [...result.quality.reasons, ...result.abstentionReasons];
  if (reasons.includes("image_too_small"))
    return "Choose a higher-resolution photo or take a new one.";
  if (reasons.some((reason) => /privacy|face.*unavailable/i.test(reason)))
    return "The photo privacy check could not finish. Try again.";
  if (reasons.includes("excessive_glare"))
    return "Move away from direct light and try another photo.";
  if (reasons.some((reason) => /dark|exposure|lighting/i.test(reason)))
    return "Use even lighting and try another photo.";
  if (reasons.includes("image_obstructed"))
    return "Keep the mouth clear of fingers and other objects, then try again.";
  if (reasons.some((reason) => /blur|focus/i.test(reason)))
    return "The photo is out of focus. Hold still and take another.";
  if (
    !result.anatomyPrediction.selectedRegionMatches &&
    result.anatomyPrediction.region
  )
    return `This looks like ${regionDetail(result.anatomyPrediction.region).shortLabel.toLowerCase()}. Choose the matching region or another photo.`;
  if (result.status === "unsupported")
    return "This photo could not be matched to the selected mouth region. Try a closer, well-lit view.";
  return "Analysis could not finish for this photo. Try again or choose another.";
}
