// AppState distinguishes background from temporary inactive transitions.
// https://reactnative.dev/docs/0.86/appstate#app-states
export function shouldPurgeBackgroundTemporaryFiles(state: string): boolean {
  return state === "background";
}

export function createBackgroundCleanupCoordinator() {
  let pending = Promise.resolve();
  return {
    schedule(cleanup: () => Promise<void>): Promise<void> {
      pending = pending.catch(() => undefined).then(cleanup);
      return pending;
    },
    wait(): Promise<void> {
      return pending;
    },
  };
}

export const captureBackgroundCleanup = createBackgroundCleanupCoordinator();

export function createCaptureCommitCoordinator() {
  const pending = new Map<string, number>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    hasPending: () => pending.size > 0,
    has: (captureId: string) => pending.has(captureId),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    begin(captureIds: readonly string[]) {
      const ids = [...new Set(captureIds)];
      for (const id of ids) pending.set(id, (pending.get(id) ?? 0) + 1);
      if (ids.length > 0) notify();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        for (const id of ids) {
          const remaining = (pending.get(id) ?? 1) - 1;
          if (remaining > 0) pending.set(id, remaining);
          else pending.delete(id);
        }
        if (ids.length > 0) notify();
      };
    },
  };
}

// A queued save outlives a capture route. Remounts must not reopen its draft.
export const capturePendingCommits = createCaptureCommitCoordinator();

export function createCaptureLifecycle(initialState: string | null) {
  let appState = initialState;
  let routeEpoch = 0;
  let reviewEpoch = 0;
  let mounted = true;
  let focused = true;
  const foregroundWaiters = new Set<() => void>();
  const releaseWaiters = () => {
    for (const resolve of foregroundWaiters) resolve();
    foregroundWaiters.clear();
  };
  const isRouteCurrent = (token: number) =>
    mounted && focused && token === routeEpoch;
  return {
    routeToken: () => routeEpoch,
    reviewToken: () => ({ route: routeEpoch, review: reviewEpoch }),
    beginReviewAction() {
      reviewEpoch += 1;
      return { route: routeEpoch, review: reviewEpoch };
    },
    isRouteCurrent,
    isReviewCurrent: (token: { route: number; review: number }) =>
      isRouteCurrent(token.route) &&
      token.review === reviewEpoch &&
      appState !== "background",
    invalidateReview() {
      reviewEpoch += 1;
    },
    invalidateContext() {
      routeEpoch += 1;
      reviewEpoch += 1;
      releaseWaiters();
    },
    setAppState(state: string) {
      appState = state;
      if (shouldPurgeBackgroundTemporaryFiles(state)) reviewEpoch += 1;
      if (state === "active") releaseWaiters();
    },
    focus() {
      focused = true;
    },
    blur() {
      focused = false;
      routeEpoch += 1;
      reviewEpoch += 1;
      releaseWaiters();
    },
    dispose() {
      mounted = false;
      routeEpoch += 1;
      reviewEpoch += 1;
      releaseWaiters();
    },
    waitForForeground(): Promise<void> {
      if (appState === "active" || !mounted || !focused)
        return Promise.resolve();
      return new Promise((resolve) => foregroundWaiters.add(resolve));
    },
  };
}

export type CaptureReviewToken = ReturnType<
  ReturnType<typeof createCaptureLifecycle>["reviewToken"]
>;
