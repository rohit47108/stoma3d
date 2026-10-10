import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodePhoto,
  prepareCanvasPhoto,
  type PreparedPhoto,
} from "../lib/scan-image";
import { ScanPhotoReview } from "./scan-photo-review";

// A lifecycle-wiring test, not a real DOM mount. Image processing is deferred
// so navigation cleanup can be exercised without adding a browser test runtime.
const hooks = vi.hoisted(() => ({
  cleanups: [] as (() => void)[],
  stateUpdates: vi.fn(),
  stateCursor: 0,
  stateValues: new Map<number, unknown>(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const slot = hooks.stateCursor++;
    return [
      hooks.stateValues.has(slot) ? hooks.stateValues.get(slot) : initial,
      hooks.stateUpdates,
    ];
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (setup: () => (() => void) | void) => {
    const cleanup = setup();
    if (cleanup) hooks.cleanups.push(cleanup);
  },
}));
vi.mock("../lib/scan-image", () => ({
  decodePhoto: vi.fn(),
  prepareCanvasPhoto: vi.fn(),
}));

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function findButton(
  node: ReactNode,
  label: string,
): ReactElement<{ onClick: () => void }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label);
      if (found) return found;
    }
  } else if (
    isValidElement<{ children?: ReactNode; onClick: () => void }>(node)
  ) {
    if (node.type === "button" && node.props.children === label) return node;
    return findButton(node.props.children, label);
  }
  return null;
}

function renderReview(
  overrides: Partial<Parameters<typeof ScanPhotoReview>[0]> = {},
) {
  hooks.stateCursor = 0;
  const photo: PreparedPhoto = {
    image: "data:image/jpeg;base64,cGhvdG8=",
    blob: new Blob(["photo"], { type: "image/jpeg" }),
    width: 640,
    height: 480,
  };
  const changed = vi.fn();
  const review = ScanPhotoReview({
    photo,
    busy: false,
    problem: null,
    onChange: changed,
    onUse: () => undefined,
    onReplace: () => undefined,
    ...overrides,
  });
  const rotate = findButton(review, "Rotate 90°")!;
  return { changed, photo, tree: review, rotate: () => rotate.props.onClick() };
}

const finishMicrotasks = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.clearAllMocks();
  hooks.cleanups.length = 0;
  hooks.stateCursor = 0;
  hooks.stateValues.clear();
  vi.mocked(decodePhoto).mockResolvedValue({
    naturalWidth: 640,
    naturalHeight: 480,
  } as HTMLImageElement);
});

describe("photo edit lifecycle", () => {
  it.each([
    { previousError: null, label: "Use photo" },
    {
      previousError: "This photo is too blurry.",
      label: "Try this photo again",
    },
  ])(
    "clears the edit error before $label starts a new analysis",
    ({ previousError, label }) => {
      const editError = "The edit could not be applied. Try again.";
      const analysisError = "The privacy check could not run. Try again.";
      hooks.stateValues.set(0, true);
      hooks.stateValues.set(6, editError);
      const onUse = vi.fn();
      const review = renderReview({ problem: previousError, onUse });

      findButton(review.tree, label)!.props.onClick();

      expect(hooks.stateUpdates).toHaveBeenCalledWith(null);
      expect(onUse).toHaveBeenCalledOnce();
      expect(hooks.stateUpdates.mock.invocationCallOrder[0]).toBeLessThan(
        onUse.mock.invocationCallOrder[0],
      );
      // Emulate that committed state update before a later service error arrives.
      hooks.stateValues.set(6, null);
      const html = renderToStaticMarkup(
        renderReview({ problem: analysisError }).tree,
      );
      expect(html).toContain(analysisError);
      expect(html).not.toContain(editError);
    },
  );

  it("shows a newer edit error instead of the previous analysis error", () => {
    hooks.stateValues.set(6, "The edit could not be applied. Try again.");
    const review = renderReview({ problem: "This photo is too blurry." });
    const html = renderToStaticMarkup(review.tree);

    expect(html).toContain(
      '<p role="alert" class="scan-error">The edit could not be applied. Try again.</p>',
    );
    expect(html).not.toContain("This photo is too blurry.");
  });

  it("announces photo editing while disabling photo submission", () => {
    hooks.stateValues.set(1, true);
    const html = renderToStaticMarkup(renderReview().tree);

    expect(html).toContain('role="status"');
    expect(html).toContain("Updating photo…");
    expect(html).toMatch(/disabled="">Updating photo…<\/button>/);
  });

  it("keeps an empty status region mounted before preparation starts", () => {
    const html = renderToStaticMarkup(renderReview().tree);
    expect(html).toContain('<p role="status" class="sr-only"></p>');
    expect(html).not.toContain("Updating photo…");
  });

  it("does not replace a newer photo when an abandoned edit finishes", async () => {
    const preparation = deferred<PreparedPhoto>();
    vi.mocked(prepareCanvasPhoto).mockReturnValue(preparation.promise);
    const review = renderReview();
    review.rotate();
    await finishMicrotasks();
    hooks.cleanups.forEach((cleanup) => cleanup());
    const updatesAtClose = hooks.stateUpdates.mock.calls.length;

    preparation.resolve({
      ...review.photo,
      image: "data:image/jpeg;base64,b2xkLWVkaXQ=",
    });
    await finishMicrotasks();

    expect(review.changed).not.toHaveBeenCalled();
    expect(hooks.stateUpdates.mock.calls).toHaveLength(updatesAtClose);
  });

  it("does not show a late edit error after review is closed", async () => {
    const decoding = deferred<HTMLImageElement>();
    vi.mocked(decodePhoto).mockReturnValue(decoding.promise);
    const review = renderReview();
    review.rotate();
    hooks.cleanups.forEach((cleanup) => cleanup());
    const updatesAtClose = hooks.stateUpdates.mock.calls.length;

    decoding.reject(new Error("Photo decoding failed."));
    await finishMicrotasks();

    expect(review.changed).not.toHaveBeenCalled();
    expect(hooks.stateUpdates.mock.calls).toHaveLength(updatesAtClose);
  });

  it("starts only one edit when rotate is tapped twice before a render", async () => {
    const decoding = deferred<HTMLImageElement>();
    vi.mocked(decodePhoto).mockReturnValue(decoding.promise);
    const review = renderReview();
    vi.mocked(prepareCanvasPhoto).mockResolvedValue(review.photo);
    review.rotate();
    review.rotate();
    decoding.resolve({
      naturalWidth: 640,
      naturalHeight: 480,
    } as HTMLImageElement);
    await finishMicrotasks();

    expect(review.changed.mock.calls).toHaveLength(1);
  });

  it("applies a finished edit while its review is still open", async () => {
    const review = renderReview();
    const rotated = { ...review.photo, width: 480, height: 640 };
    vi.mocked(prepareCanvasPhoto).mockResolvedValue(rotated);
    review.rotate();
    await finishMicrotasks();

    expect(review.changed).toHaveBeenCalledWith(rotated);
  });

  it("lets the user explicitly change region while retaining the reviewed photo", () => {
    const apply = vi.fn();
    const review = renderReview({
      problem:
        "This looks like tongue underside. Choose the matching region or another photo.",
      regionCorrection: { region: "ventral_tongue", onApply: apply },
    });
    const correction = findButton(review.tree, "Change to tongue underside");
    expect(correction).not.toBeNull();
    correction!.props.onClick();

    expect(apply).toHaveBeenCalledOnce();
    expect(review.changed).not.toHaveBeenCalled();
    expect(hooks.stateUpdates).toHaveBeenCalledWith(false);
  });

  it("does not show a region-change action when no correction is needed", () => {
    const review = renderReview({
      regionCorrection: { region: "ventral_tongue", onApply: vi.fn() },
    });
    expect(findButton(review.tree, "Change to tongue underside")).toBeNull();
  });
});
