import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PersistedAppState } from "../src/types";

const boundary = vi.hoisted(() => ({
  readMappings: vi.fn(),
  saveMapping: vi.fn(),
  prepare: vi.fn(),
  clear: vi.fn(),
  upload: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  cloudMetadata: boundary.readMappings,
  updateCloudMetadata: boundary.saveMapping,
}));
vi.mock("../src/cloud/assetTransfer", () => ({
  prepareCaptureAsset: boundary.prepare,
  clearPreparedAsset: boundary.clear,
  uploadPreparedAsset: boundary.upload,
}));
vi.mock("../src/cloud/client", () => ({ PlatformClient: class {} }));
import { syncProductResources } from "../src/cloud/productSync";
import { localCaptureSetId } from "../src/cloud/syncModel";

const asset = {
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: "image/jpeg",
  byteSize: 3,
  sha256: "fixture-sha",
  widthPx: 512,
  heightPx: 512,
};
const state: PersistedAppState = {
  schemaVersion: 4,
  consentedAt: "2026-10-09T12:00:00.000Z",
  profile: null,
  settings: {
    highContrast: false,
    largeText: false,
    reducedMotion: false,
    animationSpeed: "standard",
    haptics: false,
    voiceInstructions: false,
    caregiverMode: false,
    analyticsOptIn: false,
  },
  sessions: [
    {
      id: "scan",
      createdAt: "2026-10-09T12:00:00.000Z",
      demo: false,
      label: "Scan",
      protocol: "standard_eight_region",
    },
  ],
  captures: [
    {
      id: "capture",
      sessionId: "scan",
      region: "dorsal_tongue",
      angle: "primary",
      mediaKind: "image",
      capturedAt: "2026-10-09T12:01:00.000Z",
      encryptedUri: "file:///documents/stoma3d-vault/capture.osv",
      mimeType: "image/jpeg",
      inputOrigin: "live_capture",
      captureSource: "camera",
      privacyConfirmedByUser: true,
      regionConfirmedByUser: true,
      quality: {
        accepted: true,
        blurScore: 0.9,
        exposureScore: 0.9,
        glareScore: 0,
        obstructionScore: 0,
        faceDetected: false,
        reasons: [],
      },
    },
  ],
  analyses: {},
  comparisons: [],
  pins: [],
  reports: [],
  activeSessionId: "scan",
};

function client() {
  return {
    createScanSession: vi
      .fn()
      .mockResolvedValue({ scanSessionId: "remote-scan" }),
    createCaptureSet: vi.fn().mockResolvedValue({ captureSetId: "remote-set" }),
    createCaptureView: vi.fn().mockResolvedValue({
      views: [
        {
          ordinal: 0,
          captureViewId: "remote-view",
          asset: {
            assetId: "remote-asset",
            sha256: asset.sha256,
            uploadStatus: "pending",
          },
        },
      ],
    }),
    requestAssetUpload: vi
      .fn()
      .mockResolvedValue({ url: "https://example.invalid/upload" }),
    finalizeAssetUpload: vi.fn().mockResolvedValue({
      checksumVerified: true,
      asset: { sha256: asset.sha256, uploadStatus: "available" },
    }),
    createJob: vi.fn().mockResolvedValue({ jobId: "remote-job" }),
  };
}
async function flush() {
  for (let pass = 0; pass < 3; pass++)
    await new Promise<void>((resolve) => setImmediate(resolve));
}
beforeEach(() => {
  vi.resetAllMocks();
  boundary.readMappings.mockResolvedValue({});
  boundary.saveMapping.mockResolvedValue(undefined);
  boundary.prepare.mockResolvedValue(asset);
  boundary.upload.mockResolvedValue(undefined);
});

describe("outbound product work stops after its upload plan is invalidated", () => {
  it("completes a current upload plan and clears prepared bytes", async () => {
    const api = client();
    const result = await syncProductResources({
      client: api as unknown as Parameters<
        typeof syncProductResources
      >[0]["client"],
      state: structuredClone(state),
      deviceId: "device",
      consentRecordId: "consent",
      assertCurrent: () => undefined,
    });
    expect(result.capturesUploaded).toBe(1);
    expect(result.analysisJobsCreated).toBe(1);
    expect(boundary.clear).toHaveBeenCalledOnce();
  });

  it("does not read metadata when the upload plan is already canceled", async () => {
    await expect(
      syncProductResources({
        client: client() as unknown as Parameters<
          typeof syncProductResources
        >[0]["client"],
        state: structuredClone(state),
        deviceId: "device",
        consentRecordId: "consent",
        assertCurrent: () => {
          throw new Error("Sync canceled.");
        },
      }),
    ).rejects.toThrow("Sync canceled.");
    expect(boundary.readMappings).not.toHaveBeenCalled();
  });

  it.each(["job", "run", "failed_run"])(
    "does not create an observation after cancellation during %s lookup",
    async (stage) => {
      const api = {
        ...client(),
        job: vi.fn().mockResolvedValue({
          status: "succeeded",
          outcome: "complete",
          outputRefs: ["output"],
        }),
        analysisRun: vi.fn().mockResolvedValue({
          observations: [
            {
              observationId: "observation",
              captureViewId: "remote-view",
              region: "dorsal_tongue",
            },
          ],
        }),
        createLesion: vi.fn().mockResolvedValue({ lesionId: "lesion" }),
      };
      const planned = structuredClone(state);
      planned.pins = [
        {
          id: "pin",
          region: "dorsal_tongue",
          meshId: "tongue",
          uvX: 0.5,
          uvY: 0.5,
          assetVersion: "v1",
          userConfirmed: true,
          firstObservedAt: "2026-10-09T12:01:00.000Z",
          status: "monitoring",
          captureIds: ["capture"],
        },
      ];
      boundary.readMappings.mockResolvedValue(
        Object.fromEntries(
          [
            ["scan_session", "scan", "remote-scan"],
            [
              "capture_set",
              localCaptureSetId("scan", "dorsal_tongue"),
              "remote-set",
            ],
            ["capture_view", "capture", "remote-view"],
            ["analysis_job", "capture", "remote-job"],
          ].map(([kind, localId, remoteId]) => [
            `${kind}:${localId}`,
            JSON.stringify({
              kind,
              localId,
              remoteId,
              updatedAt: "2026-10-09T12:01:00.000Z",
              uploaded: true,
            }),
          ]),
        ),
      );
      let resume!: () => void;
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const delayed = stage === "job" ? api.job : api.analysisRun;
      const original = delayed.getMockImplementation()!;
      delayed.mockImplementationOnce(async (...args: unknown[]) => {
        await gate;
        if (stage === "failed_run")
          throw new Error("Not an analysis artifact.");
        return original(...args);
      });
      let current = true;
      const operation = syncProductResources({
        client: api as unknown as Parameters<
          typeof syncProductResources
        >[0]["client"],
        state: planned,
        deviceId: "device",
        consentRecordId: "consent",
        assertCurrent: () => {
          if (!current) throw new Error("Sync canceled.");
        },
      }).catch((error) => error);
      await flush();
      expect(delayed).toHaveBeenCalledOnce();
      current = false;
      resume();
      expect(await operation).toBeInstanceOf(Error);
      expect(api.createLesion).not.toHaveBeenCalled();
    },
  );

  it.each([
    "mappings",
    "session",
    "capture_set",
    "prepare",
    "view",
    "ticket",
    "upload",
    "finalize",
  ])(
    "does not start another side effect after cancellation during %s",
    async (stage) => {
      const api = client();
      let resume!: () => void;
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const stages = {
        mappings: [boundary.readMappings, api.createScanSession],
        session: [api.createScanSession, api.createCaptureSet],
        capture_set: [api.createCaptureSet, boundary.prepare],
        prepare: [boundary.prepare, api.createCaptureView],
        view: [api.createCaptureView, api.requestAssetUpload],
        ticket: [api.requestAssetUpload, boundary.upload],
        upload: [boundary.upload, api.finalizeAssetUpload],
        finalize: [api.finalizeAssetUpload, api.createJob],
      };
      const [delayed, next] = stages[stage as keyof typeof stages];
      const original = delayed.getMockImplementation()!;
      delayed.mockImplementationOnce(async (...args: unknown[]) => {
        await gate;
        return original(...args);
      });
      let current = true;
      const options = {
        client: api as unknown as Parameters<
          typeof syncProductResources
        >[0]["client"],
        state: structuredClone(state),
        deviceId: "device",
        consentRecordId: "consent",
        assertCurrent: () => {
          if (!current)
            throw new Error("Your saved scan changed. Try syncing again.");
        },
      };
      const operation = syncProductResources(options).catch((error) => error);
      await flush();
      expect(delayed).toHaveBeenCalledOnce();
      current = false;
      resume();
      const outcome = await operation;
      expect(outcome).toBeInstanceOf(Error);
      expect(next).not.toHaveBeenCalled();
      if (["prepare", "view", "ticket", "upload", "finalize"].includes(stage))
        expect(boundary.clear).toHaveBeenCalledWith(asset);
      else expect(boundary.clear).not.toHaveBeenCalled();
    },
  );
});
