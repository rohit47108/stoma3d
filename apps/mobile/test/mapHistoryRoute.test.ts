import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureRecord, ObservationPin } from "../src/types";
import { MOUTH_REGIONS } from "@stoma3d/contracts";

// Execute the real route with persistent hooks and controlled native boundaries.
// This checks navigation wiring, not a native UI mount or the 3D renderer.
const runtime = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as Array<{
    value?: unknown;
    dependencies?: readonly unknown[];
    cleanup?: () => void;
  }>,
  effects: [] as Array<() => void>,
  dirty: false,
  params: {} as { region?: string; captureId?: string; mapRequestId?: string },
  focusVersion: 0,
  store: {} as Record<string, unknown>,
  navigate: vi.fn(),
}));

vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  const matches = (left?: readonly unknown[], right?: readonly unknown[]) =>
    left !== undefined &&
    right !== undefined &&
    left.length === right.length &&
    left.every((value, index) => Object.is(value, right[index]));
  return {
    ...react,
    useCallback: (callback: unknown, dependencies: readonly unknown[]) => {
      const index = runtime.cursor++;
      if (!matches(runtime.slots[index]?.dependencies, dependencies)) {
        runtime.slots[index] = { value: callback, dependencies };
      }
      return runtime.slots[index].value;
    },
    useRef: (initial: unknown) => {
      const index = runtime.cursor++;
      runtime.slots[index] ??= { value: { current: initial } };
      return runtime.slots[index].value;
    },
    useState: (initial: unknown) => {
      const index = runtime.cursor++;
      runtime.slots[index] ??= {
        value: typeof initial === "function" ? initial() : initial,
      };
      return [
        runtime.slots[index].value,
        (change: unknown) => {
          const previous = runtime.slots[index].value;
          const next = typeof change === "function" ? change(previous) : change;
          if (!Object.is(previous, next)) {
            runtime.slots[index].value = next;
            runtime.dirty = true;
          }
        },
      ];
    },
    useMemo: (calculate: () => unknown, dependencies: readonly unknown[]) => {
      const index = runtime.cursor++;
      if (!matches(runtime.slots[index]?.dependencies, dependencies)) {
        runtime.slots[index] = { value: calculate(), dependencies };
      }
      return runtime.slots[index].value;
    },
    useEffect: (
      setup: () => (() => void) | void,
      dependencies?: readonly unknown[],
    ) => {
      const index = runtime.cursor++;
      const previous = runtime.slots[index];
      if (matches(previous?.dependencies, dependencies)) return;
      runtime.slots[index] = { dependencies };
      runtime.effects.push(() => {
        previous?.cleanup?.();
        runtime.slots[index].cleanup = setup() ?? undefined;
      });
    },
  };
});
vi.mock("expo-router", async () => {
  const react = await import("react");
  return {
    router: { push: runtime.navigate },
    useLocalSearchParams: () => runtime.params,
    useFocusEffect: (effect: () => void) =>
      react.useEffect(effect, [effect, runtime.focusVersion]),
  };
});
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("@/components/OralObservationMap", () => ({
  OralObservationMap: "OralObservationMap",
}));
vi.mock("@/components/Screen", () => ({ Screen: "Screen" }));
vi.mock("@/components/Ui", () => ({
  Button: "Button",
  Card: "Card",
  EmptyState: "EmptyState",
  SectionTitle: "SectionTitle",
}));
vi.mock("@/lib/observationMap", () => import("../src/lib/observationMap"));
vi.mock("@/lib/motionPreferences", () => ({ animationDurationMs: () => 1250 }));
vi.mock("@/store/useStoma3DStore", () => ({
  useStoma3DStore: (select: (state: Record<string, unknown>) => unknown) =>
    select(runtime.store),
}));
vi.mock("@/theme", () => ({
  useAppTheme: () => ({ fontScale: 1 }),
  useShouldReduceMotion: () => true,
}));

vi.mock("@/lib/resultCopy", () => import("../src/lib/resultCopy"));

import MapRoute from "../app/(tabs)/map";

const record = (id: string, date: string): CaptureRecord => ({
  id,
  sessionId: `${id}-scan`,
  capturedAt: date,
  region: "dorsal_tongue",
  angle: "primary",
  mediaKind: "image",
  encryptedUri: `${id}.osv`,
  mimeType: "image/jpeg",
  inputOrigin: "live_capture",
  quality: {
    accepted: true,
    blurScore: 0.9,
    exposureScore: 0.9,
    glareScore: 0,
    obstructionScore: 0,
    faceDetected: false,
    reasons: [],
  },
});
const earlier = record("earlier", "2026-09-01T20:00:00Z");
const later = record("later", "2026-10-01T20:00:00Z");
const pin: ObservationPin = {
  id: "linked-pin",
  region: "dorsal_tongue",
  meshId: "tongue_dorsal",
  uvX: 0.5,
  uvY: 0.5,
  assetVersion: "procedural-v1",
  userConfirmed: true,
  firstObservedAt: earlier.capturedAt,
  status: "stable",
  captureIds: [earlier.id, later.id],
};

function renderRoute(): ReactNode {
  let tree: ReactNode;
  for (let pass = 0; pass < 20; pass += 1) {
    runtime.cursor = 0;
    runtime.dirty = false;
    tree = MapRoute();
    runtime.effects.splice(0).forEach((effect) => effect());
    if (!runtime.dirty) return tree;
  }
  throw new Error("The map route did not settle.");
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [
    node,
    ...elements(node.props.action as ReactNode),
    ...elements(node.props.children as ReactNode),
  ];
}

function openHistory() {
  const button = elements(renderRoute()).find(
    (element) => element.props.label === "History",
  );
  expect(button).toBeDefined();
  (button!.props.onPress as () => void)();
}

function observationButton(tree: ReactNode) {
  return elements(tree).find(
    (element) =>
      typeof element.props.accessibilityLabel === "string" &&
      element.props.accessibilityLabel.startsWith("Stable observation."),
  )!;
}

beforeEach(() => {
  runtime.slots.forEach((slot) => slot.cleanup?.());
  runtime.slots = [];
  runtime.effects = [];
  runtime.params = { region: earlier.region };
  runtime.focusVersion = 0;
  runtime.store = {
    settings: { animationSpeed: "standard" },
    captures: [later, earlier],
    analyses: {},
    pins: [pin],
    activeSessionId: later.sessionId,
  };
  runtime.navigate.mockClear();
});

describe("map history navigation", () => {
  it("describes accepted uploads as photos rather than live camera captures", () => {
    runtime.store.captures = [{ ...later, captureSource: "photo_library" }];
    const tree = renderRoute();
    const coverage = elements(tree).find(
      (element) => element.props.label === "Coverage",
    )!;
    expect(coverage.props.value).toBe("1 accepted photo");
  });

  it("opens a saved observation even when review priority is disabled", () => {
    runtime.store.pins = [{ ...pin, status: "review_unavailable" }];
    const tree = renderRoute();
    const saved = elements(tree).find(
      (element) =>
        typeof element.props.accessibilityLabel === "string" &&
        element.props.accessibilityLabel.startsWith("Observation saved."),
    );
    expect(saved).toBeDefined();
    expect(
      elements(tree).some(
        (element) => element.props.children === "Review unavailable",
      ),
    ).toBe(false);
    (saved!.props.onPress as () => void)();
    expect(runtime.navigate).toHaveBeenCalledWith({
      pathname: "/result/[captureId]",
      params: { captureId: later.id },
    });
  });

  it.each([undefined, "upper_lip"])(
    "uses the requested capture's region instead of a missing or conflicting region parameter (%s)",
    (region) => {
      runtime.params = { captureId: earlier.id, region };
      const map = elements(renderRoute()).find(
        (element) => element.type === "OralObservationMap",
      )!;
      expect(map.props.selectedRegion).toBe(earlier.region);
    },
  );

  it("opens the historical frame requested by a saved result", () => {
    runtime.params.captureId = earlier.id;
    const tree = renderRoute();
    const map = elements(tree).find(
      (element) => element.type === "OralObservationMap",
    )!;
    expect(map.props.summaries).toMatchObject({
      dorsal_tongue: {
        acceptedCaptureCount: 1,
        latestCaptureAt: earlier.capturedAt,
      },
    });
    expect(map.props.selectedRegion).toBe(earlier.region);
  });

  it("opens and counts only photos visible at an older pin's replay cutoff", () => {
    openHistory();
    let tree = renderRoute();
    const previous = elements(tree).find(
      (element) => element.props.label === "Previous scan",
    )!;
    (previous.props.onPress as () => void)();
    tree = renderRoute();
    const button = observationButton(tree);
    (button.props.onPress as () => void)();
    expect(runtime.navigate).toHaveBeenCalledWith({
      pathname: "/result/[captureId]",
      params: { captureId: earlier.id },
    });
    expect(button.props.accessibilityLabel).toContain("1 linked observation");
  });

  it("opens and counts only eligible linked photos from the selected scan", () => {
    const rejected = {
      ...record("rejected", "2026-10-02T20:00:00Z"),
      quality: { ...later.quality, accepted: false },
    };
    runtime.store.captures = [rejected, later, earlier];
    runtime.store.pins = [
      { ...pin, captureIds: [...pin.captureIds, rejected.id] },
    ];
    const button = observationButton(renderRoute());
    (button.props.onPress as () => void)();
    expect(runtime.navigate).toHaveBeenCalledWith({
      pathname: "/result/[captureId]",
      params: { captureId: later.id },
    });
    expect(button.props.accessibilityLabel).toContain("1 linked observation");
  });

  it("keeps a new one-region scan distinct from a previous complete scan", () => {
    const previous = MOUTH_REGIONS.map((region) => ({
      ...record(`old-${region}`, earlier.capturedAt),
      region,
      sessionId: "old-complete",
    }));
    runtime.store.captures = [...previous, later];
    runtime.store.pins = [{ ...pin, captureIds: [previous[0].id] }];
    const tree = renderRoute();
    const map = elements(tree).find(
      (element) => element.type === "OralObservationMap",
    )!;
    expect(map.props.completedRegions).toEqual(["dorsal_tongue"]);
    expect(map.props.visiblePinIds).toEqual([]);
    expect(map.props.summaries).toMatchObject({
      upper_lip: { acceptedCaptureCount: 0 },
    });
    expect(
      elements(tree).some(
        (element) => element.props.children === "Map history",
      ),
    ).toBe(false);
  });

  it("shows an empty current scan even when older scans cover all regions", () => {
    runtime.store.captures = MOUTH_REGIONS.map((region) => ({
      ...record(`old-${region}`, earlier.capturedAt),
      region,
      sessionId: "old-complete",
    }));
    runtime.store.activeSessionId = "new-empty";
    const map = elements(renderRoute()).find(
      (element) => element.type === "OralObservationMap",
    )!;
    expect(map.props.completedRegions).toEqual([]);
    expect(map.props.visiblePinIds).toEqual([]);
  });

  it("preserves cumulative history when the user explicitly opens it", () => {
    runtime.store.captures = [
      ...MOUTH_REGIONS.map((region) => ({
        ...record(`old-${region}`, earlier.capturedAt),
        region,
        sessionId: "old-complete",
      })),
      later,
    ];
    openHistory();
    const tree = renderRoute();
    const map = elements(tree).find(
      (element) => element.type === "OralObservationMap",
    )!;
    expect(map.props.completedRegions).toHaveLength(8);
    expect(
      elements(tree).some(
        (element) => element.props.children === "Map history",
      ),
    ).toBe(true);
    const back = elements(tree).find(
      (element) => element.props.label === "Back to scan",
    )!;
    (back.props.onPress as () => void)();
    expect(
      elements(renderRoute()).find(
        (element) => element.type === "OralObservationMap",
      )!.props.completedRegions,
    ).toEqual(["dorsal_tongue"]);
  });

  it("updates the scan context when a new scan starts while the tab is mounted", () => {
    renderRoute();
    runtime.store.activeSessionId = "new-empty";
    const map = elements(renderRoute()).find(
      (element) => element.type === "OralObservationMap",
    )!;
    expect(map.props.completedRegions).toEqual([]);
  });

  it("returns from history to the requested saved scan when another result opens", () => {
    openHistory();
    runtime.params.captureId = earlier.id;
    const tree = renderRoute();
    expect(
      elements(tree).some(
        (element) => element.props.children === "Map history",
      ),
    ).toBe(false);
    const map = elements(tree).find(
      (element) => element.type === "OralObservationMap",
    )!;
    expect(map.props.summaries).toMatchObject({
      dorsal_tongue: {
        acceptedCaptureCount: 1,
        latestCaptureAt: earlier.capturedAt,
      },
    });
    const observation = observationButton(tree);
    (observation.props.onPress as () => void)();
    expect(runtime.navigate).toHaveBeenCalledWith({
      pathname: "/result/[captureId]",
      params: { captureId: earlier.id },
    });
  });

  it("honors another result request while the map tab remains mounted", () => {
    renderRoute();
    runtime.params.captureId = earlier.id;
    const map = elements(renderRoute()).find(
      (element) => element.type === "OralObservationMap",
    )!;
    expect(map.props.summaries).toMatchObject({
      dorsal_tongue: { latestCaptureAt: earlier.capturedAt },
    });
  });

  it("does not keep an old result request when another scan becomes active", () => {
    runtime.params = { captureId: earlier.id, mapRequestId: "request-one" };
    renderRoute();
    runtime.store.activeSessionId = "new-empty";
    const map = elements(renderRoute()).find(
      (element) => element.type === "OralObservationMap",
    )!;
    expect(map.props.completedRegions).toEqual([]);
    expect(map.props.visiblePinIds).toEqual([]);
  });

  it("treats reopening the same result as a fresh request rather than keeping history open", () => {
    runtime.params = { captureId: earlier.id, mapRequestId: "request-one" };
    renderRoute();
    openHistory();
    runtime.params = { ...runtime.params, mapRequestId: "request-two" };
    const tree = renderRoute();
    expect(
      elements(tree).some(
        (element) => element.props.children === "Map history",
      ),
    ).toBe(false);
    const map = elements(tree).find(
      (element) => element.type === "OralObservationMap",
    )!;
    expect(map.props.summaries).toMatchObject({
      dorsal_tongue: {
        acceptedCaptureCount: 1,
        latestCaptureAt: earlier.capturedAt,
      },
    });
  });

  it("returns to the current scan on a plain tab focus without replaying a consumed result request", () => {
    runtime.params = { captureId: earlier.id, mapRequestId: "request-one" };
    renderRoute();
    runtime.focusVersion += 1;
    const map = elements(renderRoute()).find(
      (element) => element.type === "OralObservationMap",
    )!;
    expect(map.props.summaries).toMatchObject({
      dorsal_tongue: {
        acceptedCaptureCount: 1,
        latestCaptureAt: later.capturedAt,
      },
    });
  });

  it("keeps the selected saved scan when unrelated records arrive without a new focus", () => {
    runtime.params = { captureId: earlier.id, mapRequestId: "request-one" };
    renderRoute();
    runtime.store.captures = [
      ...(runtime.store.captures as CaptureRecord[]),
      record("newer", "2026-10-03T20:00:00Z"),
    ];
    const map = elements(renderRoute()).find(
      (element) => element.type === "OralObservationMap",
    )!;
    expect(map.props.summaries).toMatchObject({
      dorsal_tongue: {
        acceptedCaptureCount: 1,
        latestCaptureAt: earlier.capturedAt,
      },
    });
  });
});
