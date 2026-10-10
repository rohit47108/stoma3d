import { create } from "zustand";

import {
  clearCloudState,
  cloudMetadata,
  updateCloudMetadata,
} from "@/lib/storage";
import { useStoma3DStore } from "@/store/useStoma3DStore";

import {
  registerCloudBackgroundSync,
  unregisterCloudBackgroundSync,
} from "./background";
import { trackProductEvent } from "./analytics";
import { PlatformClient, newIdempotencyKey } from "./client";
import { cloudConfigurationStatus, readCloudConfig } from "./config";
import type {
  AccessHistoryItem,
  AnalyticsConsent,
  ConsentDocument,
  DeletionResponse,
  GeneratedArtifact,
  JobResponse,
  MeResponse,
  ReportArtifact,
  DataExportArtifact,
  ProductConsent,
  ResourceRef,
  ShareLink,
} from "./contracts";
import { deleteCloudSyncKey, importCloudRecoveryCode } from "./crypto";
import {
  guardUnreceiptedServerDeletion,
  protectRequestedDeletion,
  resumePendingDeletion,
} from "./deletionCoordinator";
import {
  deletionReceiptFromResponse,
  deletionResponseFromReceipt,
  type DeletionPollingReceipt,
} from "./deletionReceipt";
import {
  clearDeletionPollingReceipt,
  persistDeletionPollingReceipt,
  readDeletionPollingReceipt,
} from "./deletionReceiptStorage";
import { isCloudError } from "./errors";
import {
  clearCloudCredentials,
  restoreCloudSession,
  signInToCloud,
  signOutOfCloud,
} from "./session";
import { buildShareUrl } from "./shareUrl";
import { prepareCloudJob, type UserJobType } from "./jobLaunch";
import { syncEntityFingerprint } from "./syncModel";
import { loadProductConsentState } from "./consent";
import {
  clearCloudInstallationIdentity,
  cloudSyncSummary,
  rememberCloudSyncError,
  runCloudSync,
} from "./sync";

export type CloudSessionStatus =
  | "checking"
  | "signed_out"
  | "signing_in"
  | "signed_in"
  | "deletion_pending"
  | "recreation_required"
  | "unavailable";

interface CloudState {
  configured: boolean;
  configurationMessage: string;
  sessionStatus: CloudSessionStatus;
  account: MeResponse | null;
  busy: boolean;
  error: string | null;
  lastSyncAt: string | null;
  pendingOperations: number;
  syncError: string | null;
  recoveryCode: string | null;
  recoveryCodeWasCreated: boolean;
  shares: ShareLink[];
  latestShareUrl: string | null;
  shareUrls: Record<string, string>;
  accessHistory: AccessHistoryItem[];
  jobs: JobResponse[];
  artifacts: Record<string, GeneratedArtifact>;
  reportArtifacts: Record<string, ReportArtifact>;
  dataExports: Record<string, DataExportArtifact>;
  deletion: DeletionResponse | null;
  deletionAccountId: string | null;
  analyticsConsent: AnalyticsConsent | null;
  consentDocument: ConsentDocument | null;
  productConsent: ProductConsent | null;
  bootstrap: () => Promise<void>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  syncNow: (confirmAccountRebind?: boolean) => Promise<void>;
  importRecoveryCode: (value: string) => Promise<void>;
  refreshAccountData: () => Promise<void>;
  recreateAccount: () => Promise<void>;
  createShare: (
    resources: ResourceRef[],
    options?: { expiresInSeconds?: number; maxExchanges?: number },
  ) => Promise<string>;
  revokeShare: (shareId: string) => Promise<void>;
  startJob: (type: UserJobType, localSessionId: string | null) => Promise<void>;
  refreshJob: (jobId: string) => Promise<void>;
  loadArtifact: (artifactId: string) => Promise<void>;
  loadJobOutput: (type: JobResponse["type"], outputId: string) => Promise<void>;
  cancelJob: (jobId: string) => Promise<void>;
  requestCloudDeletion: () => Promise<void>;
  refreshDeletion: () => Promise<void>;
  setAnalyticsOptIn: (enabled: boolean) => Promise<void>;
  acceptProductConsent: () => Promise<void>;
  revokeProductConsent: () => Promise<void>;
  clearError: () => void;
}

function friendlyError(error: unknown): string {
  if (isCloudError(error)) return error.message;
  return error instanceof Error
    ? error.message
    : "The account service could not complete this request.";
}

async function loadRemoteLists(client: PlatformClient) {
  const [shares, history, jobs] = await Promise.allSettled([
    client.listShares(),
    client.accessHistory(),
    client.listJobs(),
  ]);
  return {
    shares: shares.status === "fulfilled" ? shares.value.items : null,
    history: history.status === "fulfilled" ? history.value.items : null,
    jobs: jobs.status === "fulfilled" ? jobs.value.items : null,
  };
}

async function finalizeCompletedDeletion(
  receipt: DeletionPollingReceipt,
): Promise<void> {
  await unregisterCloudBackgroundSync().catch(() => undefined);
  await clearCloudState();
  await deleteCloudSyncKey(receipt.accountId);
  await clearCloudInstallationIdentity(receipt.accountId);
  await useStoma3DStore.getState().updateSettings({ analyticsOptIn: false });
  await clearCloudCredentials();
  // The receipt is deliberately cleared last. If any prior cleanup step fails,
  // the completed receipt keeps the next launch in fail-closed deletion mode.
  await clearDeletionPollingReceipt();
}

async function abandonCloudSession(accountId: string): Promise<void> {
  // Remove the opaque token first so a crash during later cleanup cannot
  // silently enter normal account bootstrap on the next launch.
  await clearCloudCredentials().catch(() => undefined);
  await unregisterCloudBackgroundSync().catch(() => undefined);
  await Promise.allSettled([
    clearCloudState(),
    deleteCloudSyncKey(accountId),
    clearCloudInstallationIdentity(accountId),
  ]);
  // Credential removal must still produce the blocked deletion outcome even
  // when queued local settings cannot be committed.
  await useStoma3DStore
    .getState()
    .updateSettings({ analyticsOptIn: false })
    .catch(() => undefined);
}

function deletionState(
  receipt: DeletionPollingReceipt | null,
  error: string | null,
) {
  return {
    sessionStatus: "deletion_pending" as const,
    account: null,
    deletion: receipt ? deletionResponseFromReceipt(receipt) : null,
    deletionAccountId: receipt?.accountId ?? null,
    error,
    analyticsConsent: null,
    consentDocument: null,
    productConsent: null,
    shares: [],
    accessHistory: [],
    jobs: [],
    artifacts: {},
    reportArtifacts: {},
    dataExports: {},
    shareUrls: {},
    latestShareUrl: null,
    recoveryCode: null,
    recoveryCodeWasCreated: false,
  };
}

function cloudDeletionIsPending(state: Pick<CloudState, "sessionStatus">) {
  return state.sessionStatus === "deletion_pending";
}

const DELETION_MODE_MESSAGE =
  "Cloud deletion is active. Only the deletion status can be checked until cleanup finishes.";

function completedDeletionState(receipt: DeletionPollingReceipt) {
  return {
    ...deletionState(receipt, null),
    sessionStatus: "signed_out" as const,
    deletionAccountId: null,
  };
}

function untrackableDeletionState(error: string) {
  return {
    ...deletionState(null, error),
    sessionStatus: "unavailable" as const,
  };
}

export const useCloudStore = create<CloudState>((set, get) => {
  const configuration = cloudConfigurationStatus();
  // Async local commits can outlive sign-out or deletion. Only the current
  // lifecycle owner may publish the account and consent captured before await.
  let sessionEpoch = 0;
  const ownsSession = (epoch: number) => epoch === sessionEpoch;
  const mayPublishAccount = (epoch: number) =>
    ownsSession(epoch) &&
    !cloudDeletionIsPending(get()) &&
    get().sessionStatus !== "unavailable" &&
    get().sessionStatus !== "recreation_required";
  const abandonAndBlockCloudSession = async (accountId: string) => {
    // The account is already in deletion mode. Do not expose its previous
    // consent or signed-in state while device cleanup waits for local writes.
    sessionEpoch += 1;
    set(
      untrackableDeletionState(
        "Cloud deletion is active without a protected status receipt. Cloud features remain paused during device cleanup.",
      ),
    );
    await abandonCloudSession(accountId);
  };
  return {
    configured: configuration.configured,
    configurationMessage: configuration.message,
    sessionStatus: configuration.configured ? "checking" : "unavailable",
    account: null,
    busy: false,
    error: null,
    lastSyncAt: null,
    pendingOperations: 0,
    syncError: null,
    recoveryCode: null,
    recoveryCodeWasCreated: false,
    shares: [],
    latestShareUrl: null,
    shareUrls: {},
    accessHistory: [],
    jobs: [],
    artifacts: {},
    reportArtifacts: {},
    dataExports: {},
    deletion: null,
    deletionAccountId: null,
    analyticsConsent: null,
    consentDocument: null,
    productConsent: null,

    bootstrap: async () => {
      const epoch = ++sessionEpoch;
      const deletionOutcome = await resumePendingDeletion({
        readReceipt: async () => {
          const read = await readDeletionPollingReceipt();
          if (read.kind !== "missing") {
            sessionEpoch += 1;
            // Finalization can await the local mutation queue. Block normal
            // cloud work as soon as a protected receipt is discovered.
            set(
              deletionState(
                read.kind === "present" ? read.receipt : null,
                null,
              ),
            );
          }
          return read;
        },
        pollStatus: (requestId) =>
          new PlatformClient().deletionStatus(requestId),
        persistReceipt: persistDeletionPollingReceipt,
        finalizeCompleted: finalizeCompletedDeletion,
      });
      if (deletionOutcome.mode !== "normal") {
        set(
          deletionOutcome.mode === "deletion_completed"
            ? completedDeletionState(deletionOutcome.receipt)
            : deletionState(deletionOutcome.receipt, deletionOutcome.error),
        );
        await unregisterCloudBackgroundSync().catch(() => undefined);
        if (deletionOutcome.mode === "deletion_pending") {
          try {
            await useStoma3DStore
              .getState()
              .updateSettings({ analyticsOptIn: false });
          } catch (error) {
            set({ error: deletionOutcome.error ?? friendlyError(error) });
          }
        }
        return;
      }
      if (!ownsSession(epoch)) return;
      if (!configuration.configured) {
        set({ sessionStatus: "unavailable" });
        return;
      }
      if (!mayPublishAccount(epoch)) return;
      try {
        const restored = await restoreCloudSession();
        if (!mayPublishAccount(epoch)) return;
        if (!restored) {
          set({ sessionStatus: "signed_out" });
          return;
        }
        const client = new PlatformClient();
        const account = await client.account();
        if (!mayPublishAccount(epoch)) return;
        const deletionGuard = await guardUnreceiptedServerDeletion(
          account,
          abandonAndBlockCloudSession,
        );
        if (deletionGuard.kind === "blocked") {
          set({
            ...untrackableDeletionState(deletionGuard.error),
            busy: false,
          });
          return;
        }
        if (!mayPublishAccount(epoch)) return;
        const [
          summary,
          storedShareUrls,
          analyticsConsent,
          productConsentState,
        ] = await Promise.all([
          cloudSyncSummary(),
          cloudMetadata("cloud.share_url."),
          client.analyticsConsent(),
          loadProductConsentState(client),
        ]);
        if (!mayPublishAccount(epoch)) return;
        const cloudWorkEnabled = !account.deletionPending;
        await useStoma3DStore.getState().updateSettings({
          analyticsOptIn: cloudWorkEnabled && analyticsConsent.enabled,
        });
        if (!mayPublishAccount(epoch)) return;
        set({
          account,
          analyticsConsent,
          consentDocument: productConsentState.document,
          productConsent: cloudWorkEnabled
            ? productConsentState.activeConsent
            : null,
          sessionStatus: "signed_in",
          lastSyncAt: summary.lastSyncAt,
          pendingOperations: summary.pending,
          syncError: summary.lastError,
          shareUrls: Object.fromEntries(
            Object.entries(storedShareUrls).flatMap(([key, value]) =>
              value
                ? [[key.slice("cloud.share_url.".length), value] as const]
                : [],
            ),
          ),
        });
        if (cloudWorkEnabled && productConsentState.activeConsent) {
          await registerCloudBackgroundSync().catch(() => undefined);
          if (!mayPublishAccount(epoch)) return;
        }
        void trackProductEvent({
          name: "app_opened",
          surface: "app",
          outcome: "viewed",
        });
        if (cloudWorkEnabled && productConsentState.activeConsent)
          await get().syncNow();
      } catch (error) {
        if (!mayPublishAccount(epoch)) return;
        if (isCloudError(error) && error.code === "unauthenticated") {
          await clearCloudCredentials().catch(() => undefined);
          if (!mayPublishAccount(epoch)) return;
          set({ sessionStatus: "signed_out", account: null });
          return;
        }
        if (isCloudError(error) && error.code === "recreation_required") {
          set({
            sessionStatus: "recreation_required",
            account: null,
            error: error.message,
          });
          return;
        }
        const summary = await cloudSyncSummary().catch(() => null);
        if (!mayPublishAccount(epoch)) return;
        set({
          sessionStatus: "signed_in",
          error: friendlyError(error),
          ...(summary
            ? {
                lastSyncAt: summary.lastSyncAt,
                pendingOperations: summary.pending,
                syncError: summary.lastError,
              }
            : {}),
        });
      }
    },

    signIn: async () => {
      if (!get().configured || get().sessionStatus === "unavailable") return;
      if (cloudDeletionIsPending(get())) {
        set({ error: DELETION_MODE_MESSAGE });
        return;
      }
      const epoch = ++sessionEpoch;
      set({ busy: true, error: null, sessionStatus: "signing_in" });
      let authenticated = false;
      try {
        await signInToCloud();
        authenticated = true;
        if (!mayPublishAccount(epoch)) return;
        const client = new PlatformClient();
        const account = await client.account();
        if (!mayPublishAccount(epoch)) return;
        const deletionGuard = await guardUnreceiptedServerDeletion(
          account,
          abandonAndBlockCloudSession,
        );
        if (deletionGuard.kind === "blocked") {
          set({
            ...untrackableDeletionState(deletionGuard.error),
            busy: false,
          });
          return;
        }
        if (!mayPublishAccount(epoch)) return;
        const [analyticsConsent, productConsentState] = await Promise.all([
          client.analyticsConsent(),
          loadProductConsentState(client),
        ]);
        if (!mayPublishAccount(epoch)) return;
        const cloudWorkEnabled = !account.deletionPending;
        await useStoma3DStore.getState().updateSettings({
          analyticsOptIn: cloudWorkEnabled && analyticsConsent.enabled,
        });
        if (!mayPublishAccount(epoch)) return;
        set({
          account,
          analyticsConsent,
          consentDocument: productConsentState.document,
          productConsent: cloudWorkEnabled
            ? productConsentState.activeConsent
            : null,
          sessionStatus: "signed_in",
        });
        if (cloudWorkEnabled && productConsentState.activeConsent) {
          await registerCloudBackgroundSync().catch(() => undefined);
          if (!mayPublishAccount(epoch)) return;
          await get().syncNow();
          if (!mayPublishAccount(epoch)) return;
        }
        await get().refreshAccountData();
      } catch (error) {
        if (!mayPublishAccount(epoch)) return;
        const sessionRejected =
          isCloudError(error) && error.code === "unauthenticated";
        if (isCloudError(error) && error.code === "recreation_required") {
          set({
            sessionStatus: "recreation_required",
            account: null,
            error: error.message,
          });
          return;
        }
        if (authenticated && !sessionRejected) {
          set({
            sessionStatus: "signed_in",
            account: null,
            error: friendlyError(error),
          });
          return;
        }
        if (authenticated) {
          await clearCloudCredentials().catch(() => undefined);
          if (!mayPublishAccount(epoch)) return;
        }
        set({
          sessionStatus: "signed_out",
          account: null,
          error: friendlyError(error),
        });
      } finally {
        if (ownsSession(epoch)) set({ busy: false });
      }
    },

    signOut: async () => {
      if (cloudDeletionIsPending(get())) {
        set({ error: DELETION_MODE_MESSAGE });
        return;
      }
      const epoch = ++sessionEpoch;
      set({ busy: true, error: null });
      try {
        await unregisterCloudBackgroundSync().catch(() => undefined);
        if (!ownsSession(epoch)) return;
        await signOutOfCloud();
        if (!ownsSession(epoch)) return;
        set({
          sessionStatus: "signed_out",
          account: null,
          shares: [],
          accessHistory: [],
          jobs: [],
          artifacts: {},
          reportArtifacts: {},
          dataExports: {},
          latestShareUrl: null,
          shareUrls: {},
          recoveryCode: null,
          recoveryCodeWasCreated: false,
          deletion: null,
          deletionAccountId: null,
          analyticsConsent: null,
          consentDocument: null,
          productConsent: null,
        });
        await useStoma3DStore
          .getState()
          .updateSettings({ analyticsOptIn: false });
      } catch (error) {
        if (ownsSession(epoch)) set({ error: friendlyError(error) });
      } finally {
        if (ownsSession(epoch)) set({ busy: false });
      }
    },

    recreateAccount: async () => {
      if (get().sessionStatus !== "recreation_required") return;
      const epoch = ++sessionEpoch;
      set({ busy: true, error: null });
      try {
        const response = await new PlatformClient().recreateAccount();
        if (!ownsSession(epoch) || cloudDeletionIsPending(get())) return;
        set({
          account: response.account,
          sessionStatus: "signed_in",
          error: null,
        });
        await get().refreshAccountData();
      } catch (error) {
        if (ownsSession(epoch)) set({ error: friendlyError(error) });
      } finally {
        if (ownsSession(epoch)) set({ busy: false });
      }
    },

    syncNow: async (confirmAccountRebind = false) => {
      if (get().sessionStatus !== "signed_in") return;
      if (!get().productConsent) {
        set({
          error:
            "Review and accept the current cloud consent before syncing health records.",
          syncError: "Cloud consent is required before sync.",
        });
        return;
      }
      set({ busy: true, error: null, syncError: null });
      try {
        const result = await runCloudSync(new PlatformClient(), {
          confirmAccountRebind,
        });
        set({
          lastSyncAt: result.completedAt,
          pendingOperations: result.pending,
          recoveryCode: result.recoveryCode,
          recoveryCodeWasCreated: result.recoveryCodeWasCreated,
        });
      } catch (error) {
        await rememberCloudSyncError(error).catch(() => undefined);
        const summary = await cloudSyncSummary().catch(() => null);
        set({
          error: friendlyError(error),
          syncError: friendlyError(error),
          ...(summary ? { pendingOperations: summary.pending } : {}),
        });
      } finally {
        set({ busy: false });
      }
    },

    importRecoveryCode: async (value) => {
      const account = get().account;
      if (!account) throw new Error("Sign in before restoring a sync key.");
      set({ busy: true, error: null, syncError: null });
      try {
        const material = await importCloudRecoveryCode(account.id, value);
        await updateCloudMetadata({ "cloud.cursor": null });
        set({
          recoveryCode: material.recoveryCode,
          recoveryCodeWasCreated: false,
        });
        await get().syncNow();
      } catch (error) {
        set({ error: friendlyError(error), syncError: friendlyError(error) });
        throw error;
      } finally {
        set({ busy: false });
      }
    },

    refreshAccountData: async () => {
      if (get().sessionStatus !== "signed_in") return;
      const epoch = sessionEpoch;
      set({ busy: true, error: null });
      try {
        const client = new PlatformClient();
        const account = await client.account();
        if (!mayPublishAccount(epoch)) return;
        const deletionGuard = await guardUnreceiptedServerDeletion(
          account,
          abandonAndBlockCloudSession,
        );
        if (deletionGuard.kind === "blocked") {
          set({
            ...untrackableDeletionState(deletionGuard.error),
            busy: false,
          });
          return;
        }
        if (!mayPublishAccount(epoch)) return;
        const [lists, analyticsConsent, productConsentState] =
          await Promise.all([
            loadRemoteLists(client),
            client.analyticsConsent(),
            loadProductConsentState(client),
          ]);
        if (!mayPublishAccount(epoch)) return;
        const cloudWorkEnabled = !account.deletionPending;
        await useStoma3DStore.getState().updateSettings({
          analyticsOptIn: cloudWorkEnabled && analyticsConsent.enabled,
        });
        if (!mayPublishAccount(epoch)) return;
        set({
          account,
          analyticsConsent,
          consentDocument: productConsentState.document,
          productConsent: cloudWorkEnabled
            ? productConsentState.activeConsent
            : null,
          ...(lists.shares ? { shares: lists.shares } : {}),
          ...(lists.history ? { accessHistory: lists.history } : {}),
          ...(lists.jobs ? { jobs: lists.jobs } : {}),
        });
      } catch (error) {
        if (mayPublishAccount(epoch)) set({ error: friendlyError(error) });
      } finally {
        if (ownsSession(epoch)) set({ busy: false });
      }
    },

    createShare: async (resources, options = {}) => {
      if (resources.length === 0) throw new Error("Choose something to share.");
      if (!get().productConsent || get().account?.deletionPending) {
        throw new Error(
          "Cloud consent is required and account deletion must be inactive before sharing.",
        );
      }
      set({ busy: true, error: null, latestShareUrl: null });
      try {
        const client = new PlatformClient();
        const response = await client.createShare(
          resources,
          options,
          newIdempotencyKey("share"),
        );
        const config = readCloudConfig();
        if (!config) throw new Error("Share links are not configured.");
        const url = buildShareUrl(config.shareViewerBaseUrl, response);
        await updateCloudMetadata({
          [`cloud.share_url.${response.share.shareId}`]: url,
        });
        set((state) => ({
          latestShareUrl: url,
          shareUrls: {
            ...state.shareUrls,
            [response.share.shareId]: url,
          },
          shares: [
            response.share,
            ...state.shares.filter(
              (share) => share.shareId !== response.share.shareId,
            ),
          ],
        }));
        void trackProductEvent({
          name: "share_created",
          surface: "sharing",
          outcome: "shared",
        });
        return url;
      } catch (error) {
        set({ error: friendlyError(error) });
        throw error;
      } finally {
        set({ busy: false });
      }
    },

    revokeShare: async (shareId) => {
      if (cloudDeletionIsPending(get())) {
        set({ error: DELETION_MODE_MESSAGE });
        return;
      }
      set({ busy: true, error: null });
      try {
        const share = await new PlatformClient().revokeShare(
          shareId,
          newIdempotencyKey(`share-revoke:${shareId}`),
        );
        await updateCloudMetadata({ [`cloud.share_url.${shareId}`]: null });
        set((state) => ({
          shares: state.shares.map((value) =>
            value.shareId === shareId ? share : value,
          ),
          latestShareUrl: null,
          shareUrls: Object.fromEntries(
            Object.entries(state.shareUrls).filter(([id]) => id !== shareId),
          ),
        }));
        void trackProductEvent({
          name: "share_revoked",
          surface: "sharing",
          outcome: "revoked",
        });
      } catch (error) {
        set({ error: friendlyError(error) });
      } finally {
        set({ busy: false });
      }
    },

    startJob: async (type, localSessionId) => {
      if (!get().productConsent || get().account?.deletionPending) {
        throw new Error(
          "Cloud consent is required and account deletion must be inactive before processing.",
        );
      }
      set({ busy: true, error: null });
      try {
        const client = new PlatformClient();
        const prepared = await prepareCloudJob(
          type,
          localSessionId,
          get().jobs,
          client,
        );
        const key = `job:${type}:${syncEntityFingerprint(prepared.payload).slice(0, 48)}`;
        const job = await client.createJob(
          type,
          prepared.payload,
          key,
          prepared.inputRefs,
        );
        set((state) => ({
          jobs: [
            job,
            ...state.jobs.filter((value) => value.jobId !== job.jobId),
          ],
        }));
      } catch (error) {
        set({ error: friendlyError(error) });
        throw error;
      } finally {
        set({ busy: false });
      }
    },

    refreshJob: async (jobId) => {
      if (cloudDeletionIsPending(get())) {
        set({ error: DELETION_MODE_MESSAGE });
        return;
      }
      try {
        const job = await new PlatformClient().job(jobId);
        set((state) => ({
          jobs: [job, ...state.jobs.filter((value) => value.jobId !== jobId)],
        }));
      } catch (error) {
        set({ error: friendlyError(error) });
      }
    },

    loadArtifact: async (artifactId) => {
      if (cloudDeletionIsPending(get())) {
        set({ error: DELETION_MODE_MESSAGE });
        return;
      }
      try {
        const artifact = await new PlatformClient().generatedArtifact(
          artifactId,
        );
        set((state) => ({
          artifacts: { ...state.artifacts, [artifactId]: artifact },
        }));
      } catch (error) {
        set({ error: friendlyError(error) });
      }
    },

    loadJobOutput: async (type, outputId) => {
      if (cloudDeletionIsPending(get())) {
        set({ error: DELETION_MODE_MESSAGE });
        return;
      }
      try {
        const client = new PlatformClient();
        if (type === "report") {
          const artifact = await client.report(outputId);
          set((state) => ({
            reportArtifacts: {
              ...state.reportArtifacts,
              [outputId]: artifact,
            },
          }));
          return;
        }
        if (type === "data_export") {
          const artifact = await client.dataExport(outputId);
          set((state) => ({
            dataExports: { ...state.dataExports, [outputId]: artifact },
          }));
          return;
        }
        await get().loadArtifact(outputId);
      } catch (error) {
        set({ error: friendlyError(error) });
      }
    },

    cancelJob: async (jobId) => {
      if (cloudDeletionIsPending(get())) {
        set({ error: DELETION_MODE_MESSAGE });
        return;
      }
      try {
        const job = await new PlatformClient().cancelJob(
          jobId,
          newIdempotencyKey(`job-cancel:${jobId}`),
        );
        set((state) => ({
          jobs: [job, ...state.jobs.filter((value) => value.jobId !== jobId)],
        }));
      } catch (error) {
        set({ error: friendlyError(error) });
      }
    },

    requestCloudDeletion: async () => {
      if (cloudDeletionIsPending(get())) {
        set({ error: DELETION_MODE_MESSAGE });
        return;
      }
      const account = get().account;
      if (get().sessionStatus !== "signed_in" || !account) {
        throw new Error(
          "Refresh the signed-in account before requesting cloud deletion.",
        );
      }
      let epoch = ++sessionEpoch;
      set({ busy: true, error: null });
      let requestedReceipt: DeletionPollingReceipt | null = null;
      try {
        const deletion = await new PlatformClient().requestAccountDeletion(
          newIdempotencyKey("account-delete"),
        );
        const protection = await protectRequestedDeletion({
          accountId: account.id,
          response: deletion,
          persistReceipt: persistDeletionPollingReceipt,
          abandonUntrackableDeletion: () =>
            abandonAndBlockCloudSession(account.id),
        });
        if (protection.kind === "untrackable") {
          set({ ...untrackableDeletionState(protection.error), busy: false });
          return;
        }
        requestedReceipt = protection.receipt;
        epoch = ++sessionEpoch;
        set(deletionState(requestedReceipt, null));
        await unregisterCloudBackgroundSync().catch(() => undefined);
        await useStoma3DStore
          .getState()
          .updateSettings({ analyticsOptIn: false });
        const cleanup = await Promise.allSettled([
          clearCloudState(),
          deleteCloudSyncKey(account.id),
          clearCloudInstallationIdentity(account.id),
        ]);
        if (cleanup.some((result) => result.status === "rejected")) {
          set({
            error:
              "Cloud deletion started, but one or more device-side cloud keys still need cleanup. Keep this app installed and refresh the deletion status.",
          });
        }
        if (requestedReceipt.status === "completed") {
          try {
            await finalizeCompletedDeletion(requestedReceipt);
            set(completedDeletionState(requestedReceipt));
          } catch {
            set(
              deletionState(
                requestedReceipt,
                "Cloud data was deleted, but protected device cleanup is incomplete. Retry the status check.",
              ),
            );
          }
        }
      } catch (error) {
        if (requestedReceipt && ownsSession(epoch)) {
          set(
            deletionState(
              requestedReceipt,
              "Cloud deletion started and its protected receipt was saved, but device cleanup did not finish. Retry the status check and keep the app installed.",
            ),
          );
          await unregisterCloudBackgroundSync().catch(() => undefined);
          await useStoma3DStore
            .getState()
            .updateSettings({ analyticsOptIn: false })
            .catch(() => undefined);
        } else if (ownsSession(epoch)) {
          set({ error: friendlyError(error) });
        }
        throw error;
      } finally {
        if (ownsSession(epoch)) set({ busy: false });
      }
    },

    refreshDeletion: async () => {
      if (!cloudDeletionIsPending(get()) && !get().deletion) return;
      sessionEpoch += 1;
      set({ busy: true, error: null });
      try {
        const outcome = await resumePendingDeletion({
          readReceipt: async () => {
            const read = await readDeletionPollingReceipt();
            const deletion = get().deletion;
            const accountId = get().deletionAccountId;
            if (read.kind !== "missing" || !deletion || !accountId) {
              return read;
            }
            const recovered = deletionReceiptFromResponse(accountId, deletion);
            await persistDeletionPollingReceipt(recovered);
            return { kind: "present" as const, receipt: recovered };
          },
          pollStatus: (requestId) =>
            new PlatformClient().deletionStatus(requestId),
          persistReceipt: persistDeletionPollingReceipt,
          finalizeCompleted: finalizeCompletedDeletion,
        });
        if (outcome.mode === "normal") {
          set({
            error:
              "No protected deletion receipt is available. Cloud features remain paused to prevent account recreation.",
          });
          return;
        }
        set(
          outcome.mode === "deletion_completed"
            ? completedDeletionState(outcome.receipt)
            : deletionState(outcome.receipt, outcome.error),
        );
      } finally {
        set({ busy: false });
      }
    },

    setAnalyticsOptIn: async (enabled) => {
      const epoch = sessionEpoch;
      set({ busy: true, error: null });
      try {
        if (get().sessionStatus !== "signed_in") {
          if (enabled) {
            throw new Error(
              "Sign in before enabling limited product analytics.",
            );
          }
          await useStoma3DStore
            .getState()
            .updateSettings({ analyticsOptIn: false });
          if (!ownsSession(epoch)) return;
          set({ analyticsConsent: null });
          return;
        }
        if (enabled && get().account?.deletionPending) {
          throw new Error(
            "Product analytics cannot be enabled while cloud deletion is pending.",
          );
        }
        const consent = await new PlatformClient().updateAnalyticsConsent(
          enabled,
        );
        if (!mayPublishAccount(epoch)) return;
        await useStoma3DStore.getState().updateSettings({
          analyticsOptIn: consent.enabled,
        });
        if (!mayPublishAccount(epoch)) return;
        set({ analyticsConsent: consent });
      } catch (error) {
        if (ownsSession(epoch)) set({ error: friendlyError(error) });
        throw error;
      } finally {
        if (ownsSession(epoch)) set({ busy: false });
      }
    },

    acceptProductConsent: async () => {
      const document = get().consentDocument;
      if (!document || get().sessionStatus !== "signed_in") {
        throw new Error("Sign in and load the current cloud consent first.");
      }
      if (get().account?.deletionPending) {
        throw new Error(
          "Cloud features cannot be enabled while deletion is pending.",
        );
      }
      set({ busy: true, error: null });
      try {
        const consent = await new PlatformClient().createProductConsent(
          document,
          `consent:${document.documentSha256.slice(0, 48)}`,
        );
        set({ productConsent: consent });
        await registerCloudBackgroundSync().catch(() => undefined);
        await get().syncNow();
      } catch (error) {
        set({ error: friendlyError(error) });
        throw error;
      } finally {
        set({ busy: false });
      }
    },

    revokeProductConsent: async () => {
      const consent = get().productConsent;
      if (!consent) return;
      set({ busy: true, error: null });
      try {
        const revoked = await new PlatformClient().revokeProductConsent(
          consent.consentRecordId,
          newIdempotencyKey(`consent-revoke:${consent.consentRecordId}`),
        );
        await unregisterCloudBackgroundSync().catch(() => undefined);
        set({ productConsent: revoked.active ? revoked : null });
      } catch (error) {
        set({ error: friendlyError(error) });
        throw error;
      } finally {
        set({ busy: false });
      }
    },

    clearError: () => set({ error: null }),
  };
});
