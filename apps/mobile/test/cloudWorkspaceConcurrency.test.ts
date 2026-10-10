import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  DISCLAIMER,
  type AnalysisResult,
} from "@stoma3d/contracts";
import type {
  MeResponse,
  SyncOperationInput,
  SyncPullResponse,
} from "../src/cloud/contracts";
import type { CloudResourceMapping } from "../src/cloud/productSync";
import {
  entityIdentities,
  reconcileNormalizedRows,
  restorePersistedState,
  type NormalizedStorageRows,
} from "../src/lib/normalizedStorageSchema";
import { syncEntityMetadataKey } from "../src/cloud/syncModel";
import type {
  CaptureRecord,
  PersistedAppState,
  ScanSession,
} from "../src/types";

const boundary = vi.hoisted(() => ({
  state: null as PersistedAppState | null,
  rows: null as NormalizedStorageRows | null,
  files: new Set<string>(),
  metadata: {} as Record<string, string | null>,
  mappings: [] as CloudResourceMapping[],
  envelopes: {} as Record<string, unknown>,
  loadGate: null as Promise<void> | null,
  loadFailure: false,
  failNextRead: false,
  failReadAfterWrite: false,
  failNextWrite: false,
  staged: [] as SyncOperationInput[],
  uuid: 0,
  account: vi.fn(),
  pullSync: vi.fn(),
  requestAssetDownload: vi.fn(),
  download: vi.fn(),
  encrypt: vi.fn(),
  encryptEntity: vi.fn(),
  removeProtected: vi.fn(),
  removeTemporary: vi.fn(),
  createTemporary: vi.fn(),
  stageOutbox: vi.fn(),
  productSync: vi.fn(),
}));

vi.mock("expo-crypto", () => ({
  randomUUID: () => `fixture-${++boundary.uuid}`,
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => "fixture-device-id",
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-file-system/legacy", () => ({
  EncodingType: { Base64: "base64" },
  writeAsStringAsync: async () => undefined,
}));
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
vi.mock("@/lib/storage", () => ({
  loadPersistedState: async () => {
    if (boundary.loadGate) await boundary.loadGate;
    if (boundary.loadFailure)
      throw new Error("Protected storage cannot be opened.");
    if (boundary.failNextRead) {
      boundary.failNextRead = false;
      throw new Error("Committed protected state could not be reloaded.");
    }
    return structuredClone(boundary.state);
  },
  loadCaptureDrafts: async () => [],
  storeCaptureDraft: async () => [],
  deleteStoredCaptureDraft: async () => [],
  queuePersistedState: async (state: PersistedAppState) => {
    if (boundary.failNextWrite) {
      boundary.failNextWrite = false;
      throw new Error("Protected write failed.");
    }
    boundary.rows = reconcileNormalizedRows(
      boundary.rows ? entityIdentities(boundary.rows) : [],
      boundary.rows?.tombstones ?? [],
      structuredClone(state),
      new Date().toISOString(),
    );
    boundary.state = restorePersistedState(boundary.rows);
    if (boundary.failReadAfterWrite) {
      boundary.failReadAfterWrite = false;
      boundary.failNextRead = true;
    }
  },
  deleteAllLocalDataAndRotateKeys: async () => {
    boundary.state = null;
    boundary.rows = null;
    boundary.files.clear();
  },
  cloudMetadata: async (prefix: string) =>
    Object.fromEntries(
      Object.entries(boundary.metadata).filter(([key]) =>
        key.startsWith(prefix),
      ),
    ),
  updateCloudMetadata: async (updates: Record<string, string | null>) => {
    Object.assign(boundary.metadata, updates);
  },
  bindCloudAccount: async () => false,
  cloudAccountRebindPending: async () => false,
  confirmCloudAccountRebind: async () => undefined,
  acknowledgeCloudOutbox: async () => undefined,
  markCloudOutboxAttempt: async () => undefined,
  readCloudOutbox: async () => [],
  stageCloudOutbox: boundary.stageOutbox,
}));
vi.mock("@/lib/secureFiles", () => ({
  encryptFile: boundary.encrypt,
  removeProtectedFile: boundary.removeProtected,
  removeUnreferencedProtectedFiles: async (uris: Iterable<string | null>) => {
    const retained = new Set(uris);
    for (const uri of boundary.files)
      if (!retained.has(uri)) boundary.files.delete(uri);
  },
}));
vi.mock("@/lib/tempFiles", () => ({
  createStoma3DTempUri: boundary.createTemporary,
  removeFileIfPresent: boundary.removeTemporary,
}));
vi.mock(
  "@/store/useStoma3DStore",
  () => import("../src/store/useStoma3DStore"),
);
vi.mock("../src/cloud/client", () => ({
  PlatformClient: class {
    account = boundary.account;
    pullSync = boundary.pullSync;
    requestAssetDownload = boundary.requestAssetDownload;
  },
  newIdempotencyKey: () => "fixture-idempotency-key",
}));
vi.mock("../src/cloud/crypto", () => ({
  decryptCloudEntity: ({ entityId }: { entityId: string }) =>
    boundary.envelopes[entityId],
  encryptCloudEntity: boundary.encryptEntity,
  loadOrCreateCloudKey: async () => ({
    key: new Uint8Array(32),
    keyId: "fixture-key",
    recoveryCode: "fixture-recovery",
    created: false,
  }),
}));
vi.mock("../src/cloud/consent", () => ({
  requireActiveProductConsent: async () => ({
    consentRecordId: "fixture-consent",
  }),
}));
vi.mock("../src/cloud/productSync", () => ({
  cloudMappingKey: (kind: string, id: string) => `cloud.map.${kind}.${id}`,
  readCloudResourceMappings: async () => structuredClone(boundary.mappings),
  syncProductResources: boundary.productSync,
}));
vi.mock("../src/cloud/assetTransfer", () => ({
  downloadVerifiedAsset: boundary.download,
}));

import { materializeRemoteCaptures } from "../src/cloud/materialize";
import { runCloudSync } from "../src/cloud/sync";
import { useStoma3DStore } from "../src/store/useStoma3DStore";

const initialState = useStoma3DStore.getState();
const downloadedUri = "file:///documents/stoma3d-vault/downloaded.osv";
const localSession: ScanSession = {
  id: "local-scan",
  createdAt: "2026-10-08T12:00:00.000Z",
  demo: false,
  label: "Local scan",
  protocol: "standard_eight_region",
};
const capture: CaptureRecord = {
  id: "remote-photo",
  sessionId: localSession.id,
  region: "upper_lip",
  angle: "primary",
  mediaKind: "image",
  capturedAt: "2026-10-08T12:01:00.000Z",
  encryptedUri: null,
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
};
const baseState: PersistedAppState = {
  schemaVersion: 4,
  consentedAt: "2026-10-08T12:00:00.000Z",
  profile: null,
  settings: {
    highContrast: false,
    largeText: false,
    reducedMotion: false,
    animationSpeed: "standard",
    haptics: true,
    voiceInstructions: false,
    caregiverMode: false,
    analyticsOptIn: false,
  },
  sessions: [localSession],
  captures: [],
  analyses: {},
  comparisons: [],
  pins: [],
  reports: [],
  activeSessionId: localSession.id,
};
const account: MeResponse = {
  id: "fixture-account",
  role: "patient",
  status: "active",
  createdAt: localSession.createdAt,
  deletionPending: false,
  requiredOidcRole: null,
  privilegedAccessReady: true,
  clinicianApplicationEligible: false,
};
const productSummary = {
  sessionsCreated: 0,
  captureSetsCreated: 0,
  capturesUploaded: 0,
  analysisJobsCreated: 0,
  lesionsCreated: 0,
  matchProposalsCreated: 0,
  matchDecisionsRecorded: 0,
  comparisonJobsCreated: 0,
};
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function page(sessionId?: string, hasMore = false): SyncPullResponse {
  const session = {
    ...localSession,
    id: sessionId ?? "unused",
    label: "Remote scan",
  };
  if (sessionId)
    boundary.envelopes[sessionId] = {
      schemaVersion: 1,
      entityType: "scan_session",
      entityId: sessionId,
      record: session,
    };
  return {
    operations: sessionId
      ? [
          {
            contractVersion: "2.0.0",
            operationId: `operation-${sessionId}`,
            idempotencyKey: `remote-operation-${sessionId}`,
            deviceId: "other-device",
            entityType: "scan_session",
            entityId: sessionId,
            version: 1,
            sequence: 1,
            occurredAt: localSession.createdAt,
            operation: "upsert",
            encryptedPayload: "fixture-remote-payload",
            tombstone: false,
            serverSequence: 1,
          },
        ]
      : [],
    cursor: {
      contractVersion: "2.0.0",
      cursor: `fixture-cursor-${sessionId ?? "empty"}`,
      highWatermark: 1,
      issuedAt: localSession.createdAt,
      expiresAt: "2026-10-10T12:00:00.000Z",
    },
    hasMore,
  };
}
function seedDownload() {
  const state = {
    ...structuredClone(baseState),
    captures: [structuredClone(capture)],
  };
  seedState(state);
  useStoma3DStore.setState({ ...state, hydrated: true });
  boundary.mappings = [
    {
      kind: "capture_view",
      localId: capture.id,
      remoteId: "remote-view",
      assetId: "fixture-asset",
      sha256: "fixture-sha",
      byteSize: 3,
      mimeType: "image/jpeg",
      uploaded: true,
      updatedAt: capture.capturedAt,
    },
  ];
  return {
    client: {} as Parameters<typeof materializeRemoteCaptures>[0]["client"],
    state,
    workspaceGeneration: useStoma3DStore.getState().getWorkspaceGeneration(),
  };
}

function seedState(state: PersistedAppState): void {
  boundary.rows = reconcileNormalizedRows(
    [],
    [],
    structuredClone(state),
    localSession.createdAt,
  );
  boundary.state = restorePersistedState(boundary.rows);
  useStoma3DStore.setState({
    ...structuredClone(boundary.state),
    hydrated: true,
  });
}

function analysis(record: CaptureRecord): AnalysisResult {
  return {
    contractVersion: CONTRACT_VERSION,
    captureId: record.id,
    region: record.region,
    quality: record.quality,
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

function seedLocalCapture(): void {
  const record = {
    ...capture,
    encryptedUri: "file:///documents/stoma3d-vault/local.osv",
  };
  seedState({
    ...structuredClone(baseState),
    captures: [record],
    analyses: { [record.id]: analysis(record) },
  });
  boundary.files.add(record.encryptedUri);
  boundary.metadata[syncEntityMetadataKey("capture_view", record.id)] =
    JSON.stringify({
      entityType: "capture_view",
      entityId: record.id,
      hash: "older-fingerprint",
      version: 1,
      deleted: false,
    });
}

beforeEach(async () => {
  vi.resetAllMocks();
  boundary.state = structuredClone(baseState);
  boundary.files.clear();
  boundary.metadata = {};
  boundary.envelopes = {};
  boundary.mappings = [];
  boundary.loadGate = null;
  boundary.loadFailure = false;
  boundary.failNextRead = false;
  boundary.failReadAfterWrite = false;
  boundary.failNextWrite = false;
  boundary.staged = [];
  boundary.uuid = 0;
  useStoma3DStore.setState(
    { ...initialState, ...structuredClone(baseState), hydrated: true },
    true,
  );
  boundary.account.mockResolvedValue(account);
  boundary.pullSync.mockImplementation(async () => page());
  boundary.requestAssetDownload.mockResolvedValue({});
  boundary.download.mockResolvedValue(new Uint8Array([1, 2, 3]));
  boundary.encrypt.mockImplementation(async () => {
    boundary.files.add(downloadedUri);
    return downloadedUri;
  });
  boundary.encryptEntity.mockResolvedValue("fixture-encrypted-payload");
  boundary.removeProtected.mockImplementation(async (uri: string | null) => {
    if (uri) boundary.files.delete(uri);
  });
  boundary.removeTemporary.mockResolvedValue(undefined);
  boundary.createTemporary.mockResolvedValue(
    "file:///cache/stoma3d-capture/download.jpg",
  );
  boundary.stageOutbox.mockImplementation(
    async (
      records: Array<{ payload: string }>,
      updates: Record<string, string | null>,
    ) => {
      boundary.staged.push(
        ...records.map(
          (record) => JSON.parse(record.payload) as SyncOperationInput,
        ),
      );
      Object.assign(boundary.metadata, updates);
    },
  );
  boundary.productSync.mockResolvedValue(productSummary);
  seedState(baseState);
  await useStoma3DStore.getState().hydrate();
});

describe("cloud changes share the local mutation boundary", () => {
  it("preserves settings and a new scan committed while a remote page waits", async () => {
    const remote = deferred<SyncPullResponse>();
    boundary.pullSync.mockReturnValueOnce(remote.promise);
    const operation = runCloudSync().catch((error) => error);
    await flush();
    await useStoma3DStore.getState().updateSettings({ highContrast: true });
    const newSessionId = await useStoma3DStore.getState().startFreshSession();
    remote.resolve(page("remote-scan"));
    const outcome = await operation;
    expect(outcome).not.toBeInstanceOf(Error);
    expect(boundary.state?.settings.highContrast).toBe(true);
    expect(boundary.state?.activeSessionId).toBe(newSessionId);
    expect(boundary.state?.sessions.map((session) => session.id)).toEqual(
      expect.arrayContaining([localSession.id, newSessionId, "remote-scan"]),
    );
  });

  it("rebases every remote page after intervening local commits", async () => {
    const secondPage = deferred<SyncPullResponse>();
    boundary.pullSync
      .mockResolvedValueOnce(page("remote-first", true))
      .mockReturnValueOnce(secondPage.promise);
    const operation = runCloudSync().catch((error) => error);
    await flush();
    await useStoma3DStore.getState().updateSettings({ largeText: true });
    const newSessionId = await useStoma3DStore.getState().startFreshSession();
    secondPage.resolve(page("remote-second"));
    const outcome = await operation;
    expect(outcome).not.toBeInstanceOf(Error);
    expect(boundary.state?.settings.largeText).toBe(true);
    expect(boundary.state?.sessions.map((session) => session.id)).toEqual(
      expect.arrayContaining([
        localSession.id,
        newSessionId,
        "remote-first",
        "remote-second",
      ]),
    );
  });

  it("rejects a remote page from before local reset without staging uploads", async () => {
    const remote = deferred<SyncPullResponse>();
    boundary.pullSync.mockReturnValueOnce(remote.promise);
    const operation = runCloudSync().catch((error) => error);
    await flush();
    await useStoma3DStore.getState().deleteEverything();
    remote.resolve(page("old-remote-scan"));
    const outcome = await operation;
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome.name).toBe("LocalWorkspaceConflictError");
    expect(boundary.state?.sessions).toEqual([]);
    expect(boundary.productSync).not.toHaveBeenCalled();
    expect(boundary.stageOutbox).not.toHaveBeenCalled();
  });

  it("does not stage encrypted operations if local reset happens during encryption", async () => {
    const encryption = deferred<string>();
    boundary.encryptEntity.mockReturnValueOnce(encryption.promise);
    const operation = runCloudSync().catch((error) => error);
    await flush();
    expect(boundary.encryptEntity).toHaveBeenCalled();
    await useStoma3DStore.getState().deleteEverything();
    encryption.resolve("fixture-encrypted-payload");
    const outcome = await operation;
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome.name).toBe("LocalWorkspaceConflictError");
    expect(boundary.stageOutbox).not.toHaveBeenCalled();
    expect(boundary.state?.sessions).toEqual([]);
  });

  it("does not stage a deleted capture when the staging encryption is still pending", async () => {
    seedLocalCapture();
    const encryption = deferred<string>();
    boundary.encryptEntity.mockReturnValueOnce(encryption.promise);
    const operation = runCloudSync().catch((error) => error);
    await flush();
    expect(boundary.encryptEntity).toHaveBeenCalled();
    await useStoma3DStore.getState().discardCapture(capture.id);
    encryption.resolve("fixture-encrypted-payload");
    expect(await operation).toMatchObject({
      name: "CloudError",
      code: "conflict",
      retryable: true,
    });
    expect(boundary.stageOutbox).not.toHaveBeenCalled();
    expect(boundary.state?.captures).toEqual([]);
  });

  it("hydrates cold background state before merging remote changes", async () => {
    boundary.state!.settings.highContrast = true;
    useStoma3DStore.setState(initialState, true);
    boundary.pullSync.mockResolvedValueOnce(page("remote-scan"));
    await expect(runCloudSync()).resolves.toMatchObject({ pulled: 1 });
    expect(boundary.state?.settings.highContrast).toBe(true);
    expect(boundary.state?.sessions.map((session) => session.id)).toEqual(
      expect.arrayContaining([localSession.id, "remote-scan"]),
    );
    expect(useStoma3DStore.getState().hydrated).toBe(true);
  });

  it("fails closed before account calls when cold protected hydration fails", async () => {
    useStoma3DStore.setState(initialState, true);
    boundary.loadFailure = true;
    await expect(runCloudSync()).rejects.toThrow("protected local workspace");
    expect(boundary.account).not.toHaveBeenCalled();
    expect(boundary.pullSync).not.toHaveBeenCalled();
    expect(boundary.stageOutbox).not.toHaveBeenCalled();
    expect(boundary.state?.sessions).toEqual([localSession]);
  });

  it("rejects sync whose workspace is reset while cold hydration waits", async () => {
    useStoma3DStore.setState(initialState, true);
    const hydrate = deferred<void>();
    boundary.loadGate = hydrate.promise;
    const operation = runCloudSync().catch((error) => error);
    await flush();
    const deletion = useStoma3DStore.getState().deleteEverything();
    hydrate.resolve();
    await deletion;
    const outcome = await operation;
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome.name).toBe("LocalWorkspaceConflictError");
    expect(boundary.account).not.toHaveBeenCalled();
    expect(boundary.state?.sessions).toEqual([]);
    expect(boundary.stageOutbox).not.toHaveBeenCalled();
  });

  it("stages a capture tombstone instead of the old capture after product sync waits", async () => {
    seedLocalCapture();
    const product = deferred<typeof productSummary>();
    boundary.productSync.mockReturnValueOnce(product.promise);
    const operation = runCloudSync().catch((error) => error);
    await flush();
    expect(boundary.productSync).toHaveBeenCalled();
    await useStoma3DStore.getState().discardCapture(capture.id);
    product.resolve(productSummary);
    expect(await operation).not.toBeInstanceOf(Error);
    expect(boundary.staged).toContainEqual(
      expect.objectContaining({
        entityType: "capture_view",
        entityId: capture.id,
        operation: "delete",
      }),
    );
    expect(boundary.staged).not.toContainEqual(
      expect.objectContaining({
        entityType: "capture_view",
        entityId: capture.id,
        operation: "upsert",
      }),
    );
  });

  it("stages a new capture and keeps settings committed during product sync", async () => {
    const product = deferred<typeof productSummary>();
    boundary.productSync.mockImplementationOnce(
      async (options: { assertCurrent: () => void }) => {
        await product.promise;
        options.assertCurrent();
        return productSummary;
      },
    );
    const operation = runCloudSync().catch((error) => error);
    await flush();
    expect(boundary.productSync).toHaveBeenCalled();
    await useStoma3DStore.getState().updateSettings({ highContrast: true });
    const record: CaptureRecord = {
      ...capture,
      id: "new-local-photo",
      region: "dorsal_tongue",
      encryptedUri: "file:///documents/stoma3d-vault/new-local.osv",
    };
    boundary.files.add(record.encryptedUri!);
    await useStoma3DStore.getState().addCapture(record, analysis(record));
    product.resolve(productSummary);
    expect(await operation).not.toBeInstanceOf(Error);
    expect(boundary.state?.settings.highContrast).toBe(true);
    expect(boundary.staged).toContainEqual(
      expect.objectContaining({
        entityType: "capture_view",
        entityId: record.id,
        operation: "upsert",
      }),
    );
    expect(boundary.staged).toContainEqual(
      expect.objectContaining({
        entityType: "analysis_run",
        entityId: record.id,
        operation: "upsert",
      }),
    );
  });

  it("cancels subsequent product work when a planned capture was discarded", async () => {
    seedLocalCapture();
    const product = deferred<void>();
    boundary.productSync.mockImplementationOnce(
      async (options: { assertCurrent: () => void }) => {
        await product.promise;
        options.assertCurrent();
        return productSummary;
      },
    );
    const operation = runCloudSync().catch((error) => error);
    await flush();
    await useStoma3DStore.getState().discardCapture(capture.id);
    product.resolve();
    expect(await operation).toMatchObject({
      name: "CloudError",
      code: "conflict",
      retryable: true,
    });
    expect(boundary.stageOutbox).not.toHaveBeenCalled();
  });

  it("does not rematerialize or stage a delayed remote replay of a locally tombstoned capture", async () => {
    const options = seedDownload();
    const remote = deferred<SyncPullResponse>();
    boundary.pullSync.mockReturnValueOnce(remote.promise);
    const operation = runCloudSync().catch((error) => error);
    await flush();
    await useStoma3DStore.getState().discardCapture(capture.id);
    const replay = page();
    const refs = boundary.mappings[0];
    boundary.envelopes[capture.id] = {
      schemaVersion: 1,
      entityType: "capture_view",
      entityId: capture.id,
      record: options.state.captures[0],
      cloudRefs: refs,
    };
    replay.operations = [
      {
        ...page("template").operations[0],
        entityType: "capture_view",
        entityId: capture.id,
      },
    ];
    remote.resolve(replay);
    expect(await operation).not.toBeInstanceOf(Error);
    expect(boundary.rows?.tombstones).toContainEqual(
      expect.objectContaining({
        entityType: "capture_views",
        entityId: capture.id,
      }),
    );
    expect(boundary.state?.captures).toEqual([]);
    expect(useStoma3DStore.getState().captures).toEqual([]);
    expect(boundary.download).not.toHaveBeenCalled();
    expect(boundary.staged).not.toContainEqual(
      expect.objectContaining({
        entityType: "capture_view",
        entityId: capture.id,
        operation: "upsert",
      }),
    );
  });
});

describe("remote capture materialization rebases only its attachment", () => {
  it("preserves new settings and scans committed while the asset downloads", async () => {
    const options = seedDownload();
    options.client = {
      requestAssetDownload: boundary.requestAssetDownload,
    } as typeof options.client;
    const download = deferred<Uint8Array>();
    boundary.download.mockReturnValueOnce(download.promise);
    const operation = materializeRemoteCaptures(options).catch(
      (error) => error,
    );
    await flush();
    await useStoma3DStore.getState().updateSettings({ highContrast: true });
    const newSessionId = await useStoma3DStore.getState().startFreshSession();
    download.resolve(new Uint8Array([1, 2, 3]));
    const outcome = await operation;
    expect(outcome).not.toBeInstanceOf(Error);
    expect(outcome.downloaded).toBe(1);
    expect(outcome.state.settings.highContrast).toBe(true);
    expect(outcome.state.activeSessionId).toBe(newSessionId);
    expect(boundary.state?.captures[0]?.encryptedUri).toBe(downloadedUri);
    expect(boundary.files.has(downloadedUri)).toBe(true);
  });

  it.each(["discarded", "changed", "already_materialized"] as const)(
    "does not overwrite a %s target and removes its unused encrypted download",
    async (change) => {
      const options = seedDownload();
      options.client = {
        requestAssetDownload: boundary.requestAssetDownload,
      } as typeof options.client;
      const download = deferred<Uint8Array>();
      boundary.download.mockReturnValueOnce(download.promise);
      const operation = materializeRemoteCaptures(options).catch(
        (error) => error,
      );
      await flush();
      const replacementUri = "file:///documents/stoma3d-vault/replacement.osv";
      if (change === "discarded")
        await useStoma3DStore.getState().discardCapture(capture.id);
      else {
        if (change === "already_materialized")
          boundary.files.add(replacementUri);
        await useStoma3DStore.getState().applyCloudState(
          (latest) => ({
            ...latest,
            captures: latest.captures.map((value) =>
              value.id === capture.id
                ? {
                    ...value,
                    ...(change === "changed"
                      ? { capturedAt: "2026-10-08T13:00:00.000Z" }
                      : { encryptedUri: replacementUri }),
                  }
                : value,
            ),
          }),
          options.workspaceGeneration,
        );
      }
      const bytes = new Uint8Array([1, 2, 3]);
      download.resolve(bytes);
      const outcome = await operation;
      expect(outcome).not.toBeInstanceOf(Error);
      expect(outcome.downloaded).toBe(0);
      expect(boundary.files.has(downloadedUri)).toBe(false);
      expect(boundary.removeProtected).toHaveBeenCalledWith(downloadedUri);
      expect([...bytes]).toEqual([0, 0, 0]);
      if (change === "discarded") expect(outcome.state.captures).toEqual([]);
      else if (change === "changed")
        expect(outcome.state.captures[0].capturedAt).toBe(
          "2026-10-08T13:00:00.000Z",
        );
      else expect(outcome.state.captures[0].encryptedUri).toBe(replacementUri);
    },
  );

  it("removes a new encrypted orphan when its protected state commit fails", async () => {
    const options = seedDownload();
    options.client = {
      requestAssetDownload: boundary.requestAssetDownload,
    } as typeof options.client;
    boundary.failNextWrite = true;
    await expect(materializeRemoteCaptures(options)).rejects.toThrow(
      "Synced changes could not be saved",
    );
    expect(boundary.state?.captures[0].encryptedUri).toBeNull();
    expect(boundary.files.has(downloadedUri)).toBe(false);
    expect(boundary.removeProtected).toHaveBeenCalledWith(downloadedUri);
    expect(boundary.removeTemporary).toHaveBeenCalled();
  });

  it("preserves possibly committed ciphertext when normalized readback fails", async () => {
    const options = seedDownload();
    options.client = {
      requestAssetDownload: boundary.requestAssetDownload,
    } as typeof options.client;
    const bytes = new Uint8Array([1, 2, 3]);
    boundary.download.mockResolvedValueOnce(bytes);
    boundary.failReadAfterWrite = true;
    await expect(materializeRemoteCaptures(options)).rejects.toMatchObject({
      name: "LocalWorkspaceReloadError",
    });
    expect(boundary.state?.captures[0].encryptedUri).toBe(downloadedUri);
    expect(boundary.files.has(downloadedUri)).toBe(true);
    expect(boundary.removeProtected).not.toHaveBeenCalledWith(downloadedUri);
    expect(boundary.removeTemporary).toHaveBeenCalled();
    expect([...bytes]).toEqual([0, 0, 0]);
    await useStoma3DStore.getState().hydrate();
    expect(useStoma3DStore.getState().captures[0].encryptedUri).toBe(
      downloadedUri,
    );
    expect(boundary.files.has(downloadedUri)).toBe(true);
  });

  it("clears downloaded bytes when temporary-file creation fails", async () => {
    const options = seedDownload();
    options.client = {
      requestAssetDownload: boundary.requestAssetDownload,
    } as typeof options.client;
    const bytes = new Uint8Array([1, 2, 3]);
    boundary.download.mockResolvedValueOnce(bytes);
    boundary.createTemporary.mockRejectedValueOnce(
      new Error("No temporary storage."),
    );
    await expect(materializeRemoteCaptures(options)).rejects.toThrow(
      "No temporary storage",
    );
    expect([...bytes]).toEqual([0, 0, 0]);
    expect(boundary.encrypt).not.toHaveBeenCalled();
  });

  it("rejects attachment after local reset and removes its newly encrypted orphan", async () => {
    const options = seedDownload();
    options.client = {
      requestAssetDownload: boundary.requestAssetDownload,
    } as typeof options.client;
    const encryption = deferred<string>();
    boundary.encrypt.mockImplementationOnce(async () => {
      const uri = await encryption.promise;
      boundary.files.add(uri);
      return uri;
    });
    const operation = materializeRemoteCaptures(options).catch(
      (error) => error,
    );
    await flush();
    await useStoma3DStore.getState().deleteEverything();
    encryption.resolve(downloadedUri);
    const outcome = await operation;
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome.name).toBe("LocalWorkspaceConflictError");
    expect(boundary.state?.captures).toEqual([]);
    expect(boundary.state?.sessions).toEqual([]);
    expect(boundary.files.has(downloadedUri)).toBe(false);
    expect(boundary.removeProtected).toHaveBeenCalledWith(downloadedUri);
  });
});
