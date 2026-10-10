import { describe, expect, it, vi } from "vitest";

import {
  createBackgroundCleanupCoordinator,
  createCaptureLifecycle,
  createCaptureCommitCoordinator,
  shouldPurgeBackgroundTemporaryFiles,
} from "../src/lib/captureLifecycle";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("native capture lifecycle", () => {
  it("retains queued save ownership when one screen unsubscribes and another mounts", () => {
    const commits = createCaptureCommitCoordinator();
    const oldScreen = vi.fn();
    const unsubscribe = commits.subscribe(oldScreen);
    const release = commits.begin(["capture-1"]);
    unsubscribe();
    const newScreen = vi.fn();
    commits.subscribe(newScreen);
    expect(commits.has("capture-1")).toBe(true);
    expect(commits.hasPending()).toBe(true);
    release();
    expect(oldScreen).toHaveBeenCalledOnce();
    expect(newScreen).toHaveBeenCalledOnce();
    expect(commits.hasPending()).toBe(false);
  });

  it("does not release a newer lease or notify twice when cleanup repeats", () => {
    const commits = createCaptureCommitCoordinator();
    const changed = vi.fn();
    commits.subscribe(changed);
    const first = commits.begin(["capture-1", "capture-1"]);
    const second = commits.begin(["capture-1", "capture-2"]);
    first();
    first();
    expect(commits.has("capture-1")).toBe(true);
    expect(commits.has("capture-2")).toBe(true);
    expect(changed).toHaveBeenCalledTimes(3);
    second();
    expect(commits.hasPending()).toBe(false);
    expect(changed).toHaveBeenCalledTimes(4);
  });

  it("prevents an older action from owning cleanup after a new action begins", () => {
    const lifecycle = createCaptureLifecycle("active");
    const oldAction = lifecycle.beginReviewAction();
    const newAction = lifecycle.beginReviewAction();
    expect(lifecycle.isReviewCurrent(oldAction)).toBe(false);
    expect(lifecycle.isReviewCurrent(newAction)).toBe(true);
  });
  it("keeps picker route ownership through background but invalidates old photo work", () => {
    const lifecycle = createCaptureLifecycle("active");
    const picker = lifecycle.routeToken();
    const edit = lifecycle.reviewToken();

    lifecycle.setAppState("background");
    lifecycle.setAppState("active");

    expect(lifecycle.isRouteCurrent(picker)).toBe(true);
    expect(lifecycle.isReviewCurrent(edit)).toBe(false);
    expect(lifecycle.isReviewCurrent(lifecycle.reviewToken())).toBe(true);
  });

  it("preserves review work through an inactive picker transition", () => {
    const lifecycle = createCaptureLifecycle("active");
    const token = lifecycle.reviewToken();
    lifecycle.setAppState("inactive");
    expect(lifecycle.isReviewCurrent(token)).toBe(true);
    expect(shouldPurgeBackgroundTemporaryFiles("inactive")).toBe(false);
    expect(shouldPurgeBackgroundTemporaryFiles("background")).toBe(true);
  });

  it.each(["blur", "dispose"] as const)(
    "invalidates both picker returns and delayed review work after %s",
    (event) => {
      const lifecycle = createCaptureLifecycle("active");
      const picker = lifecycle.routeToken();
      const edit = lifecycle.reviewToken();
      lifecycle[event]();
      lifecycle.focus();
      expect(lifecycle.isRouteCurrent(picker)).toBe(false);
      expect(lifecycle.isReviewCurrent(edit)).toBe(false);
    },
  );

  it("waits for the foreground before producing replacement plaintext", async () => {
    const lifecycle = createCaptureLifecycle("background");
    const ready = vi.fn();
    const pending = lifecycle.waitForForeground().then(ready);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    lifecycle.setAppState("active");
    await pending;
    expect(ready).toHaveBeenCalledOnce();
  });

  it("waits for an older purge before restoring an encrypted retry draft", async () => {
    const cleanup = createBackgroundCleanupCoordinator();
    const purge = deferred();
    const restored = vi.fn();
    void cleanup.schedule(() => purge.promise);
    const pending = cleanup.wait().then(restored);
    await Promise.resolve();
    expect(restored).not.toHaveBeenCalled();
    purge.resolve();
    await pending;
    expect(restored).toHaveBeenCalledOnce();
  });
});
