import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOUTH_REGIONS } from "@stoma3d/contracts";
import type { CaptureRecord, ScanSession } from "../src/types";

// Use the real Home route and scan progression. Only native boundaries are
// controlled here; these checks do not replace mounting the app on a phone.
const runtime = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  store: {} as Record<string, unknown>,
  navigate: vi.fn(),
  activate: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => {
    const index = runtime.cursor++;
    if (!(index in runtime.slots)) runtime.slots[index] = initial;
    return [
      runtime.slots[index],
      (value: unknown) => {
        runtime.slots[index] = value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = runtime.cursor++;
    runtime.slots[index] ??= { current: initial };
    return runtime.slots[index];
  },
}));
vi.mock("expo-router", () => ({
  router: { push: runtime.navigate },
  useFocusEffect: () => undefined,
}));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("@/components/Screen", () => ({ Screen: "Screen" }));
vi.mock("@/components/Ui", () => ({
  Button: "Button",
  SectionTitle: "SectionTitle",
}));
vi.mock("@/lib/scanLogic", () => import("../src/lib/scanLogic"));
vi.mock("@/lib/usabilityFlow", () => import("../src/lib/usabilityFlow"));
vi.mock("@/store/useStoma3DStore", () => ({
  useStoma3DStore: (select: (state: Record<string, unknown>) => unknown) =>
    select(runtime.store),
}));
vi.mock("@/theme", () => ({ useAppTheme: () => ({ fontScale: 1 }) }));

import HomeRoute from "../app/(tabs)/home";

const session: ScanSession = {
  id: "saved-scan",
  createdAt: "2026-10-10T12:00:00Z",
  demo: false,
  label: "Scan",
  protocol: "standard_eight_region",
};
const capture = (region: CaptureRecord["region"]): CaptureRecord => ({
  id: `saved-${region}`,
  sessionId: session.id,
  region,
  angle: "primary",
  mediaKind: "image",
  capturedAt: "2026-10-10T12:00:00Z",
  encryptedUri: "protected.osv",
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
function render() {
  runtime.cursor = 0;
  return HomeRoute();
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function hasText(tree: ReactNode, value: string) {
  return elements(tree).some(
    (element) => element.type === "Text" && element.props.children === value,
  );
}
function button(tree: ReactNode, label: string) {
  return elements(tree).find((element) => element.props.label === label)!;
}
beforeEach(() => {
  runtime.slots = [];
  runtime.navigate.mockReset();
  runtime.activate.mockReset();
  runtime.store = {
    sessions: [],
    captures: [],
    analyses: {},
    activeSessionId: null,
    setActiveSession: runtime.activate,
  };
});

describe("Home scan states", () => {
  it("offers a first scan when no personal scans are saved", () => {
    const tree = render();
    expect(hasText(tree, "Your first scan")).toBe(true);
    expect(button(tree, "Start scan")).toBeDefined();
  });
  it("does not treat a demo session as a previous personal scan", () => {
    runtime.store.sessions = [{ ...session, demo: true }];
    expect(hasText(render(), "Your first scan")).toBe(true);
  });
  it("offers the next scan after reopening a completed eight-region scan", () => {
    runtime.store.sessions = [session];
    runtime.store.captures = MOUTH_REGIONS.map(capture);
    const tree = render();
    expect(hasText(tree, "Your next scan")).toBe(true);
    expect(hasText(tree, "Your first scan")).toBe(false);
    expect(button(tree, "Start scan")).toBeDefined();
  });
  it("continues the missing eighth region after reopening a partial scan", async () => {
    runtime.store.sessions = [session];
    runtime.store.captures = MOUTH_REGIONS.slice(0, 7).map(capture);
    const tree = render();
    expect(hasText(tree, "Your scan is waiting")).toBe(true);
    expect(hasText(tree, "7 of 8 regions saved")).toBe(true);
    (button(tree, "Continue scan").props.onPress as () => void)();
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.activate).toHaveBeenCalledWith(session.id);
    expect(runtime.navigate).toHaveBeenCalledWith({
      pathname: "/capture/[region]",
      params: { region: "lower_dental_arch", angle: "primary" },
    });
  });
  it("returns to first-scan wording when personal records have been cleared", () => {
    runtime.store.sessions = [session];
    runtime.store.captures = MOUTH_REGIONS.map(capture);
    render();
    runtime.store.sessions = [];
    runtime.store.captures = [];
    runtime.store.analyses = {};
    expect(hasText(render(), "Your first scan")).toBe(true);
  });
  it("opens the latest completed result after saved records are restored out of order", () => {
    const earlier = {
      ...capture("dorsal_tongue"),
      capturedAt: "2026-10-09T12:00:00Z",
    };
    const latest = {
      ...capture("lower_dental_arch"),
      capturedAt: "2026-10-10T13:00:00Z",
    };
    const restored = [latest, earlier];
    runtime.store.sessions = [session];
    runtime.store.captures = restored;
    runtime.store.analyses = {
      [earlier.id]: { status: "complete" },
      [latest.id]: { status: "complete" },
    };
    const tree = render();
    const result = elements(tree).find(
      (element) =>
        element.props.accessibilityLabel ===
        "Open Lower dental arch and gums result",
    );
    expect(result).toBeDefined();
    (result!.props.onPress as () => void)();
    expect(runtime.navigate).toHaveBeenCalledWith({
      pathname: "/result/[captureId]",
      params: { captureId: latest.id },
    });
    expect(restored.map((item) => item.id)).toEqual([latest.id, earlier.id]);
  });
  it("does not present a failed or abstained request as a recent result", () => {
    const failed = capture("dorsal_tongue");
    const abstained = capture("ventral_tongue");
    runtime.store.sessions = [session];
    runtime.store.captures = [failed, abstained];
    runtime.store.analyses = {
      [failed.id]: { status: "failed" },
      [abstained.id]: { status: "abstained" },
    };
    expect(
      elements(render()).some(
        (element) => element.props.title === "Recent result",
      ),
    ).toBe(false);
  });
});
