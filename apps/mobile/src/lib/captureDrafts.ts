import {
  captureAngleSchema,
  mouthRegionSchema,
  qualityResultSchema,
} from "@stoma3d/contracts";
import { z } from "zod";

const id = z.string().trim().min(1).max(128);
export const captureDraftSchema = z
  .object({
    id,
    sessionId: id,
    region: mouthRegionSchema,
    angle: captureAngleSchema,
    encryptedUri: z
      .string()
      .max(4096)
      .regex(/^file:\/\/\/.*\/stoma3d-vault\/[^/\\]+\.osv$/),
    mimeType: z.enum(["image/jpeg", "image/png"]),
    source: z.enum(["camera", "photo_library"]),
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    byteSize: z.number().int().positive().max(2_000_000),
    quality: qualityResultSchema,
    capturedAt: z.string().datetime({ offset: true }),
    privacyPassed: z.literal(true),
  })
  .strict()
  .superRefine((draft, context) => {
    if (
      !draft.quality.accepted ||
      draft.quality.faceDetected ||
      draft.quality.reasons.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["quality"],
        message:
          "Only quality-accepted, privacy-checked photos can be saved for retry.",
      });
    }
  });
export type CaptureDraft = z.infer<typeof captureDraftSchema>;
const envelope = z
  .object({
    schemaVersion: z.literal(1),
    drafts: z.array(captureDraftSchema).max(24),
  })
  .strict();

export function parseCaptureDrafts(value: unknown): CaptureDraft[] {
  // Additive migration: older installations have no draft metadata. Their
  // sessions, observations, and cloud payloads keep their existing versions.
  return value == null ? [] : envelope.parse(value).drafts;
}

export function upsertCaptureDraft(
  drafts: readonly CaptureDraft[],
  value: CaptureDraft,
): CaptureDraft[] {
  const draft = captureDraftSchema.parse(value);
  const next = [
    ...drafts.filter(
      (item) =>
        item.id !== draft.id &&
        !(
          item.sessionId === draft.sessionId &&
          item.region === draft.region &&
          item.angle === draft.angle
        ),
    ),
    draft,
  ];
  return envelope.parse({ schemaVersion: 1, drafts: next }).drafts;
}
