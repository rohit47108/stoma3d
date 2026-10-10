import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  DISCLAIMER,
  type AnalysisResult,
  type ComparisonResult,
} from "@stoma3d/contracts";
import type { CaptureDraft } from "../src/lib/captureDrafts";
import type { NormalizedStorageRows } from "../src/lib/normalizedStorageSchema";
import type {
  CaptureRecord,
  IntakeProfile,
  ObservationPin,
  PersistedAppState,
} from "../src/types";

const protectedWorkspace = vi.hoisted(() => ({
  state: null as PersistedAppState | null,
  drafts: [] as CaptureDraft[],
  files: new Set<string>(),
  failNextWrite: false,
  writeGate: null as Promise<void> | null,
  deleteCalls: 0,
  cleanupGate: null as Promise<void> | null,
  failNextReset: false,
  failNextRead: false,
  reconcileWrites: false,
  rows: null as NormalizedStorageRows | null,
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
vi.mock(
  "@/lib/localMutationQueue",
  () => import("../src/lib/localMutationQueue"),
);
vi.mock("@/lib/notifications", () => ({
  cancelAllStoma3DReminders: async () => undefined,
}));
vi.mock("@/lib/storage", async () => {
  const { entityIdentities, reconcileNormalizedRows, restorePersistedState } =
    await import("../src/lib/normalizedStorageSchema");
  return {
    loadPersistedState: async () => {
      if (protectedWorkspace.failNextRead) {
        protectedWorkspace.failNextRead = false;
        throw new Error(
          "The test database cannot reload the committed workspace.",
        );
      }
      return structuredClone(protectedWorkspace.state);
    },
    loadCaptureDrafts: async () => structuredClone(protectedWorkspace.drafts),
    queuePersistedState: async (state: PersistedAppState) => {
      if (protectedWorkspace.writeGate) await protectedWorkspace.writeGate;
      if (protectedWorkspace.failNextWrite) {
        protectedWorkspace.failNextWrite = false;
        throw new Error("The test database cannot commit this write.");
      }
      if (protectedWorkspace.reconcileWrites) {
        const previous =
          protectedWorkspace.rows ??
          (protectedWorkspace.state
            ? reconcileNormalizedRows(
                [],
                [],
                protectedWorkspace.state,
                "2026-10-09T20:00:00Z",
              )
            : null);
        protectedWorkspace.rows = reconcileNormalizedRows(
          previous ? entityIdentities(previous) : [],
          previous?.tombstones ?? [],
          state,
          "2026-10-09T20:01:00Z",
        );
        protectedWorkspace.state = restorePersistedState(
          protectedWorkspace.rows,
        );
      } else protectedWorkspace.state = structuredClone(state);
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
    deleteAllLocalDataAndRotateKeys: async () => {
      protectedWorkspace.deleteCalls += 1;
      if (protectedWorkspace.failNextReset) {
        protectedWorkspace.failNextReset = false;
        throw new Error("The test database reset could not finish.");
      }
      protectedWorkspace.state = null;
      protectedWorkspace.rows = null;
      protectedWorkspace.drafts = [];
      protectedWorkspace.files.clear();
    },
  };
});
vi.mock("@/lib/secureFiles", () => ({
  removeProtectedFile: async (uri: string | null) => {
    if (protectedWorkspace.cleanupGate) await protectedWorkspace.cleanupGate;
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

beforeEach(async () => {
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
  protectedWorkspace.writeGate = null;
  protectedWorkspace.deleteCalls = 0;
  protectedWorkspace.cleanupGate = null;
  protectedWorkspace.failNextReset = false;
  protectedWorkspace.failNextRead = false;
  protectedWorkspace.reconcileWrites = false;
  protectedWorkspace.rows = null;
  useStoma3DStore.setState({
    ...initialState,
    ...state,
    hydrated: true,
    captureDrafts: [],
    storageError: null,
  });
  await useStoma3DStore.getState().hydrate();
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

    await useStoma3DStore.getState().confirmObservationPin(current.id);
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

function seedDependentReports() {
  const compared = seedComparedObservation();
  const unrelatedCapture = {
    ...capture(
      "unrelated-photo",
      "file:///documents/stoma3d-vault/unrelated-photo.osv",
    ),
    sessionId: "unrelated-scan",
    region: "upper_lip" as const,
  };
  const baselineReport = {
    ...compared.report,
    id: "baseline-report",
    sessionId: compared.baseline.sessionId,
    encryptedUri: "file:///documents/stoma3d-vault/baseline-report.osv",
  };
  const unrelatedReport = {
    ...compared.report,
    id: "unrelated-report",
    sessionId: unrelatedCapture.sessionId,
    encryptedUri: "file:///documents/stoma3d-vault/unrelated-report.osv",
  };
  const state: PersistedAppState = {
    ...protectedWorkspace.state!,
    captures: [...protectedWorkspace.state!.captures, unrelatedCapture],
    analyses: {
      ...protectedWorkspace.state!.analyses,
      [unrelatedCapture.id]: analysis(unrelatedCapture),
    },
    sessions: [
      ...protectedWorkspace.state!.sessions,
      {
        id: unrelatedCapture.sessionId,
        createdAt: unrelatedCapture.capturedAt,
        demo: false,
        label: "Unrelated scan",
        protocol: "standard_eight_region",
      },
    ],
    reports: [baselineReport, compared.report, unrelatedReport],
  };
  protectedWorkspace.state = structuredClone(state);
  useStoma3DStore.setState(state);
  for (const uri of [
    unrelatedCapture.encryptedUri!,
    baselineReport.encryptedUri,
    unrelatedReport.encryptedUri,
  ])
    protectedWorkspace.files.add(uri);
  return { ...compared, baselineReport, unrelatedReport };
}

type BaselineMutation = "change" | "replace" | "delete";

async function mutateBaseline(
  action: BaselineMutation,
  baseline: CaptureRecord,
) {
  if (action === "change") {
    const updated = candidateAnalysis(baseline);
    await useStoma3DStore.getState().updateCaptureAnalysis(baseline.id, {
      ...updated,
      descriptors: { ...updated.descriptors!, meanRedness: 0.6 },
    });
  } else if (action === "replace") {
    const replacement = {
      ...baseline,
      id: "replacement-baseline",
      encryptedUri: "file:///documents/stoma3d-vault/replacement-baseline.osv",
    };
    protectedWorkspace.files.add(replacement.encryptedUri);
    await useStoma3DStore
      .getState()
      .addCapture(replacement, candidateAnalysis(replacement));
  } else {
    await useStoma3DStore.getState().discardCapture(baseline.id);
  }
}

describe("cross-session report dependency invalidation", () => {
  it.each(["change", "replace", "delete"] as const)(
    "%s of an older baseline invalidates its later comparison PDF but keeps unrelated PDFs",
    async (action) => {
      const { baseline, report, baselineReport, unrelatedReport } =
        seedDependentReports();

      await mutateBaseline(action, baseline);

      expect(useStoma3DStore.getState().comparisons).toEqual([]);
      expect(useStoma3DStore.getState().reports).toEqual([unrelatedReport]);
      expect(protectedWorkspace.state?.reports).toEqual([unrelatedReport]);
      expect(protectedWorkspace.state?.comparisons).toEqual([]);
      expect(protectedWorkspace.files.has(report.encryptedUri)).toBe(false);
      expect(protectedWorkspace.files.has(baselineReport.encryptedUri)).toBe(
        false,
      );
      expect(protectedWorkspace.files.has(unrelatedReport.encryptedUri)).toBe(
        true,
      );
    },
  );

  it.each(["change", "replace", "delete"] as const)(
    "rolls back a failed baseline %s and retains every existing protected file",
    async (action) => {
      const { baseline } = seedDependentReports();
      const previous = structuredClone(protectedWorkspace.state!);
      const previousFiles = [...protectedWorkspace.files];
      protectedWorkspace.failNextWrite = true;

      await expect(mutateBaseline(action, baseline)).rejects.toThrow();

      expect(protectedWorkspace.state).toEqual(previous);
      const state = useStoma3DStore.getState();
      expect(state.captures).toEqual(previous.captures);
      expect(state.analyses).toEqual(previous.analyses);
      expect(state.pins).toEqual(previous.pins);
      expect(state.comparisons).toEqual(previous.comparisons);
      expect(state.reports).toEqual(previous.reports);
      for (const uri of previousFiles)
        expect(protectedWorkspace.files.has(uri)).toBe(true);
    },
  );

  it("invalidates a later PDF linked by a changed pin even without a stored comparison", async () => {
    const { baseline, unrelatedReport } = seedDependentReports();
    const state = { ...protectedWorkspace.state!, comparisons: [] };
    protectedWorkspace.state = structuredClone(state);
    useStoma3DStore.setState(state);

    await mutateBaseline("change", baseline);

    expect(useStoma3DStore.getState().reports).toEqual([unrelatedReport]);
    expect(useStoma3DStore.getState().pins[0]?.status).toBe(
      "review_unavailable",
    );
  });

  it("retains dependent protected PDFs until the changed baseline commits", async () => {
    const { baseline, report, baselineReport } = seedDependentReports();
    let releaseWrite!: () => void;
    protectedWorkspace.writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });

    const mutation = mutateBaseline("change", baseline);
    expect(protectedWorkspace.files.has(report.encryptedUri)).toBe(true);
    expect(protectedWorkspace.files.has(baselineReport.encryptedUri)).toBe(
      true,
    );
    expect(protectedWorkspace.state?.comparisons).toHaveLength(1);
    releaseWrite();
    await mutation;

    expect(protectedWorkspace.files.has(report.encryptedUri)).toBe(false);
    expect(protectedWorkspace.files.has(baselineReport.encryptedUri)).toBe(
      false,
    );
  });
});

describe("report freshness after map content changes", () => {
  it("invalidates the capture session PDF when its first pin is confirmed", async () => {
    const { current, baselineReport, unrelatedReport, report } =
      seedDependentReports();
    const state = { ...protectedWorkspace.state!, pins: [], comparisons: [] };
    protectedWorkspace.state = structuredClone(state);
    useStoma3DStore.setState(state);

    await useStoma3DStore.getState().confirmObservationPin(current.id);

    expect(useStoma3DStore.getState().pins).toHaveLength(1);
    expect(useStoma3DStore.getState().reports).toEqual([
      baselineReport,
      unrelatedReport,
    ]);
    expect(protectedWorkspace.state?.reports).toEqual([
      baselineReport,
      unrelatedReport,
    ]);
    expect(protectedWorkspace.files.has(report.encryptedUri)).toBe(false);
    expect(protectedWorkspace.files.has(unrelatedReport.encryptedUri)).toBe(
      true,
    );
  });

  it("rolls back pin confirmation and retains its PDF when persistence fails", async () => {
    const { current, report } = seedDependentReports();
    const state = { ...protectedWorkspace.state!, pins: [], comparisons: [] };
    protectedWorkspace.state = structuredClone(state);
    useStoma3DStore.setState(state);
    protectedWorkspace.failNextWrite = true;

    await expect(
      useStoma3DStore.getState().confirmObservationPin(current.id),
    ).rejects.toThrow("previous history is unchanged");

    expect(useStoma3DStore.getState().pins).toEqual([]);
    expect(useStoma3DStore.getState().reports).toEqual(state.reports);
    expect(protectedWorkspace.state).toEqual(state);
    expect(protectedWorkspace.files.has(report.encryptedUri)).toBe(true);
  });

  it("does not invalidate a regenerated PDF when confirming an already confirmed pin", async () => {
    const { current, report } = seedDependentReports();
    const before = structuredClone(protectedWorkspace.state!);

    await useStoma3DStore.getState().confirmObservationPin(current.id);

    expect(protectedWorkspace.state).toEqual(before);
    expect(useStoma3DStore.getState().reports).toEqual(before.reports);
    expect(protectedWorkspace.files.has(report.encryptedUri)).toBe(true);
  });

  it("invalidates PDFs for sessions whose pin links change when a comparison is saved", async () => {
    const {
      comparison,
      unrelatedReport,
      report,
      baselineReport,
      pin,
      baseline,
    } = seedDependentReports();
    const state = {
      ...protectedWorkspace.state!,
      comparisons: [],
      pins: [
        {
          ...pin,
          captureIds: [baseline.id],
          status: "review_unavailable" as const,
        },
      ],
    };
    protectedWorkspace.state = structuredClone(state);
    useStoma3DStore.setState(state);

    await useStoma3DStore.getState().addComparison(comparison);

    expect(useStoma3DStore.getState().comparisons).toEqual([comparison]);
    expect(useStoma3DStore.getState().pins[0]?.captureIds).toEqual([
      baseline.id,
      comparison.currentCaptureId,
    ]);
    expect(useStoma3DStore.getState().reports).toEqual([unrelatedReport]);
    expect(protectedWorkspace.state?.reports).toEqual([unrelatedReport]);
    expect(protectedWorkspace.files.has(report.encryptedUri)).toBe(false);
    expect(protectedWorkspace.files.has(baselineReport.encryptedUri)).toBe(
      false,
    );
    expect(protectedWorkspace.files.has(unrelatedReport.encryptedUri)).toBe(
      true,
    );
  });

  it("restores comparisons, pins and PDFs after a comparison save fails", async () => {
    const { comparison, report } = seedDependentReports();
    const state = { ...protectedWorkspace.state!, comparisons: [] };
    protectedWorkspace.state = structuredClone(state);
    useStoma3DStore.setState(state);
    protectedWorkspace.failNextWrite = true;

    await expect(
      useStoma3DStore.getState().addComparison(comparison),
    ).rejects.toThrow("Existing history is unchanged");

    expect(useStoma3DStore.getState().comparisons).toEqual(state.comparisons);
    expect(useStoma3DStore.getState().pins).toEqual(state.pins);
    expect(useStoma3DStore.getState().reports).toEqual(state.reports);
    expect(protectedWorkspace.state).toEqual(state);
    expect(protectedWorkspace.files.has(report.encryptedUri)).toBe(true);
  });

  it.each(["pin", "comparison"] as const)(
    "keeps the protected PDF until a %s change commits",
    async (change) => {
      const { current, comparison, report } = seedDependentReports();
      const state = {
        ...protectedWorkspace.state!,
        comparisons: [],
        ...(change === "pin" ? { pins: [] } : {}),
      };
      protectedWorkspace.state = structuredClone(state);
      useStoma3DStore.setState(state);
      let releaseWrite!: () => void;
      protectedWorkspace.writeGate = new Promise<void>((resolve) => {
        releaseWrite = resolve;
      });

      const mutation =
        change === "pin"
          ? useStoma3DStore.getState().confirmObservationPin(current.id)
          : useStoma3DStore.getState().addComparison(comparison);
      expect(protectedWorkspace.files.has(report.encryptedUri)).toBe(true);
      expect(protectedWorkspace.state).toEqual(state);
      releaseWrite();
      await mutation;

      expect(protectedWorkspace.files.has(report.encryptedUri)).toBe(false);
    },
  );
});

function pendingPinFailure() {
  const seeded = seedDependentReports();
  const state = { ...protectedWorkspace.state!, pins: [], comparisons: [] };
  protectedWorkspace.state = structuredClone(state);
  useStoma3DStore.setState(state);
  let releaseWrite!: () => void;
  protectedWorkspace.writeGate = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  protectedWorkspace.failNextWrite = true;
  const pin = useStoma3DStore
    .getState()
    .confirmObservationPin(seeded.current.id);
  const rejection = expect(pin).rejects.toThrow(
    "previous history is unchanged",
  );
  return { ...seeded, state, rejection, releaseWrite };
}

describe("complete local mutation serialization", () => {
  it("reopens only the durable state after a pending pin save rolls back", async () => {
    const { state, rejection, releaseWrite } = pendingPinFailure();
    const reopen = useStoma3DStore.getState().hydrate();
    const hydratedWhilePending = useStoma3DStore.getState().hydrated;
    releaseWrite();
    await rejection;
    await reopen;

    expect(hydratedWhilePending).toBe(true);
    expect(useStoma3DStore.getState().captures).toEqual(state.captures);
    expect(useStoma3DStore.getState().pins).toEqual([]);
    expect(protectedWorkspace.state?.pins).toEqual([]);
    expect(useStoma3DStore.getState().reports).toEqual(state.reports);
    for (const record of state.captures)
      expect(protectedWorkspace.files.has(record.encryptedUri!)).toBe(true);
  });

  it("does not lose a queued retry draft when the prior pin write rolls back", async () => {
    const { rejection, releaseWrite } = pendingPinFailure();
    const draft = retryDraft(
      capture("retry-photo", "file:///documents/stoma3d-vault/retry-photo.osv"),
    );
    protectedWorkspace.files.add(draft.encryptedUri);
    const saveDraft = useStoma3DStore.getState().saveCaptureDraft(draft);
    releaseWrite();
    await rejection;
    await saveDraft;
    await useStoma3DStore.getState().hydrate();

    expect(useStoma3DStore.getState().captureDrafts).toEqual([draft]);
    expect(protectedWorkspace.drafts).toEqual([draft]);
    expect(protectedWorkspace.state?.pins).toEqual([]);
    expect(protectedWorkspace.files.has(draft.encryptedUri)).toBe(true);
  });

  it("finishes protected-file deletion before the next settings mutation can begin", async () => {
    const { current } = seedDependentReports();
    let releaseCleanup!: () => void;
    protectedWorkspace.cleanupGate = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const deletion = useStoma3DStore.getState().discardCapture(current.id);
    const settings = useStoma3DStore
      .getState()
      .updateSettings({ highContrast: true });
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    const settingsWhileCleaning =
      useStoma3DStore.getState().settings.highContrast;
    const durableSettingsWhileCleaning =
      protectedWorkspace.state?.settings.highContrast;
    releaseCleanup();
    await deletion;
    await settings;

    expect(settingsWhileCleaning).toBe(false);
    expect(durableSettingsWhileCleaning).toBe(false);
    expect(protectedWorkspace.files.has(current.encryptedUri!)).toBe(false);
    expect(protectedWorkspace.state?.settings.highContrast).toBe(true);
    expect(
      protectedWorkspace.state?.captures.some((item) => item.id === current.id),
    ).toBe(false);
  });

  it("rolls back failed cloud application before saving the next settings change", async () => {
    seedDependentReports();
    const before = structuredClone(protectedWorkspace.state!);
    let releaseWrite!: () => void;
    protectedWorkspace.writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    protectedWorkspace.failNextWrite = true;
    const cloudState = { ...before, reports: [], pins: [] };
    const cloud = useStoma3DStore
      .getState()
      .applyCloudState(
        () => cloudState,
        useStoma3DStore.getState().getWorkspaceGeneration(),
      );
    const failure = expect(cloud).rejects.toThrow(
      "Synced changes could not be saved",
    );
    const settings = useStoma3DStore
      .getState()
      .updateSettings({ largeText: true });
    releaseWrite();
    await failure;
    await settings;

    expect(useStoma3DStore.getState().reports).toEqual(before.reports);
    expect(protectedWorkspace.state?.reports).toEqual(before.reports);
    expect(protectedWorkspace.state?.pins).toEqual(before.pins);
    expect(protectedWorkspace.state?.settings.largeText).toBe(true);
    for (const report of before.reports)
      expect(protectedWorkspace.files.has(report.encryptedUri)).toBe(true);
  });

  it("does not resurrect another capture or persist a failed pin when deletion overlaps its failed write", async () => {
    const { state, rejection, releaseWrite } = pendingPinFailure();
    const unrelated = state.captures.find(
      (record) => record.sessionId === "unrelated-scan",
    )!;
    const deletion = useStoma3DStore.getState().discardCapture(unrelated.id);
    releaseWrite();
    await rejection;
    await deletion;

    expect(useStoma3DStore.getState().captures).not.toContainEqual(unrelated);
    expect(protectedWorkspace.state?.captures).not.toContainEqual(unrelated);
    expect(protectedWorkspace.files.has(unrelated.encryptedUri!)).toBe(false);
    expect(useStoma3DStore.getState().pins).toEqual([]);
    expect(protectedWorkspace.state?.pins).toEqual([]);
    expect(useStoma3DStore.getState().reports).toEqual(
      state.reports.filter(
        (report) => report.sessionId !== unrelated.sessionId,
      ),
    );
    expect(protectedWorkspace.state?.reports).toEqual(
      useStoma3DStore.getState().reports,
    );
  });

  it("starts queued settings from the rolled-back state and continues after rejection", async () => {
    const { rejection, releaseWrite } = pendingPinFailure();
    const settings = useStoma3DStore
      .getState()
      .updateSettings({ highContrast: true });
    releaseWrite();
    await rejection;
    await settings;

    expect(useStoma3DStore.getState().settings.highContrast).toBe(true);
    expect(protectedWorkspace.state?.settings.highContrast).toBe(true);
    expect(useStoma3DStore.getState().pins).toEqual([]);
    expect(protectedWorkspace.state?.pins).toEqual([]);
  });

  it("returns only a committed queued session and never freezes the failed pin into it", async () => {
    const { rejection, releaseWrite } = pendingPinFailure();
    const session = useStoma3DStore.getState().startFreshSession();
    releaseWrite();
    await rejection;
    const id = await session;

    expect(useStoma3DStore.getState().activeSessionId).toBe(id);
    expect(
      useStoma3DStore.getState().sessions.some((item) => item.id === id),
    ).toBe(true);
    expect(protectedWorkspace.state?.activeSessionId).toBe(id);
    expect(
      protectedWorkspace.state?.sessions.some((item) => item.id === id),
    ).toBe(true);
    expect(useStoma3DStore.getState().pins).toEqual([]);
    expect(protectedWorkspace.state?.pins).toEqual([]);
  });

  it("keeps a queued active-session change after the earlier pin write fails", async () => {
    const { baseline, rejection, releaseWrite } = pendingPinFailure();
    const switchSession = useStoma3DStore
      .getState()
      .setActiveSession(baseline.sessionId);
    releaseWrite();
    await rejection;
    await switchSession;

    expect(useStoma3DStore.getState().activeSessionId).toBe(baseline.sessionId);
    expect(protectedWorkspace.state?.activeSessionId).toBe(baseline.sessionId);
    expect(protectedWorkspace.state?.pins).toEqual([]);
  });

  it("does not lose a queued consent change or save it with the failed pin", async () => {
    const { rejection, releaseWrite } = pendingPinFailure();
    const profile: IntakeProfile = {
      ageRange: "18_39",
      assisted: false,
      firstNoticed: "today",
      symptoms: [],
      change: "not_sure",
      tobaccoExposure: "none",
      alcoholExposure: "none",
      previousConditions: "",
      professionallyExamined: false,
    };
    const consent = useStoma3DStore.getState().finishConsent(profile);
    releaseWrite();
    await rejection;
    await consent;

    expect(useStoma3DStore.getState().profile).toEqual(profile);
    expect(protectedWorkspace.state?.profile).toEqual(profile);
    expect(protectedWorkspace.state?.pins).toEqual([]);
  });

  it("waits for a failing pin mutation before deleting the protected workspace and keys", async () => {
    const { state, rejection, releaseWrite } = pendingPinFailure();
    const deletion = useStoma3DStore.getState().deleteEverything();
    await Promise.resolve();
    await Promise.resolve();
    const deleteCallsWhilePending = protectedWorkspace.deleteCalls;
    const readableWhilePending = protectedWorkspace.files.has(
      state.captures[0]!.encryptedUri!,
    );
    releaseWrite();
    await rejection;
    await deletion;

    expect(deleteCallsWhilePending).toBe(0);
    expect(readableWhilePending).toBe(true);
    expect(protectedWorkspace.deleteCalls).toBe(1);
    expect(useStoma3DStore.getState().captures).toEqual([]);
    expect(useStoma3DStore.getState().pins).toEqual([]);
    expect(protectedWorkspace.state?.captures).toEqual([]);
    expect(protectedWorkspace.state?.pins).toEqual([]);
    expect(protectedWorkspace.files.size).toBe(0);
  });

  it("rejects an active-session request queued behind local deletion instead of reviving a missing scan", async () => {
    const { current, rejection, releaseWrite } = pendingPinFailure();
    const deletion = useStoma3DStore.getState().deleteEverything();
    const switchSession = useStoma3DStore
      .getState()
      .setActiveSession(current.sessionId);
    const switchFailure = expect(
      Promise.resolve(switchSession),
    ).rejects.toThrow("no longer available");
    releaseWrite();
    await rejection;
    await deletion;
    await switchFailure;

    expect(useStoma3DStore.getState().activeSessionId).toBeNull();
    expect(protectedWorkspace.state?.activeSessionId).toBeNull();
    expect(useStoma3DStore.getState().sessions).toEqual([]);
    expect(protectedWorkspace.state?.sessions).toEqual([]);
  });

  it("rejects a fresh-session request queued behind consent deletion", async () => {
    const { rejection, releaseWrite } = pendingPinFailure();
    const deletion = useStoma3DStore.getState().deleteEverything();
    const session = useStoma3DStore.getState().startFreshSession();
    const sessionFailure = expect(Promise.resolve(session)).rejects.toThrow(
      "Review consent",
    );
    releaseWrite();
    await rejection;
    await deletion;
    await sessionFailure;

    expect(useStoma3DStore.getState().sessions).toEqual([]);
    expect(useStoma3DStore.getState().activeSessionId).toBeNull();
    expect(protectedWorkspace.state?.sessions).toEqual([]);
  });

  it.each(["settings", "session", "active", "consent"] as const)(
    "rejects and rolls back a failed %s setter rather than reporting an unsaved change",
    async (change) => {
      const { baseline } = seedDependentReports();
      const before = structuredClone(protectedWorkspace.state!);
      protectedWorkspace.failNextWrite = true;
      const profile: IntakeProfile = {
        ageRange: "18_39",
        assisted: false,
        firstNoticed: "today",
        symptoms: [],
        change: "not_sure",
        tobaccoExposure: "none",
        alcoholExposure: "none",
        previousConditions: "",
        professionallyExamined: false,
      };
      const state = useStoma3DStore.getState();
      const mutation =
        change === "settings"
          ? state.updateSettings({ highContrast: true })
          : change === "session"
            ? state.startFreshSession()
            : change === "active"
              ? state.setActiveSession(baseline.sessionId)
              : state.finishConsent(profile);
      await expect(Promise.resolve(mutation)).rejects.toThrow();
      expect(protectedWorkspace.state).toEqual(before);
      expect(useStoma3DStore.getState().settings).toEqual(before.settings);
      expect(useStoma3DStore.getState().sessions).toEqual(before.sessions);
      expect(useStoma3DStore.getState().activeSessionId).toBe(
        before.activeSessionId,
      );
      expect(useStoma3DStore.getState().profile).toEqual(before.profile);
    },
  );
});

describe("atomic latest-state cloud mutations", () => {
  it("publishes and returns the normalized durable state without a remotely replayed tombstoned capture", async () => {
    const { current, baseline } = seedDependentReports();
    protectedWorkspace.reconcileWrites = true;
    await useStoma3DStore.getState().discardCapture(current.id);
    await useStoma3DStore.getState().updateSettings({ highContrast: true });
    const replay = {
      ...current,
      encryptedUri: "file:///documents/stoma3d-vault/replayed-photo.osv",
    };
    protectedWorkspace.files.add(replay.encryptedUri);
    const committed = await useStoma3DStore.getState().applyCloudState(
      (latest) => ({
        ...latest,
        captures: [...latest.captures, replay],
        analyses: {
          ...latest.analyses,
          [replay.id]: candidateAnalysis(replay),
        },
      }),
      useStoma3DStore.getState().getWorkspaceGeneration(),
    );

    expect(protectedWorkspace.rows?.tombstones).toContainEqual(
      expect.objectContaining({
        entityType: "capture_views",
        entityId: current.id,
      }),
    );
    expect(
      protectedWorkspace.state?.captures.some((item) => item.id === current.id),
    ).toBe(false);
    expect(committed.captures.some((item) => item.id === current.id)).toBe(
      false,
    );
    expect(
      useStoma3DStore
        .getState()
        .captures.some((item) => item.id === current.id),
    ).toBe(false);
    expect(committed).toEqual(protectedWorkspace.state);
    expect(committed.settings.highContrast).toBe(true);
    expect(protectedWorkspace.files.has(replay.encryptedUri)).toBe(false);
    expect(protectedWorkspace.files.has(baseline.encryptedUri!)).toBe(true);
  });

  it("preserves ciphertext and blocks a queued setting after commit succeeds but normalized readback fails, then recovers by hydration", async () => {
    const { current, baseline, report } = seedDependentReports();
    protectedWorkspace.reconcileWrites = true;
    const before = structuredClone(protectedWorkspace.state!);
    const replacementUri =
      "file:///documents/stoma3d-vault/cloud-replacement.osv";
    protectedWorkspace.files.add(replacementUri);
    protectedWorkspace.failNextRead = true;
    const cloud = useStoma3DStore.getState().applyCloudState(
      (latest) => ({
        ...latest,
        captures: latest.captures.map((item) =>
          item.id === current.id
            ? { ...item, encryptedUri: replacementUri }
            : item,
        ),
        settings: { ...latest.settings, highContrast: true },
        reports: [],
      }),
      useStoma3DStore.getState().getWorkspaceGeneration(),
    );
    const cloudFailure = expect(cloud).rejects.toThrow(
      "saved, but the protected workspace could not be reloaded",
    );
    const settings = useStoma3DStore
      .getState()
      .updateSettings({ largeText: true });
    const settingsFailure = expect(settings).rejects.toThrow(
      "Reload the protected workspace",
    );
    await Promise.all([cloudFailure, settingsFailure]);

    expect(protectedWorkspace.state?.settings.highContrast).toBe(true);
    expect(protectedWorkspace.state?.settings.largeText).toBe(false);
    expect(
      protectedWorkspace.state?.captures.find((item) => item.id === current.id)
        ?.encryptedUri,
    ).toBe(replacementUri);
    expect(useStoma3DStore.getState().captures).toEqual(before.captures);
    expect(useStoma3DStore.getState().hydrated).toBe(true);
    expect(useStoma3DStore.getState().storageError).toContain(
      "could not be reloaded",
    );
    for (const uri of [
      current.encryptedUri!,
      baseline.encryptedUri!,
      report.encryptedUri,
      replacementUri,
    ])
      expect(protectedWorkspace.files.has(uri)).toBe(true);

    await useStoma3DStore.getState().hydrate();
    expect(useStoma3DStore.getState().storageError).toBeNull();
    expect(
      useStoma3DStore.getState().captures.find((item) => item.id === current.id)
        ?.encryptedUri,
    ).toBe(replacementUri);
    expect(protectedWorkspace.files.has(replacementUri)).toBe(true);
    await useStoma3DStore.getState().updateSettings({ largeText: true });
    expect(protectedWorkspace.state?.settings.highContrast).toBe(true);
    expect(protectedWorkspace.state?.settings.largeText).toBe(true);
    expect(protectedWorkspace.files.has(replacementUri)).toBe(true);
  });

  it("keeps reload recovery visible when reset initialization fails and clears the gate after a successful reset", async () => {
    seedDependentReports();
    protectedWorkspace.failNextRead = true;
    await expect(
      useStoma3DStore
        .getState()
        .applyCloudState(
          (latest) => latest,
          useStoma3DStore.getState().getWorkspaceGeneration(),
        ),
    ).rejects.toThrow("could not be reloaded");

    protectedWorkspace.failNextWrite = true;
    await expect(useStoma3DStore.getState().deleteEverything()).rejects.toThrow(
      "empty protected state could not be initialized",
    );
    expect(useStoma3DStore.getState().hydrated).toBe(true);
    expect(useStoma3DStore.getState().storageError).toContain(
      "empty protected state could not be initialized",
    );
    await expect(
      useStoma3DStore.getState().updateSettings({ largeText: true }),
    ).rejects.toThrow("Reload the protected workspace");
    expect(protectedWorkspace.state).toBeNull();

    await useStoma3DStore.getState().deleteEverything();
    expect(useStoma3DStore.getState().storageError).toBeNull();
    await useStoma3DStore.getState().updateSettings({ largeText: true });
    expect(protectedWorkspace.state?.settings.largeText).toBe(true);
  });

  it("derives the cloud change after queued settings and a failed pin have finished", async () => {
    const { state, rejection, releaseWrite } = pendingPinFailure();
    const settings = useStoma3DStore
      .getState()
      .updateSettings({ highContrast: true });
    let observed: PersistedAppState | null = null;
    const cloud = useStoma3DStore.getState().applyCloudState((latest) => {
      observed = structuredClone(latest);
      return { ...latest, settings: { ...latest.settings, largeText: true } };
    }, useStoma3DStore.getState().getWorkspaceGeneration());
    const observedWhilePending = observed;
    releaseWrite();
    await rejection;
    await settings;
    const committed = await cloud;

    expect(observedWhilePending).toBeNull();
    expect(observed).toEqual({
      ...state,
      settings: { ...state.settings, highContrast: true },
    });
    expect(committed).toEqual(protectedWorkspace.state);
    expect(committed.settings.highContrast).toBe(true);
    expect(committed.settings.largeText).toBe(true);
    expect(committed.pins).toEqual([]);
    expect(useStoma3DStore.getState().captures).toEqual(state.captures);
  });

  it("cancels pre-deletion cloud work before its reducer can restore the cleared workspace", async () => {
    seedDependentReports();
    const before = structuredClone(protectedWorkspace.state!);
    const generation = useStoma3DStore.getState().getWorkspaceGeneration();
    const deletion = useStoma3DStore.getState().deleteEverything();
    const restore = vi.fn(() => before);
    const cloud = useStoma3DStore
      .getState()
      .applyCloudState(restore, generation);
    const cancellation = expect(cloud).rejects.toThrow("Retry sync");
    await deletion;
    await cancellation;

    expect(restore).not.toHaveBeenCalled();
    expect(useStoma3DStore.getState().captures).toEqual([]);
    expect(protectedWorkspace.state?.captures).toEqual([]);
    expect(protectedWorkspace.files.size).toBe(0);
  });

  it("invalidates in-flight cloud work even when the destructive reset fails", async () => {
    seedDependentReports();
    const before = structuredClone(protectedWorkspace.state!);
    const generation = useStoma3DStore.getState().getWorkspaceGeneration();
    protectedWorkspace.failNextReset = true;
    const deletion = useStoma3DStore.getState().deleteEverything();
    const deletionFailure = expect(deletion).rejects.toThrow(
      "reset could not finish",
    );
    const restore = vi.fn(() => ({
      ...before,
      settings: { ...before.settings, highContrast: true },
    }));
    const cloud = useStoma3DStore
      .getState()
      .applyCloudState(restore, generation);
    const cancellation = expect(cloud).rejects.toThrow(
      "Reload the protected workspace",
    );
    await deletionFailure;
    await cancellation;

    expect(restore).not.toHaveBeenCalled();
    expect(useStoma3DStore.getState().getWorkspaceGeneration()).not.toBe(
      generation,
    );
    expect(protectedWorkspace.state).toEqual(before);
    expect(useStoma3DStore.getState().settings).toEqual(before.settings);
    for (const record of before.captures)
      expect(protectedWorkspace.files.has(record.encryptedUri!)).toBe(true);
    expect(useStoma3DStore.getState().storageError).toContain(
      "could not be fully cleared",
    );
    await expect(
      useStoma3DStore.getState().updateSettings({ largeText: true }),
    ).rejects.toThrow("Reload the protected workspace");
    await useStoma3DStore.getState().hydrate();
    expect(useStoma3DStore.getState().storageError).toBeNull();
    await useStoma3DStore.getState().updateSettings({ largeText: true });
    expect(protectedWorkspace.state?.settings.largeText).toBe(true);
  });
});
