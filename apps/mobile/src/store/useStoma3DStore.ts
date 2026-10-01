import * as Crypto from "expo-crypto";
import { create } from "zustand";
import type {
  AnalysisResult,
  CaptureProtocol,
  ComparisonResult,
  MouthRegion,
} from "@stoma3d/contracts";
import { MOUTH_REGION_DETAILS } from "@stoma3d/contracts";

import { ORAL_MAP_ASSET_VERSION } from "@/constants";
import {
  assertLiveMobileInput,
  assertLiveResultOrigin,
} from "@/lib/liveInputPolicy";
import { isChronologicalComparison } from "@/lib/longitudinalPolicy";
import { captureDraftSchema, type CaptureDraft } from "@/lib/captureDrafts";
import { cancelAllStoma3DReminders } from "@/lib/notifications";
import { pinsAfterConfirmedComparison } from "@/lib/observationPins";
import { comparisonsWithoutCaptureIds } from "@/lib/scanLogic";
import {
  deleteAllLocalDataAndRotateKeys,
  loadPersistedState,
  loadCaptureDrafts,
  storeCaptureDraft,
  deleteStoredCaptureDraft,
  queuePersistedState,
} from "@/lib/storage";
import {
  removeProtectedFile,
  removeUnreferencedProtectedFiles,
} from "@/lib/secureFiles";
import type {
  AccessibilitySettings,
  CaptureRecord,
  IntakeProfile,
  ObservationPin,
  PersistedAppState,
  ReportRecord,
  ScanSession,
} from "@/types";

interface Stoma3DState extends PersistedAppState {
  /** Retry photos are local-only and never count toward scan completeness. */
  captureDrafts: CaptureDraft[];
  saveCaptureDraft: (draft: CaptureDraft) => Promise<void>;
  removeCaptureDraft: (id: string) => Promise<void>;
  hydrated: boolean;
  storageError: string | null;
  hydrate: () => Promise<void>;
  finishConsent: (profile: IntakeProfile) => void;
  finishConsentAndStartSession: (
    profile: IntakeProfile,
    protocol: CaptureProtocol,
  ) => Promise<string>;
  startFreshSession: (protocol?: CaptureProtocol) => string;
  setActiveSession: (sessionId: string) => void;
  addCapture: (
    capture: CaptureRecord,
    analysis: AnalysisResult,
  ) => Promise<void>;
  addCaptures: (
    entries: readonly {
      capture: CaptureRecord;
      analysis: AnalysisResult;
    }[],
  ) => Promise<void>;
  updateCaptureAnalysis: (
    captureId: string,
    analysis: AnalysisResult,
  ) => Promise<void>;
  discardCapture: (captureId: string) => Promise<void>;
  confirmObservationPin: (captureId: string) => void;
  addComparison: (comparison: ComparisonResult) => Promise<void>;
  addReport: (report: ReportRecord) => Promise<void>;
  updateSettings: (settings: Partial<AccessibilitySettings>) => void;
  applyCloudState: (state: PersistedAppState) => Promise<void>;
  deleteEverything: () => Promise<void>;
}

const DEFAULT_SETTINGS: AccessibilitySettings = {
  highContrast: false,
  largeText: false,
  reducedMotion: false,
  animationSpeed: "standard",
  haptics: true,
  voiceInstructions: false,
  caregiverMode: false,
  analyticsOptIn: false,
};

function initialPersistedState(): PersistedAppState {
  return {
    schemaVersion: 4,
    consentedAt: null,
    profile: null,
    settings: DEFAULT_SETTINGS,
    sessions: [],
    captures: [],
    analyses: {},
    comparisons: [],
    pins: [],
    reports: [],
    activeSessionId: null,
  };
}

function persistedSnapshot(state: Stoma3DState): PersistedAppState {
  return {
    schemaVersion: 4,
    consentedAt: state.consentedAt,
    profile: state.profile,
    settings: state.settings,
    sessions: state.sessions,
    captures: state.captures,
    analyses: state.analyses,
    comparisons: state.comparisons,
    pins: state.pins,
    reports: state.reports,
    activeSessionId: state.activeSessionId,
  };
}

function protectedUris(state: Stoma3DState): Set<string> {
  return new Set([
    ...state.captures.flatMap((capture) =>
      capture.encryptedUri ? [capture.encryptedUri] : [],
    ),
    ...state.captureDrafts.map((draft) => draft.encryptedUri),
    ...state.reports.map((report) => report.encryptedUri),
  ]);
}

function persist(
  state: Stoma3DState,
  onError: (message: string) => void,
): void {
  void queuePersistedState(persistedSnapshot(state)).catch(() => {
    onError(
      "Stoma3D could not save the latest local change. Retry before continuing.",
    );
  });
}

function snapshotProfile(profile: IntakeProfile | null): IntakeProfile | null {
  return profile ? { ...profile, symptoms: [...profile.symptoms] } : null;
}

function pinForAnalysis(
  existing: ObservationPin[],
  capture: CaptureRecord,
  analysis: AnalysisResult,
): ObservationPin[] {
  if (!analysis.candidateMask) return existing;
  const regionDetail = MOUTH_REGION_DETAILS.find(
    (detail) => detail.id === capture.region,
  );
  if (!regionDetail) return existing;
  const [x, y, width, height] = analysis.candidateMask.boundingBox;
  return [
    ...existing,
    {
      id: Crypto.randomUUID(),
      region: capture.region,
      meshId: regionDetail.meshId,
      uvX: Math.min(1, Math.max(0, x + width / 2)),
      uvY: Math.min(1, Math.max(0, y + height / 2)),
      assetVersion: ORAL_MAP_ASSET_VERSION,
      userConfirmed: true,
      firstObservedAt: capture.capturedAt,
      status: "review_unavailable",
      captureIds: [capture.id],
    },
  ];
}

function normalizePersistedPins(pins: ObservationPin[]): ObservationPin[] {
  return pins.flatMap((pin) => {
    if (pin.userConfirmed !== true) return [];
    const regionDetail = MOUTH_REGION_DETAILS.find(
      (detail) => detail.id === pin.region,
    );
    if (!regionDetail) return [];
    const captureIds = [...new Set(pin.captureIds)];
    if (captureIds.length === 0) return [];
    return [
      {
        ...pin,
        meshId: regionDetail.meshId,
        assetVersion: ORAL_MAP_ASSET_VERSION,
        uvX: Math.min(1, Math.max(0, pin.uvX)),
        uvY: Math.min(1, Math.max(0, pin.uvY)),
        captureIds,
      },
    ];
  });
}

function withoutDemoData(persisted: PersistedAppState): PersistedAppState {
  const sessions = persisted.sessions.filter((session) => !session.demo);
  const sessionIds = new Set(sessions.map((session) => session.id));
  const captures = persisted.captures.filter(
    (capture) =>
      sessionIds.has(capture.sessionId) &&
      capture.inputOrigin === "live_capture" &&
      !capture.samplePlaceholder,
  );
  const captureIds = new Set(captures.map((capture) => capture.id));
  const analyses = Object.fromEntries(
    Object.entries(persisted.analyses).filter(([captureId]) =>
      captureIds.has(captureId),
    ),
  );
  const comparisons = persisted.comparisons.filter(
    (comparison) =>
      comparison.inputOrigin === "live_capture" &&
      captureIds.has(comparison.baselineCaptureId) &&
      captureIds.has(comparison.currentCaptureId),
  );
  const pins = persisted.pins.flatMap((pin) => {
    const linkedCaptureIds = pin.captureIds.filter((captureId) =>
      captureIds.has(captureId),
    );
    return linkedCaptureIds.length > 0
      ? [{ ...pin, captureIds: linkedCaptureIds }]
      : [];
  });
  return {
    ...persisted,
    sessions,
    captures,
    analyses,
    comparisons,
    pins,
    reports: persisted.reports.filter((report) =>
      sessionIds.has(report.sessionId),
    ),
    activeSessionId:
      persisted.activeSessionId && sessionIds.has(persisted.activeSessionId)
        ? persisted.activeSessionId
        : null,
  };
}

function assertPersistedReferences(state: PersistedAppState): void {
  const sessionsById = new Map(
    state.sessions.map((session) => [session.id, session]),
  );
  const capturesById = new Map(
    state.captures.map((capture) => [capture.id, capture]),
  );
  if (state.activeSessionId && !sessionsById.has(state.activeSessionId)) {
    throw new Error("Persisted active session is missing.");
  }
  for (const capture of state.captures) {
    if (!sessionsById.has(capture.sessionId)) {
      throw new Error("Persisted capture refers to a missing session.");
    }
  }
  for (const [captureId, analysis] of Object.entries(state.analyses)) {
    const capture = capturesById.get(captureId);
    if (
      !capture ||
      analysis.captureId !== captureId ||
      analysis.region !== capture.region ||
      analysis.inputOrigin !== capture.inputOrigin
    ) {
      throw new Error("Persisted analysis identity is inconsistent.");
    }
  }
  for (const comparison of state.comparisons) {
    const baseline = capturesById.get(comparison.baselineCaptureId);
    const current = capturesById.get(comparison.currentCaptureId);
    if (
      !baseline ||
      !current ||
      baseline.region !== comparison.region ||
      current.region !== comparison.region ||
      baseline.inputOrigin !== comparison.inputOrigin ||
      current.inputOrigin !== comparison.inputOrigin
    ) {
      throw new Error("Persisted comparison identity is inconsistent.");
    }
  }
  for (const pin of state.pins) {
    if (
      pin.captureIds.some(
        (captureId) => capturesById.get(captureId)?.region !== pin.region,
      )
    ) {
      throw new Error("Persisted map pin identity is inconsistent.");
    }
  }
  for (const report of state.reports) {
    if (!sessionsById.has(report.sessionId)) {
      throw new Error("Persisted report refers to a missing session.");
    }
  }
}

export const useStoma3DStore = create<Stoma3DState>((set, get) => ({
  ...initialPersistedState(),
  captureDrafts: [],
  hydrated: false,
  storageError: null,

  hydrate: async () => {
    set({ hydrated: false, storageError: null });
    try {
      const loaded = await loadPersistedState();
      const persisted = loaded ? withoutDemoData(loaded) : null;
      const captureDrafts = await loadCaptureDrafts();
      const sessionIds = new Set(
        persisted?.sessions.map((session) => session.id) ?? [],
      );
      const validDrafts = captureDrafts.filter((draft) =>
        sessionIds.has(draft.sessionId),
      );
      for (const draft of captureDrafts) {
        if (!sessionIds.has(draft.sessionId)) {
          await deleteStoredCaptureDraft(draft.id);
          await removeProtectedFile(draft.encryptedUri);
        }
      }
      if (persisted) {
        assertPersistedReferences(persisted);
        try {
          await removeUnreferencedProtectedFiles([
            ...persisted.captures.map((capture) => capture.encryptedUri),
            ...persisted.reports.map((report) => report.encryptedUri),
            ...validDrafts.map((draft) => draft.encryptedUri),
          ]);
        } catch {
          console.warn("[STOMA3D_ORPHAN_CLEANUP_FAILED]");
        }
      }
      set({
        ...(persisted ?? initialPersistedState()),
        pins: normalizePersistedPins(persisted?.pins ?? []),
        captureDrafts: validDrafts,
        hydrated: true,
        storageError: null,
      });
      if (loaded && persisted !== loaded) {
        await queuePersistedState(persistedSnapshot(get()));
      }
    } catch (error) {
      console.warn("[STOMA3D_STORAGE_OPEN_FAILED]");
      set({
        hydrated: true,
        storageError:
          "The protected local workspace could not be opened or validated. Stoma3D has not replaced it with an empty workspace.",
      });
    }
  },

  saveCaptureDraft: async (value) => {
    const draft = captureDraftSchema.parse(value);
    if (
      !get().consentedAt ||
      !get().sessions.some(
        (session) => session.id === draft.sessionId && !session.demo,
      )
    ) {
      throw new Error("Start a scan before saving a photo for retry.");
    }
    const previous = get().captureDrafts.filter(
      (item) =>
        item.id === draft.id ||
        (item.sessionId === draft.sessionId &&
          item.region === draft.region &&
          item.angle === draft.angle),
    );
    const captureDrafts = await storeCaptureDraft(draft);
    set({ captureDrafts });
    const retained = new Set([
      ...captureDrafts.map((item) => item.encryptedUri),
      ...get().captures.map((item) => item.encryptedUri),
    ]);
    for (const item of previous) {
      if (!retained.has(item.encryptedUri))
        await removeProtectedFile(item.encryptedUri);
    }
  },

  removeCaptureDraft: async (id) => {
    const draft = get().captureDrafts.find((item) => item.id === id);
    const captureDrafts = await deleteStoredCaptureDraft(id);
    set({ captureDrafts });
    if (
      draft &&
      !get().captures.some(
        (capture) => capture.encryptedUri === draft.encryptedUri,
      )
    ) {
      await removeProtectedFile(draft.encryptedUri);
    }
  },

  finishConsent: (profile) => {
    set({
      profile,
      consentedAt: new Date().toISOString(),
      storageError: null,
    });
    persist(get(), (message) => set({ storageError: message }));
  },

  finishConsentAndStartSession: async (profile, protocol) => {
    const stateBeforeCommit = get();
    const consentedAt = new Date().toISOString();
    const id = Crypto.randomUUID();
    const session: ScanSession = {
      id,
      createdAt: consentedAt,
      demo: false,
      label: "Structured mouth scan",
      protocol,
      intakeProfile: snapshotProfile(profile),
      consentedAt,
    };
    set((state) => ({
      profile,
      consentedAt,
      sessions: [...state.sessions, session],
      activeSessionId: id,
      storageError: null,
    }));
    try {
      await queuePersistedState(persistedSnapshot(get()));
    } catch {
      set(stateBeforeCommit);
      throw new Error(
        "Consent and intake could not be saved in the protected workspace.",
      );
    }
    return id;
  },

  startFreshSession: (protocol = "standard_eight_region") => {
    const id = Crypto.randomUUID();
    const session: ScanSession = {
      id,
      createdAt: new Date().toISOString(),
      demo: false,
      label: "New structured scan",
      protocol,
      intakeProfile: snapshotProfile(get().profile),
      consentedAt: get().consentedAt,
    };
    set((state) => ({
      sessions: [...state.sessions, session],
      activeSessionId: id,
      storageError: null,
    }));
    persist(get(), (message) => set({ storageError: message }));
    return id;
  },

  setActiveSession: (sessionId) => {
    if (!get().sessions.some((session) => session.id === sessionId)) return;
    set({ activeSessionId: sessionId, storageError: null });
    persist(get(), (message) => set({ storageError: message }));
  },

  addCapture: async (capture, analysis) => {
    await get().addCaptures([{ capture, analysis }]);
  },

  addCaptures: async (entries) => {
    if (entries.length === 0 || entries.length > 12) {
      throw new Error("A capture save must contain between one and 12 views.");
    }
    const stateBeforeCommit = get();
    const incomingIds = new Set<string>();
    const incomingViewKeys = new Set<string>();
    for (const { capture, analysis } of entries) {
      const targetSession = stateBeforeCommit.sessions.find(
        (session) => session.id === capture.sessionId,
      );
      assertLiveMobileInput(capture.inputOrigin);
      assertLiveResultOrigin(analysis.analysisOrigin);
      if (!targetSession || targetSession.demo) {
        throw new Error(
          "A live capture requires a valid non-demo scan session.",
        );
      }
      if (
        analysis.captureId !== capture.id ||
        analysis.region !== capture.region ||
        analysis.inputOrigin !== capture.inputOrigin
      ) {
        throw new Error("The analysis identity does not match this capture.");
      }
      const sourceAccepted =
        capture.captureSource === "camera" ||
        capture.captureSource === "photo_library" ||
        capture.captureSource === "video_sweep";
      if (
        !capture.encryptedUri ||
        !capture.quality.accepted ||
        capture.privacyConfirmedByUser !== true ||
        capture.regionConfirmedByUser !== true ||
        !sourceAccepted
      ) {
        throw new Error(
          "Only a protected, accepted, user-confirmed live capture can be saved.",
        );
      }
      if (
        targetSession.protocol === "standard_eight_region" &&
        (capture.angle !== "primary" || capture.mediaKind !== "image")
      ) {
        throw new Error("A standard scan keeps one primary image per region.");
      }
      if (
        targetSession.protocol === "guided_video_sweep" &&
        (capture.captureSource !== "video_sweep" ||
          capture.mediaKind !== "video_frame" ||
          capture.angle === "primary")
      ) {
        throw new Error(
          "A guided sweep may save only traceable frames extracted from that sweep.",
        );
      }
      if (
        targetSession.protocol === "detailed_multi_angle" &&
        (capture.mediaKind !== "image" || capture.angle === "primary")
      ) {
        throw new Error(
          "A detailed scan requires a named non-primary camera angle.",
        );
      }
      if (
        capture.calibrationRequested === true &&
        (capture.calibrationPlaneConfirmed !== true ||
          capture.calibrationCardVersion !== "stoma3d-calibration-v1")
      ) {
        throw new Error(
          "A physical scale request requires the versioned card and same-plane confirmation.",
        );
      }
      if (
        capture.calibration &&
        capture.calibration.captureViewId !== capture.id
      ) {
        throw new Error(
          "Calibration evidence does not belong to this capture.",
        );
      }
      const viewKey = `${capture.sessionId}\u0000${capture.region}\u0000${capture.angle}`;
      if (incomingIds.has(capture.id) || incomingViewKeys.has(viewKey)) {
        throw new Error("A capture batch cannot repeat an ID or region angle.");
      }
      incomingIds.add(capture.id);
      incomingViewKeys.add(viewKey);
    }
    const supersededCaptures = stateBeforeCommit.captures.filter((item) =>
      incomingViewKeys.has(
        `${item.sessionId}\u0000${item.region}\u0000${item.angle}`,
      ),
    );
    const affectedSessionIds = new Set(
      entries.map(({ capture }) => capture.sessionId),
    );
    const invalidatedReports = stateBeforeCommit.reports.filter((report) =>
      affectedSessionIds.has(report.sessionId),
    );
    set((state) => {
      const replacedCaptureIds = supersededCaptures
        .filter((item) =>
          state.captures.some((current) => current.id === item.id),
        )
        .map((item) => item.id);
      const retainedCaptures = state.captures.filter(
        (item) => !replacedCaptureIds.includes(item.id),
      );
      const retainedPins = state.pins.filter(
        (pin) =>
          !pin.captureIds.some((captureId) =>
            replacedCaptureIds.includes(captureId),
          ),
      );
      const retainedAnalyses = Object.fromEntries(
        Object.entries(state.analyses).filter(
          ([captureId]) => !replacedCaptureIds.includes(captureId),
        ),
      );
      const retainedComparisons = comparisonsWithoutCaptureIds(
        state.comparisons,
        replacedCaptureIds,
      );
      return {
        captures: [
          ...retainedCaptures,
          ...entries.map(({ capture }) => capture),
        ],
        analyses: {
          ...retainedAnalyses,
          ...Object.fromEntries(
            entries.map(({ capture, analysis }) => [capture.id, analysis]),
          ),
        },
        pins: retainedPins,
        comparisons: retainedComparisons,
        reports: state.reports.filter(
          (report) => !affectedSessionIds.has(report.sessionId),
        ),
      };
    });
    try {
      await queuePersistedState(persistedSnapshot(get()));
    } catch {
      set(stateBeforeCommit);
      const retainedUris = protectedUris(get());
      const cleanup = await Promise.allSettled(
        entries
          .filter(
            ({ capture }) =>
              capture.encryptedUri && !retainedUris.has(capture.encryptedUri),
          )
          .map(({ capture }) => removeProtectedFile(capture.encryptedUri)),
      );
      if (cleanup.some((result) => result.status === "rejected")) {
        console.warn("[STOMA3D_UNSAVED_CAPTURE_CLEANUP_FAILED]");
      }
      throw new Error(
        "The protected capture set was not saved. The previous views are unchanged.",
      );
    }
    const retainedUris = protectedUris(get());
    const obsoleteUris = [
      ...supersededCaptures.map((item) => item.encryptedUri),
      ...invalidatedReports.map((report) => report.encryptedUri),
    ].filter((uri): uri is string => !!uri && !retainedUris.has(uri));
    const cleanupResults = await Promise.allSettled(
      [...new Set(obsoleteUris)].map((uri) => removeProtectedFile(uri)),
    );
    if (cleanupResults.some((result) => result.status === "rejected")) {
      console.warn("[STOMA3D_SUPERSEDED_FILE_CLEANUP_FAILED]");
    }
  },

  updateCaptureAnalysis: async (captureId, analysis) => {
    const stateBeforeCommit = get();
    const capture = stateBeforeCommit.captures.find(
      (item) => item.id === captureId,
    );
    if (!capture) {
      throw new Error("The protected observation could not be found.");
    }
    assertLiveMobileInput(capture.inputOrigin);
    assertLiveResultOrigin(analysis.analysisOrigin);
    if (
      analysis.captureId !== capture.id ||
      analysis.region !== capture.region ||
      analysis.inputOrigin !== capture.inputOrigin
    ) {
      throw new Error(
        "The updated analysis identity does not match this capture.",
      );
    }
    const previousAnalysis = stateBeforeCommit.analyses[captureId];
    const maskChanged =
      JSON.stringify(previousAnalysis?.candidateMask) !==
      JSON.stringify(analysis.candidateMask);
    const descriptorsChanged =
      JSON.stringify(previousAnalysis?.descriptors) !==
      JSON.stringify(analysis.descriptors);
    const observationChanged = maskChanged || descriptorsChanged;
    const analysisChanged =
      JSON.stringify(previousAnalysis) !== JSON.stringify(analysis);
    const invalidatedReports = analysisChanged
      ? stateBeforeCommit.reports.filter(
          (report) => report.sessionId === capture.sessionId,
        )
      : [];
    const pins = observationChanged
      ? stateBeforeCommit.pins.flatMap((pin) => {
          if (!pin.captureIds.includes(captureId)) return [pin];
          const { comparisonStatus, ...confirmedLocation } = pin;
          if (!maskChanged) {
            return [
              { ...confirmedLocation, status: "review_unavailable" as const },
            ];
          }
          // A changed candidate requires a new confirmation. Keep any other
          // confirmed observations, but do not reuse the changed mask's UV.
          const captureIds = pin.captureIds.filter((id) => id !== captureId);
          const remainingCaptures = stateBeforeCommit.captures
            .filter(
              (item) =>
                captureIds.includes(item.id) &&
                stateBeforeCommit.analyses[item.id]?.candidateMask,
            )
            .sort((left, right) =>
              left.capturedAt.localeCompare(right.capturedAt),
            );
          const seed = remainingCaptures[0];
          const mask = seed
            ? stateBeforeCommit.analyses[seed.id]?.candidateMask
            : null;
          if (!seed || !mask) return [];
          const [x, y, width, height] = mask.boundingBox;
          return [
            {
              ...confirmedLocation,
              captureIds: remainingCaptures.map((item) => item.id),
              uvX: Math.min(1, Math.max(0, x + width / 2)),
              uvY: Math.min(1, Math.max(0, y + height / 2)),
              firstObservedAt: seed.capturedAt,
              status: "review_unavailable" as const,
            },
          ];
        })
      : stateBeforeCommit.pins;
    set((state) => ({
      captures: state.captures.map((item) =>
        item.id === captureId ? { ...item, quality: analysis.quality } : item,
      ),
      analyses: { ...state.analyses, [captureId]: analysis },
      pins,
      comparisons: observationChanged
        ? comparisonsWithoutCaptureIds(state.comparisons, [captureId])
        : state.comparisons,
      reports: analysisChanged
        ? state.reports.filter(
            (report) => report.sessionId !== capture.sessionId,
          )
        : state.reports,
      storageError: null,
    }));
    try {
      await queuePersistedState(persistedSnapshot(get()));
    } catch {
      set(stateBeforeCommit);
      throw new Error(
        "The new analysis response could not be saved. The previous result is unchanged.",
      );
    }
    const retainedUris = protectedUris(get());
    const cleanup = await Promise.allSettled(
      invalidatedReports
        .filter((report) => !retainedUris.has(report.encryptedUri))
        .map((report) => removeProtectedFile(report.encryptedUri)),
    );
    if (cleanup.some((result) => result.status === "rejected")) {
      console.warn("[STOMA3D_STALE_REPORT_CLEANUP_FAILED]");
    }
  },

  discardCapture: async (captureId) => {
    const stateBeforeCommit = get();
    const capture = stateBeforeCommit.captures.find(
      (item) => item.id === captureId,
    );
    if (!capture) return;
    const removedReports = stateBeforeCommit.reports.filter(
      (report) => report.sessionId === capture.sessionId,
    );
    set((state) => ({
      captures: state.captures.filter((item) => item.id !== captureId),
      analyses: Object.fromEntries(
        Object.entries(state.analyses).filter(([id]) => id !== captureId),
      ),
      comparisons: comparisonsWithoutCaptureIds(state.comparisons, [captureId]),
      pins: state.pins.filter((pin) => !pin.captureIds.includes(captureId)),
      reports: state.reports.filter(
        (report) => report.sessionId !== capture.sessionId,
      ),
      storageError: null,
    }));
    try {
      await queuePersistedState(persistedSnapshot(get()));
    } catch {
      set(stateBeforeCommit);
      throw new Error(
        "The rejected observation could not be removed safely. Retry local deletion from Settings.",
      );
    }
    const cleanup = await Promise.allSettled([
      removeProtectedFile(capture.encryptedUri),
      ...removedReports.map((report) =>
        removeProtectedFile(report.encryptedUri),
      ),
    ]);
    if (cleanup.some((result) => result.status === "rejected")) {
      set({
        storageError:
          "The rejected observation was removed from history, but one or more protected files still require cleanup.",
      });
      throw new Error(
        "The observation record was removed, but protected-file cleanup did not finish.",
      );
    }
  },

  confirmObservationPin: (captureId) => {
    const state = get();
    if (state.pins.some((pin) => pin.captureIds.includes(captureId))) {
      return;
    }
    const capture = state.captures.find((item) => item.id === captureId);
    const analysis = state.analyses[captureId];
    if (!capture || !analysis?.candidateMask) return;
    set({
      pins: pinForAnalysis(state.pins, capture, analysis),
      storageError: null,
    });
    persist(get(), (message) => set({ storageError: message }));
  },

  addComparison: async (comparison) => {
    const stateBeforeCommit = get();
    const baseline = stateBeforeCommit.captures.find(
      (capture) => capture.id === comparison.baselineCaptureId,
    );
    const current = stateBeforeCommit.captures.find(
      (capture) => capture.id === comparison.currentCaptureId,
    );
    assertLiveMobileInput(comparison.inputOrigin);
    assertLiveResultOrigin(comparison.analysisOrigin);
    if (
      !comparison.userConfirmedMatch ||
      !baseline ||
      !current ||
      baseline.region !== comparison.region ||
      current.region !== comparison.region ||
      !isChronologicalComparison(baseline, current)
    ) {
      throw new Error(
        "Only a user-confirmed, chronological comparison of two saved live observations can be stored.",
      );
    }
    set((state) => ({
      comparisons: [
        ...state.comparisons.filter(
          (item) =>
            item.baselineCaptureId !== comparison.baselineCaptureId ||
            item.currentCaptureId !== comparison.currentCaptureId,
        ),
        comparison,
      ],
      pins: pinsAfterConfirmedComparison(
        state.pins,
        state.captures,
        comparison,
      ),
      storageError: null,
    }));
    try {
      await queuePersistedState(persistedSnapshot(get()));
    } catch {
      set(stateBeforeCommit);
      throw new Error(
        "The comparison could not be saved. Existing history is unchanged.",
      );
    }
  },

  addReport: async (report) => {
    const stateBeforeCommit = get();
    const replaced = stateBeforeCommit.reports.filter(
      (item) => item.sessionId === report.sessionId,
    );
    set((state) => ({
      reports: [
        ...state.reports.filter((item) => item.sessionId !== report.sessionId),
        report,
      ],
      storageError: null,
    }));
    try {
      await queuePersistedState(persistedSnapshot(get()));
    } catch {
      set(stateBeforeCommit);
      await removeProtectedFile(report.encryptedUri);
      throw new Error(
        "The protected report could not be saved. The previous report is unchanged.",
      );
    }
    const cleanup = await Promise.allSettled(
      replaced.map((item) => removeProtectedFile(item.encryptedUri)),
    );
    if (cleanup.some((result) => result.status === "rejected")) {
      console.warn("[STOMA3D_REPLACED_REPORT_CLEANUP_FAILED]");
    }
  },

  updateSettings: (settings) => {
    set((state) => ({
      settings: { ...state.settings, ...settings },
      storageError: null,
    }));
    persist(get(), (message) => set({ storageError: message }));
  },

  applyCloudState: async (state) => {
    const stateBeforeCommit = get();
    assertPersistedReferences(state);
    const retainedUris = new Set([
      ...state.captures.flatMap((capture) =>
        capture.encryptedUri ? [capture.encryptedUri] : [],
      ),
      ...state.reports.map((report) => report.encryptedUri),
      ...stateBeforeCommit.captureDrafts.map((draft) => draft.encryptedUri),
    ]);
    const removedUris = [
      ...stateBeforeCommit.captures.flatMap((capture) =>
        capture.encryptedUri && !retainedUris.has(capture.encryptedUri)
          ? [capture.encryptedUri]
          : [],
      ),
      ...stateBeforeCommit.reports.flatMap((report) =>
        !retainedUris.has(report.encryptedUri) ? [report.encryptedUri] : [],
      ),
    ];
    set({ ...state, hydrated: true, storageError: null });
    try {
      await queuePersistedState(persistedSnapshot(get()));
    } catch {
      set(stateBeforeCommit);
      throw new Error(
        "Synced changes could not be saved in the protected workspace.",
      );
    }
    const cleanup = await Promise.allSettled(
      [...new Set(removedUris)].map((uri) => removeProtectedFile(uri)),
    );
    if (cleanup.some((result) => result.status === "rejected")) {
      console.warn("[STOMA3D_SYNCED_FILE_CLEANUP_FAILED]");
    }
  },

  deleteEverything: async () => {
    let reminderCleanupFailed = false;
    try {
      await cancelAllStoma3DReminders();
    } catch {
      reminderCleanupFailed = true;
    }
    await deleteAllLocalDataAndRotateKeys();
    set({
      ...initialPersistedState(),
      captureDrafts: [],
      hydrated: true,
      storageError: null,
    });
    try {
      await queuePersistedState(persistedSnapshot(get()));
    } catch {
      throw new Error(
        "Local data was removed, but the empty protected state could not be initialized.",
      );
    }
    if (reminderCleanupFailed) {
      throw new Error(
        "Local data was removed, but the device could not confirm that scheduled Stoma3D reminders were canceled. Review notification settings on this device.",
      );
    }
  },
}));

export function regionLabelForId(region: MouthRegion): string {
  return region.replaceAll("_", " ");
}
