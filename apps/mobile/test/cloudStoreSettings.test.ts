import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse, ProductConsent } from "../src/cloud/contracts";
import type { DeletionPollingReceipt } from "../src/cloud/deletionReceipt";

const boundary = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  account: vi.fn(),
  analyticsConsent: vi.fn(),
  updateAnalyticsConsent: vi.fn(),
  requestDeletion: vi.fn(),
  pollDeletion: vi.fn(),
  readReceipt: vi.fn(),
  persistReceipt: vi.fn(),
  clearReceipt: vi.fn(),
  restoreSession: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  clearCredentials: vi.fn(),
  registerBackground: vi.fn(),
  unregisterBackground: vi.fn(),
  clearCloudState: vi.fn(),
  deleteKey: vi.fn(),
  clearInstallation: vi.fn(),
  productConsentState: vi.fn(),
  receipt: null as DeletionPollingReceipt | null,
}));

vi.mock("@/lib/storage", () => ({
  clearCloudState: boundary.clearCloudState,
  cloudMetadata: async () => ({}),
  updateCloudMetadata: async () => undefined,
}));
vi.mock("@/store/useStoma3DStore", () => ({
  useStoma3DStore: {
    getState: () => ({ updateSettings: boundary.updateSettings }),
  },
}));
vi.mock("../src/cloud/background", () => ({
  registerCloudBackgroundSync: boundary.registerBackground,
  unregisterCloudBackgroundSync: boundary.unregisterBackground,
}));
vi.mock("../src/cloud/analytics", () => ({
  trackProductEvent: async () => false,
}));
vi.mock("../src/cloud/client", () => ({
  PlatformClient: class {
    account = boundary.account;
    analyticsConsent = boundary.analyticsConsent;
    updateAnalyticsConsent = boundary.updateAnalyticsConsent;
    requestAccountDeletion = boundary.requestDeletion;
    deletionStatus = boundary.pollDeletion;
    listShares = async () => ({ items: [] });
    accessHistory = async () => ({ items: [] });
    listJobs = async () => ({ items: [] });
  },
  newIdempotencyKey: () => "fixture-key",
}));
vi.mock("../src/cloud/config", () => ({
  cloudConfigurationStatus: () => ({ configured: true, message: "Configured" }),
  readCloudConfig: () => ({}),
}));
vi.mock("../src/cloud/crypto", () => ({
  deleteCloudSyncKey: boundary.deleteKey,
  importCloudRecoveryCode: vi.fn(),
}));
vi.mock("../src/cloud/deletionReceiptStorage", () => ({
  clearDeletionPollingReceipt: boundary.clearReceipt,
  persistDeletionPollingReceipt: boundary.persistReceipt,
  readDeletionPollingReceipt: boundary.readReceipt,
}));
vi.mock("../src/cloud/session", () => ({
  clearCloudCredentials: boundary.clearCredentials,
  restoreCloudSession: boundary.restoreSession,
  signInToCloud: boundary.signIn,
  signOutOfCloud: boundary.signOut,
}));
vi.mock("../src/cloud/jobLaunch", () => ({ prepareCloudJob: vi.fn() }));
vi.mock("../src/cloud/consent", () => ({
  loadProductConsentState: boundary.productConsentState,
}));
vi.mock("../src/cloud/sync", () => ({
  clearCloudInstallationIdentity: boundary.clearInstallation,
  cloudSyncSummary: async () => ({
    lastSyncAt: null,
    pending: 0,
    lastError: null,
  }),
  rememberCloudSyncError: async () => undefined,
  runCloudSync: vi.fn(),
}));

import { useCloudStore } from "../src/cloud/useCloudStore";

const account: MeResponse = {
  id: "account-1",
  role: "patient",
  status: "active",
  createdAt: "2026-10-05T12:00:00.000Z",
  deletionPending: false,
  requiredOidcRole: null,
  privilegedAccessReady: true,
  clinicianApplicationEligible: false,
};
const consent = { enabled: true, policyVersion: "fixture", updatedAt: null };
const initialState = useCloudStore.getState();
const requestedReceipt: DeletionPollingReceipt = {
  accountId: account.id,
  requestId: "request-1",
  jobId: "job-1",
  status: "requested",
  requestedAt: "2026-10-05T12:00:00.000Z",
  startedAt: null,
  completedAt: null,
  errorCode: null,
};
const deletionResponse = ({
  accountId: _accountId,
  ...response
}: DeletionPollingReceipt) => response;
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function handledFailure(message = "The local settings could not be saved.") {
  const error = new Error(message);
  const promise = Promise.reject(error);
  // Let the RED run expose missing awaiting without causing an unrelated
  // unhandled-rejection failure in the test runner.
  void promise.catch(() => undefined);
  return { error, promise };
}

beforeEach(() => {
  vi.resetAllMocks();
  boundary.receipt = null;
  useCloudStore.setState(initialState, true);
  boundary.updateSettings.mockResolvedValue(undefined);
  boundary.account.mockResolvedValue(account);
  boundary.analyticsConsent.mockResolvedValue(consent);
  boundary.updateAnalyticsConsent.mockResolvedValue(consent);
  boundary.restoreSession.mockResolvedValue({});
  boundary.productConsentState.mockResolvedValue({
    document: null,
    activeConsent: null,
  });
  for (const effect of [
    boundary.signIn,
    boundary.signOut,
    boundary.clearCredentials,
    boundary.registerBackground,
    boundary.unregisterBackground,
    boundary.clearCloudState,
    boundary.deleteKey,
    boundary.clearInstallation,
  ])
    effect.mockResolvedValue(undefined);
  boundary.readReceipt.mockImplementation(async () =>
    boundary.receipt
      ? { kind: "present", receipt: boundary.receipt }
      : { kind: "missing" },
  );
  boundary.persistReceipt.mockImplementation(
    async (receipt: DeletionPollingReceipt) => {
      boundary.receipt = receipt;
    },
  );
  boundary.clearReceipt.mockImplementation(async () => {
    boundary.receipt = null;
  });
  boundary.requestDeletion.mockResolvedValue(
    deletionResponse(requestedReceipt),
  );
  boundary.pollDeletion.mockResolvedValue(deletionResponse(requestedReceipt));
});

describe("queued local settings in cloud flows", () => {
  it.each([
    ["bootstrap", "requestCloudDeletion"],
    ["refreshAccountData", "requestCloudDeletion"],
    ["bootstrap", "signOut"],
    ["signIn", "signOut"],
    ["refreshAccountData", "signOut"],
  ] as const)(
    "does not republish stale %s account or consent after %s takes ownership",
    async (normalMethod, terminalMethod) => {
      const activeConsent = {
        consentRecordId: "fixture-consent",
      } as ProductConsent;
      useCloudStore.setState({
        sessionStatus: "signed_in",
        account,
        productConsent: activeConsent,
      });
      boundary.productConsentState.mockResolvedValue({
        document: null,
        activeConsent,
      });
      const commit = deferred();
      boundary.updateSettings.mockReturnValueOnce(commit.promise);
      const normal = useCloudStore.getState()[normalMethod]();
      await flush();
      const terminal = useCloudStore.getState()[terminalMethod]();
      await flush();
      commit.resolve();
      await Promise.all([normal, terminal]);
      expect(useCloudStore.getState().sessionStatus).toBe(
        terminalMethod === "requestCloudDeletion"
          ? "deletion_pending"
          : "signed_out",
      );
      expect(useCloudStore.getState().account).toBeNull();
      expect(useCloudStore.getState().productConsent).toBeNull();
      expect(useCloudStore.getState().analyticsConsent).toBeNull();
      expect(boundary.registerBackground).not.toHaveBeenCalled();
      expect(useCloudStore.getState().busy).toBe(false);
    },
  );

  it.each(["requestCloudDeletion", "signOut"] as const)(
    "does not republish queued analytics consent after %s takes ownership",
    async (terminalMethod) => {
      useCloudStore.setState({ sessionStatus: "signed_in", account });
      const commit = deferred();
      boundary.updateSettings.mockReturnValueOnce(commit.promise);
      const analytics = useCloudStore.getState().setAnalyticsOptIn(true);
      await flush();
      const terminal = useCloudStore.getState()[terminalMethod]();
      await flush();
      commit.resolve();
      await Promise.all([analytics, terminal]);
      expect(useCloudStore.getState().sessionStatus).toBe(
        terminalMethod === "requestCloudDeletion"
          ? "deletion_pending"
          : "signed_out",
      );
      expect(useCloudStore.getState().account).toBeNull();
      expect(useCloudStore.getState().analyticsConsent).toBeNull();
    },
  );

  it.each([
    "bootstrap",
    "signIn",
    "refreshAccountData",
    "setAnalyticsOptIn",
  ] as const)(
    "waits for local settings before publishing %s consent",
    async (method) => {
      if (method === "refreshAccountData" || method === "setAnalyticsOptIn")
        useCloudStore.setState({ sessionStatus: "signed_in", account });
      const commit = deferred();
      boundary.updateSettings.mockReturnValueOnce(commit.promise);
      let finished = false;
      const operation =
        method === "setAnalyticsOptIn"
          ? useCloudStore.getState()[method](true)
          : useCloudStore.getState()[method]();
      const pending = operation.then(() => {
        finished = true;
      });
      await flush();
      const publishedBeforeCommit = useCloudStore.getState().analyticsConsent;
      const finishedBeforeCommit = finished;
      commit.resolve();
      await pending;
      expect(publishedBeforeCommit).toBeNull();
      expect(finishedBeforeCommit).toBe(false);
      expect(useCloudStore.getState().analyticsConsent).toEqual(consent);
    },
  );

  it("reports rejected local analytics persistence without publishing remote consent", async () => {
    useCloudStore.setState({ sessionStatus: "signed_in", account });
    const failure = handledFailure();
    boundary.updateSettings.mockReturnValueOnce(failure.promise);
    const outcome = await useCloudStore
      .getState()
      .setAnalyticsOptIn(true)
      .catch((error) => error);
    expect(outcome).toBe(failure.error);
    expect(useCloudStore.getState().analyticsConsent).toBeNull();
    expect(useCloudStore.getState().error).toBe(failure.error.message);
    expect(useCloudStore.getState().busy).toBe(false);
  });

  it.each(["bootstrap", "signIn", "refreshAccountData"] as const)(
    "reports rejected settings in %s without publishing remote consent",
    async (method) => {
      if (method === "refreshAccountData")
        useCloudStore.setState({ sessionStatus: "signed_in", account });
      const failure = handledFailure();
      boundary.updateSettings.mockReturnValueOnce(failure.promise);
      await useCloudStore.getState()[method]();
      expect(useCloudStore.getState().analyticsConsent).toBeNull();
      expect(useCloudStore.getState().error).toBe(failure.error.message);
      expect(useCloudStore.getState().busy).toBe(false);
    },
  );

  it("waits for settings before publishing signed-out analytics cleanup", async () => {
    useCloudStore.setState({
      sessionStatus: "signed_out",
      analyticsConsent: consent,
    });
    const commit = deferred();
    boundary.updateSettings.mockReturnValueOnce(commit.promise);
    let finished = false;
    const operation = useCloudStore
      .getState()
      .setAnalyticsOptIn(false)
      .then(() => {
        finished = true;
      });
    await flush();
    const consentBeforeCommit = useCloudStore.getState().analyticsConsent;
    const finishedBeforeCommit = finished;
    commit.resolve();
    await operation;
    expect(consentBeforeCommit).toEqual(consent);
    expect(finishedBeforeCommit).toBe(false);
    expect(useCloudStore.getState().analyticsConsent).toBeNull();
  });

  it("retains the completed deletion receipt until local settings finish", async () => {
    useCloudStore.setState({
      sessionStatus: "signed_in",
      account,
      productConsent: {} as ProductConsent,
    });
    boundary.receipt = {
      ...requestedReceipt,
      status: "completed",
      completedAt: "2026-10-05T12:01:00.000Z",
    };
    const commit = deferred();
    boundary.updateSettings.mockReturnValueOnce(commit.promise);
    const operation = useCloudStore.getState().bootstrap();
    await flush();
    const receiptBeforeCommit = boundary.receipt;
    const stateBeforeCommit = useCloudStore.getState();
    commit.resolve();
    await operation;
    expect(receiptBeforeCommit).not.toBeNull();
    expect(stateBeforeCommit.sessionStatus).toBe("deletion_pending");
    expect(stateBeforeCommit.account).toBeNull();
    expect(stateBeforeCommit.productConsent).toBeNull();
    expect(boundary.receipt).toBeNull();
    expect(useCloudStore.getState().sessionStatus).toBe("signed_out");
  });

  it("retains a completed receipt and stays fail closed when settings cleanup rejects", async () => {
    boundary.receipt = {
      ...requestedReceipt,
      status: "completed",
      completedAt: "2026-10-05T12:01:00.000Z",
    };
    const failure = handledFailure();
    boundary.updateSettings.mockReturnValue(failure.promise);
    await expect(useCloudStore.getState().bootstrap()).resolves.toBeUndefined();
    expect(boundary.receipt).not.toBeNull();
    expect(useCloudStore.getState().sessionStatus).toBe("deletion_pending");
    expect(useCloudStore.getState().account).toBeNull();
  });

  it("keeps a protected requested deletion fail closed if both settings attempts reject", async () => {
    useCloudStore.setState({ sessionStatus: "signed_in", account });
    const failure = handledFailure();
    boundary.updateSettings.mockReturnValue(failure.promise);
    const outcome = await useCloudStore
      .getState()
      .requestCloudDeletion()
      .catch((error) => error);
    expect(outcome).toBe(failure.error);
    expect(boundary.receipt).toEqual(requestedReceipt);
    expect(useCloudStore.getState().sessionStatus).toBe("deletion_pending");
    expect(useCloudStore.getState().account).toBeNull();
    expect(useCloudStore.getState().busy).toBe(false);
  });

  it("blocks restored account work while pending-deletion settings are queued", async () => {
    useCloudStore.setState({
      sessionStatus: "signed_in",
      account,
      productConsent: {} as ProductConsent,
    });
    boundary.receipt = requestedReceipt;
    const commit = deferred();
    boundary.updateSettings.mockReturnValueOnce(commit.promise);
    let finished = false;
    const operation = useCloudStore
      .getState()
      .bootstrap()
      .then(() => {
        finished = true;
      });
    await flush();
    const stateBeforeCommit = useCloudStore.getState();
    const finishedBeforeCommit = finished;
    commit.resolve();
    await operation;
    expect(stateBeforeCommit.sessionStatus).toBe("deletion_pending");
    expect(stateBeforeCommit.account).toBeNull();
    expect(stateBeforeCommit.productConsent).toBeNull();
    expect(finishedBeforeCommit).toBe(false);
    expect(boundary.restoreSession).not.toHaveBeenCalled();
  });

  it("enters receipt-owned deletion mode before queued analytics cleanup finishes", async () => {
    useCloudStore.setState({
      sessionStatus: "signed_in",
      account,
      productConsent: {} as ProductConsent,
    });
    const commit = deferred();
    boundary.updateSettings.mockReturnValueOnce(commit.promise);
    let finished = false;
    const operation = useCloudStore
      .getState()
      .requestCloudDeletion()
      .then(() => {
        finished = true;
      });
    await flush();
    const stateBeforeCommit = useCloudStore.getState();
    const finishedBeforeCommit = finished;
    await useCloudStore.getState().requestCloudDeletion();
    commit.resolve();
    await operation;
    expect(stateBeforeCommit.sessionStatus).toBe("deletion_pending");
    expect(stateBeforeCommit.account).toBeNull();
    expect(stateBeforeCommit.productConsent).toBeNull();
    expect(stateBeforeCommit.deletionAccountId).toBe(account.id);
    expect(finishedBeforeCommit).toBe(false);
    expect(boundary.receipt).toEqual(requestedReceipt);
    expect(boundary.requestDeletion).toHaveBeenCalledTimes(1);
  });

  it("keeps an untrackable requested deletion blocked when abandonment settings fail", async () => {
    useCloudStore.setState({
      sessionStatus: "signed_in",
      account,
      productConsent: {} as ProductConsent,
    });
    boundary.persistReceipt.mockRejectedValueOnce(
      new Error("Receipt protection failed."),
    );
    const failure = handledFailure();
    boundary.updateSettings.mockReturnValue(failure.promise);
    await expect(
      useCloudStore.getState().requestCloudDeletion(),
    ).resolves.toBeUndefined();
    expect(useCloudStore.getState().sessionStatus).toBe("unavailable");
    expect(useCloudStore.getState().account).toBeNull();
    expect(useCloudStore.getState().productConsent).toBeNull();
    expect(useCloudStore.getState().busy).toBe(false);
    expect(boundary.clearCredentials).toHaveBeenCalled();
  });

  it("blocks an untrackable deletion while abandonment settings are queued", async () => {
    useCloudStore.setState({
      sessionStatus: "signed_in",
      account,
      productConsent: {} as ProductConsent,
    });
    boundary.persistReceipt.mockRejectedValueOnce(
      new Error("Receipt protection failed."),
    );
    const commit = deferred();
    boundary.updateSettings.mockReturnValueOnce(commit.promise);
    const operation = useCloudStore.getState().requestCloudDeletion();
    await flush();
    const stateBeforeCommit = useCloudStore.getState();
    commit.resolve();
    await operation;
    expect(stateBeforeCommit.sessionStatus).toBe("unavailable");
    expect(stateBeforeCommit.account).toBeNull();
    expect(stateBeforeCommit.productConsent).toBeNull();
    expect(boundary.clearCredentials).toHaveBeenCalled();
  });

  it.each(["bootstrap", "signIn", "refreshAccountData"] as const)(
    "blocks account work in %s while unreceipted deletion cleanup is queued",
    async (method) => {
      useCloudStore.setState({
        sessionStatus: "signed_in",
        account,
        productConsent: {} as ProductConsent,
      });
      boundary.account.mockResolvedValue({ ...account, deletionPending: true });
      const commit = deferred();
      boundary.updateSettings.mockReturnValueOnce(commit.promise);
      const operation = useCloudStore.getState()[method]();
      await flush();
      const stateBeforeCommit = useCloudStore.getState();
      commit.resolve();
      await operation;
      expect(stateBeforeCommit.sessionStatus).toBe("unavailable");
      expect(stateBeforeCommit.account).toBeNull();
      expect(stateBeforeCommit.productConsent).toBeNull();
      expect(boundary.analyticsConsent).not.toHaveBeenCalled();
      expect(useCloudStore.getState().sessionStatus).toBe("unavailable");
    },
  );

  it("does not restore a normal account when abandonment settings cleanup fails", async () => {
    boundary.account.mockResolvedValue({ ...account, deletionPending: true });
    const failure = handledFailure();
    boundary.updateSettings.mockReturnValue(failure.promise);
    await useCloudStore.getState().signIn();
    expect(useCloudStore.getState().sessionStatus).toBe("unavailable");
    expect(useCloudStore.getState().account).toBeNull();
    expect(boundary.clearCredentials).toHaveBeenCalled();
    expect(boundary.analyticsConsent).not.toHaveBeenCalled();
  });

  it("clears the signed-out account even if local settings cannot be saved", async () => {
    useCloudStore.setState({
      sessionStatus: "signed_in",
      account,
      productConsent: {} as ProductConsent,
    });
    const failure = handledFailure();
    boundary.updateSettings.mockReturnValueOnce(failure.promise);
    await useCloudStore.getState().signOut();
    expect(useCloudStore.getState().sessionStatus).toBe("signed_out");
    expect(useCloudStore.getState().account).toBeNull();
    expect(useCloudStore.getState().productConsent).toBeNull();
    expect(useCloudStore.getState().error).toBe(failure.error.message);
    expect(useCloudStore.getState().busy).toBe(false);
  });

  it("clears the signed-out account while its settings commit is still queued", async () => {
    useCloudStore.setState({
      sessionStatus: "signed_in",
      account,
      productConsent: {} as ProductConsent,
    });
    const commit = deferred();
    boundary.updateSettings.mockReturnValueOnce(commit.promise);
    let finished = false;
    const operation = useCloudStore
      .getState()
      .signOut()
      .then(() => {
        finished = true;
      });
    await flush();
    const stateBeforeCommit = useCloudStore.getState();
    const finishedBeforeCommit = finished;
    commit.resolve();
    await operation;
    expect(stateBeforeCommit.sessionStatus).toBe("signed_out");
    expect(stateBeforeCommit.account).toBeNull();
    expect(stateBeforeCommit.productConsent).toBeNull();
    expect(finishedBeforeCommit).toBe(false);
  });

  it("preserves the account when credential removal itself fails", async () => {
    useCloudStore.setState({ sessionStatus: "signed_in", account });
    boundary.signOut.mockRejectedValueOnce(
      new Error("Credentials could not be removed."),
    );
    await useCloudStore.getState().signOut();
    expect(useCloudStore.getState().sessionStatus).toBe("signed_in");
    expect(useCloudStore.getState().account).toEqual(account);
    expect(useCloudStore.getState().busy).toBe(false);
    expect(boundary.updateSettings).not.toHaveBeenCalled();
  });
});
