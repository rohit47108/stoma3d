import { describe, expect, it } from "vitest";
import {
  parseCaptureDrafts,
  upsertCaptureDraft,
  type CaptureDraft,
} from "../src/lib/captureDrafts";

const draft: CaptureDraft = {
  id: "pending-photo",
  sessionId: "scan",
  region: "dorsal_tongue",
  angle: "primary",
  encryptedUri: "file:///documents/stoma3d-vault/pending-photo.osv",
  mimeType: "image/jpeg",
  source: "photo_library",
  width: 1200,
  height: 900,
  byteSize: 180000,
  capturedAt: "2026-10-01T20:00:00Z",
  privacyPassed: true,
  quality: {
    accepted: true,
    blurScore: 0.8,
    exposureScore: 0.9,
    glareScore: 0,
    obstructionScore: 0,
    faceDetected: false,
    reasons: [],
  },
};

describe("encrypted retry drafts", () => {
  it("reads an absent draft envelope without changing older records", () => {
    expect(parseCaptureDrafts(null)).toEqual([]);
  });
  it("round-trips a versioned draft without counting it as accepted capture", () => {
    expect(parseCaptureDrafts({ schemaVersion: 1, drafts: [draft] })).toEqual([
      draft,
    ]);
    expect(draft).not.toHaveProperty("analysis");
  });
  it("rejects photos whose local privacy check did not pass", () => {
    expect(() =>
      parseCaptureDrafts({
        schemaVersion: 1,
        drafts: [{ ...draft, privacyPassed: false }],
      }),
    ).toThrow();
  });
  it("rejects known poor-quality photos and unencrypted paths", () => {
    expect(() =>
      parseCaptureDrafts({
        schemaVersion: 1,
        drafts: [{ ...draft, quality: { ...draft.quality, accepted: false } }],
      }),
    ).toThrow();
    expect(() =>
      parseCaptureDrafts({
        schemaVersion: 1,
        drafts: [{ ...draft, encryptedUri: "file:///cache/plain.jpg" }],
      }),
    ).toThrow();
  });
  it("replaces only the same scan, region, and angle and keeps stable retry ids", () => {
    const other = { ...draft, id: "other", region: "lower_lip" as const };
    const replacement = {
      ...draft,
      encryptedUri: "file:///documents/stoma3d-vault/retry.osv",
    };
    expect(upsertCaptureDraft([draft, other], replacement)).toEqual([
      other,
      replacement,
    ]);
  });
});
