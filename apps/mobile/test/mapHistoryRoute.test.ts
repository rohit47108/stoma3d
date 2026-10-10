import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureRecord, ObservationPin } from "../src/types";

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
  params: {} as { region?: string; captureId?: string },
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
vi.mock("expo-router", () => ({
  router: { push: runtime.navigate },
  useLocalSearchParams: () => runtime.params,
}));
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
  return [node, ...elements(node.props.children as ReactNode)];
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

  it("opens the newest eligible linked photo in the latest frame", () => {
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
    expect(button.props.accessibilityLabel).toContain("2 linked observations");
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
});
