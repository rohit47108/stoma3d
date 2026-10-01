import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  DISCLAIMER,
  type AnalysisResult,
  type ComparisonResult,
} from "@stoma3d/contracts";
import type { CaptureDraft } from "../src/lib/captureDrafts";
import type {
  CaptureRecord,
  ObservationPin,
  PersistedAppState,
} from "../src/types";

const protectedWorkspace = vi.hoisted(() => ({
  state: null as PersistedAppState | null,
  drafts: [] as CaptureDraft[],
  files: new Set<string>(),
  failNextWrite: false,
}));

vi.mock("expo-crypto", () => ({ randomUUID: () => "generated-id" }));
vi.mock("@/constants", () => ({ ORAL_MAP_ASSET_VERSION: "test-map-v1" }));
vi.mock("@/lib/liveInputPolicy", () => import("../src/lib/liveInputPolicy"));
vi.mock(
  "@/lib/longitudinalPolicy",
  () => import("../src/lib/longitudinalPolicy"),
);
vi.mock("@/lib/captureDrafts", () => import("../src/lib/captureDrafts"));
vi.mock("@/lib/observationPins", () => import("../src/lib/observationPins"));
vi.mock("@/lib/scanLogic", () => import("../src/lib/scanLogic"));
vi.mock("@/lib/notifications", () => ({
  cancelAllStoma3DReminders: async () => undefined,
}));
vi.mock("@/lib/storage", () => ({
  loadPersistedState: async () => structuredClone(protectedWorkspace.state),
  loadCaptureDrafts: async () => structuredClone(protectedWorkspace.drafts),
  queuePersistedState: async (state: PersistedAppState) => {
    if (protectedWorkspace.failNextWrite) {
      protectedWorkspace.failNextWrite = false;
      throw new Error("The test database cannot commit this write.");
    }
    protectedWorkspace.state = structuredClone(state);
  },
  storeCaptureDraft: async (draft: CaptureDraft) => {
    protectedWorkspace.drafts = [
      ...protectedWorkspace.drafts.filter((item) => item.id !== draft.id),
      structuredClone(draft),
    ];
    return structuredClone(protectedWorkspace.drafts);
  },
  deleteStoredCaptureDraft: async (id: string) => {
    protectedWorkspace.drafts = protectedWorkspace.drafts.filter(
      (draft) => draft.id !== id,
    );
    return structuredClone(protectedWorkspace.drafts);
  },
  deleteAllLocalDataAndRotateKeys: async () => undefined,
}));
vi.mock("@/lib/secureFiles", () => ({
  removeProtectedFile: async (uri: string | null) => {
    if (uri) protectedWorkspace.files.delete(uri);
  },
  removeUnreferencedProtectedFiles: async (uris: (string | null)[]) => {
    const retained = new Set(uris);
    for (const uri of protectedWorkspace.files) {
      if (!retained.has(uri)) protectedWorkspace.files.delete(uri);
    }
  },
}));

import { useStoma3DStore } from "../src/store/useStoma3DStore";

const initialState = useStoma3DStore.getState();
const quality = {
  accepted: true,
  blurScore: 0.8,
  exposureScore: 0.9,
  glareScore: 0,
  obstructionScore: 0,
  faceDetected: false,
  reasons: [],
};

function capture(id: string, encryptedUri: string): CaptureRecord {
  return {
    id,
    encryptedUri,
    sessionId: "scan",
    region: "dorsal_tongue",
    angle: "primary",
    mediaKind: "image",
    capturedAt: "2026-10-01T20:00:00Z",
    mimeType: "image/jpeg",
    inputOrigin: "live_capture",
    captureSource: "photo_library",
    privacyConfirmedByUser: true,
    regionConfirmedByUser: true,
    quality,
  };
}

function analysis(record: CaptureRecord): AnalysisResult {
  return {
    contractVersion: CONTRACT_VERSION,
    captureId: record.id,
    region: record.region,
    quality,
    anatomyPrediction: {
      region: record.region,
      confidence: 0.9,
      supported: true,
      selectedRegionMatches: true,
    },
    candidateMask: null,
    descriptors: null,
    appearanceOutput: null,
    diseaseResearchOutput: null,
    uncertainty: {
      overallConfidence: 0.8,
      imageQualityConfidence: 0.9,
      datasetSimilarity: 0.7,
      modelAgreement: 0.8,
      limitations: [],
    },
    abstentionReasons: [],
    modelVersions: { anatomy: "test" },
    inputOrigin: "live_capture",
    analysisOrigin: "live_model",
    status: "complete",
    disclaimer: DISCLAIMER,
  };
}

function retryDraft(record: CaptureRecord): CaptureDraft {
  return {
    id: record.id,
    sessionId: record.sessionId,
    region: record.region,
    angle: record.angle,
    encryptedUri: record.encryptedUri!,
    mimeType: record.mimeType,
    source: "photo_library",
    width: 1200,
    height: 900,
    byteSize: 180000,
    capturedAt: record.capturedAt,
    privacyPassed: true,
    quality,
  };
}

function candidateAnalysis(record: CaptureRecord): AnalysisResult {
  return {
    ...analysis(record),
    candidateMask: {
      polygon: [
        [0.1, 0.1],
        [0.2, 0.1],
        [0.2, 0.2],
      ],
      boundingBox: [0.1, 0.1, 0.1, 0.1],
      normalizedArea: 0.01,
    },
    descriptors: {
      normalizedArea: 0.01,
      perimeter: 0.4,
      borderIrregularity: 0.1,
      meanRedness: 0.5,
      meanBrightness: 0.5,
      textureContrast: 0.3,
      measurementLabel: "approximate",
    },
  };
}

function seedComparedObservation() {
  const current = capture(
    "current-photo",
    "file:///documents/stoma3d-vault/current-photo.osv",
  );
  const baseline = {
    ...capture(
      "earlier-photo",
      "file:///documents/stoma3d-vault/earlier-photo.osv",
    ),
    sessionId: "earlier-scan",
    capturedAt: "2026-09-01T20:00:00Z",
  };
  const previousAnalysis = candidateAnalysis(current);
  const pin: ObservationPin = {
    id: "confirmed-pin",
    region: current.region,
    meshId: "tongue_dorsal",
    uvX: 0.15,
    uvY: 0.15,
    assetVersion: "test-map-v1",
    userConfirmed: true,
    firstObservedAt: baseline.capturedAt,
    status: "stable",
    comparisonStatus: "stable",
    captureIds: [baseline.id, current.id],
  };
  const comparison: ComparisonResult = {
    contractVersion: CONTRACT_VERSION,
    baselineCaptureId: baseline.id,
    currentCaptureId: current.id,
    region: current.region,
    candidateMatchScore: null,
    userConfirmedMatch: true,
    registrationConfidence: 0.2,
    inlierRatio: 0.4,
    reprojectionErrorRatio: 0.05,
    normalizedChange: null,
    comparable: false,
    suppressionReasons: ["registration_gate_not_met"],
    modelVersions: { registration: "test" },
    inputOrigin: "live_capture",
    analysisOrigin: "live_model",
    disclaimer: DISCLAIMER,
  };
  const report = {
    id: "generated-report",
    sessionId: current.sessionId,
    createdAt: "2026-10-01T20:02:00Z",
    encryptedUri: "file:///documents/stoma3d-vault/generated-report.osv",
  };
  const state: PersistedAppState = {
    ...protectedWorkspace.state!,
    sessions: [
      ...protectedWorkspace.state!.sessions,
      {
        id: baseline.sessionId,
        createdAt: baseline.capturedAt,
        demo: false,
        label: "Earlier mouth scan",
        protocol: "standard_eight_region",
      },
    ],
    captures: [baseline, current],
    analyses: {
      [baseline.id]: candidateAnalysis(baseline),
      [current.id]: previousAnalysis,
    },
    pins: [pin],
    comparisons: [comparison],
    reports: [report],
  };
  protectedWorkspace.state = structuredClone(state);
  for (const uri of [
    baseline.encryptedUri!,
    current.encryptedUri!,
    report.encryptedUri,
  ])
    protectedWorkspace.files.add(uri);
  useStoma3DStore.setState(state);
  return { current, baseline, previousAnalysis, pin, comparison, report };
}

beforeEach(() => {
  const { hydrated, storageError, captureDrafts, ...withActions } =
    initialState;
  const state: PersistedAppState = {
    schemaVersion: withActions.schemaVersion,
    consentedAt: "2026-10-01T19:00:00Z",
    profile: null,
    settings: withActions.settings,
    sessions: [
      {
        id: "scan",
        createdAt: "2026-10-01T19:00:00Z",
        demo: false,
        label: "Mouth scan",
        protocol: "standard_eight_region",
      },
    ],
    captures: [],
    analyses: {},
    comparisons: [],
    pins: [],
    reports: [],
    activeSessionId: "scan",
  };
  protectedWorkspace.state = structuredClone(state);
  protectedWorkspace.drafts = [];
  protectedWorkspace.files.clear();
  protectedWorkspace.failNextWrite = false;
  useStoma3DStore.setState({
    ...initialState,
    ...state,
    hydrated: true,
    captureDrafts: [],
    storageError: null,
  });
});

describe("protected capture save recovery", () => {
  it("keeps a retry draft readable after a failed commit and reopening", async () => {
    const record = capture(
      "pending-photo",
      "file:///documents/stoma3d-vault/pending-photo.osv",
    );
    protectedWorkspace.files.add(record.encryptedUri!);
    await useStoma3DStore.getState().saveCaptureDraft(retryDraft(record));
    protectedWorkspace.failNextWrite = true;

    await expect(
      useStoma3DStore.getState().addCapture(record, analysis(record)),
    ).rejects.toThrow("The protected capture set was not saved");

    expect(useStoma3DStore.getState().captures).toEqual([]);
    expect(protectedWorkspace.state?.captures).toEqual([]);
    expect(protectedWorkspace.files.has(record.encryptedUri!)).toBe(true);
    await useStoma3DStore.getState().hydrate();
    expect(useStoma3DStore.getState().captureDrafts).toEqual([
      retryDraft(record),
    ]);
    expect(protectedWorkspace.files.has(record.encryptedUri!)).toBe(true);

    await useStoma3DStore.getState().addCapture(record, analysis(record));
    await useStoma3DStore.getState().removeCaptureDraft(record.id);
    expect(protectedWorkspace.state?.captures).toEqual([record]);
    expect(useStoma3DStore.getState().captureDrafts).toEqual([]);
    expect(protectedWorkspace.files.has(record.encryptedUri!)).toBe(true);
  });

  it("removes an unreferenced incoming image after a failed commit", async () => {
    const record = capture(
      "unsaved-photo",
      "file:///documents/stoma3d-vault/unsaved-photo.osv",
    );
    protectedWorkspace.files.add(record.encryptedUri!);
    protectedWorkspace.failNextWrite = true;

    await expect(
      useStoma3DStore.getState().addCapture(record, analysis(record)),
    ).rejects.toThrow("The protected capture set was not saved");

    expect(protectedWorkspace.files.has(record.encryptedUri!)).toBe(false);
    expect(useStoma3DStore.getState().captures).toEqual([]);
  });

  it("keeps a saved image when a replacement reuses its protected file", async () => {
    const original = capture(
      "saved-photo",
      "file:///documents/stoma3d-vault/saved-photo.osv",
    );
    protectedWorkspace.files.add(original.encryptedUri!);
    await useStoma3DStore.getState().addCapture(original, analysis(original));
    const replacement = { ...original, id: "updated-photo" };

    await useStoma3DStore
      .getState()
      .addCapture(replacement, analysis(replacement));

    expect(protectedWorkspace.state?.captures).toEqual([replacement]);
    expect(protectedWorkspace.files.has(replacement.encryptedUri!)).toBe(true);
  });
});

describe("saved analysis retry consistency", () => {
  it("preserves confirmed pins and artifacts when the analysis is unchanged", async () => {
    const { current, previousAnalysis, pin, comparison, report } =
      seedComparedObservation();

    await useStoma3DStore
      .getState()
      .updateCaptureAnalysis(current.id, structuredClone(previousAnalysis));

    expect(useStoma3DStore.getState().pins).toEqual([pin]);
    expect(useStoma3DStore.getState().comparisons).toEqual([comparison]);
    expect(useStoma3DStore.getState().reports).toEqual([report]);
    expect(protectedWorkspace.files.has(report.encryptedUri)).toBe(true);
  });

  it("requires fresh confirmation for a changed mask while keeping earlier links", async () => {
    const { current, baseline, previousAnalysis, report } =
      seedComparedObservation();
    const updated: AnalysisResult = {
      ...previousAnalysis,
      candidateMask: {
        ...previousAnalysis.candidateMask!,
        polygon: [
          [0.3, 0.3],
          [0.4, 0.3],
          [0.4, 0.4],
        ],
        boundingBox: [0.3, 0.3, 0.1, 0.1],
      },
    };

    await useStoma3DStore.getState().updateCaptureAnalysis(current.id, updated);

    expect(useStoma3DStore.getState().analyses[current.id]).toEqual(updated);
    expect(useStoma3DStore.getState().pins).toEqual([
      expect.objectContaining({
        captureIds: [baseline.id],
        userConfirmed: true,
        status: "review_unavailable",
      }),
    ]);
    expect(useStoma3DStore.getState().pins[0]).not.toHaveProperty(
      "comparisonStatus",
    );
    expect(useStoma3DStore.getState().pins[0]?.uvX).toBeCloseTo(0.15);
    expect(useStoma3DStore.getState().pins[0]?.uvY).toBeCloseTo(0.15);
    expect(useStoma3DStore.getState().comparisons).toEqual([]);
    expect(useStoma3DStore.getState().reports).toEqual([]);
    expect(protectedWorkspace.files.has(report.encryptedUri)).toBe(false);

    useStoma3DStore.getState().confirmObservationPin(current.id);
    expect(useStoma3DStore.getState().pins).toContainEqual(
      expect.objectContaining({
        captureIds: [current.id],
        uvX: 0.35,
        uvY: 0.35,
        userConfirmed: true,
      }),
    );
  });

  it("keeps a confirmed location but removes stale comparisons after descriptor changes", async () => {
    const { current, previousAnalysis, pin } = seedComparedObservation();
    const updated: AnalysisResult = {
      ...previousAnalysis,
      descriptors: { ...previousAnalysis.descriptors!, meanRedness: 0.6 },
    };

    await useStoma3DStore.getState().updateCaptureAnalysis(current.id, updated);

    const { comparisonStatus, ...location } = pin;
    expect(useStoma3DStore.getState().pins).toEqual([
      { ...location, status: "review_unavailable" },
    ]);
    expect(useStoma3DStore.getState().comparisons).toEqual([]);
    expect(useStoma3DStore.getState().reports).toEqual([]);
  });

  it("restores the previous result and artifacts when a changed result cannot commit", async () => {
    const { current, previousAnalysis, pin, comparison, report } =
      seedComparedObservation();
    const updated: AnalysisResult = {
      ...previousAnalysis,
      candidateMask: null,
      descriptors: null,
    };
    protectedWorkspace.failNextWrite = true;

    await expect(
      useStoma3DStore.getState().updateCaptureAnalysis(current.id, updated),
    ).rejects.toThrow("The previous result is unchanged");

    expect(useStoma3DStore.getState().analyses[current.id]).toEqual(
      previousAnalysis,
    );
    expect(useStoma3DStore.getState().pins).toEqual([pin]);
    expect(useStoma3DStore.getState().comparisons).toEqual([comparison]);
    expect(useStoma3DStore.getState().reports).toEqual([report]);
    expect(protectedWorkspace.files.has(report.encryptedUri)).toBe(true);
  });

  it("removes a sole pin when the candidate is no longer detected", async () => {
    const { current, previousAnalysis, pin } = seedComparedObservation();
    useStoma3DStore.setState({ pins: [{ ...pin, captureIds: [current.id] }] });

    await useStoma3DStore.getState().updateCaptureAnalysis(current.id, {
      ...previousAnalysis,
      candidateMask: null,
      descriptors: null,
    });

    expect(useStoma3DStore.getState().pins).toEqual([]);
    expect(useStoma3DStore.getState().comparisons).toEqual([]);
    expect(useStoma3DStore.getState().reports).toEqual([]);
  });
});
