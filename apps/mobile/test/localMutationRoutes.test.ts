import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  store: {} as Record<string, unknown>,
  activate: vi.fn(),
  saveSettings: vi.fn(),
  deleteEverything: vi.fn(),
  navigate: vi.fn(),
  alert: vi.fn(),
  next: { region: "dorsal_tongue", angle: "primary" } as Record<
    string,
    string
  > | null,
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = runtime.cursor++;
    if (!(index in runtime.slots)) runtime.slots[index] = initial;
    return [
      runtime.slots[index],
      (change: unknown) => {
        runtime.slots[index] =
          typeof change === "function" ? change(runtime.slots[index]) : change;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = runtime.cursor++;
    runtime.slots[index] ??= { current: initial };
    return runtime.slots[index];
  },
  useCallback: (callback: unknown) => callback,
}));
vi.mock("expo-router", () => ({
  router: { push: runtime.navigate, replace: runtime.navigate },
  useFocusEffect: () => undefined,
}));
vi.mock("react-native", () => ({
  Alert: { alert: runtime.alert },
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
vi.mock("@/components/Screen", () => ({ Screen: "Screen" }));
vi.mock("@/components/Ui", () => ({
  Button: "Button",
  Card: "Card",
  ChoiceChip: "ChoiceChip",
  EmptyState: "EmptyState",
  SectionTitle: "SectionTitle",
  ToggleRow: "ToggleRow",
}));
vi.mock("@/lib/scanLogic", () => ({
  detailedScanProgress: () => ({ completeRegions: 0 }),
  acceptedAngles: () => [],
  requiredAnglesForProtocol: () => ["primary"],
}));
vi.mock("@/lib/usabilityFlow", () => ({
  nextScanCapture: () => runtime.next,
  resumableSession: () => (runtime.store.sessions as unknown[])[0],
}));
vi.mock("@/lib/guidanceRules", () => ({ bundledGuidanceStatus: () => ({}) }));
vi.mock("@/store/useStoma3DStore", () => ({
  useStoma3DStore: (select: (state: Record<string, unknown>) => unknown) =>
    select(runtime.store),
}));
vi.mock("@/cloud/useCloudStore", () => ({
  useCloudStore: () => ({ sessionStatus: "signed_out", busy: false }),
}));
vi.mock("@/theme", () => ({ useAppTheme: () => ({ fontScale: 1 }) }));

import HomeRoute from "../app/(tabs)/home";
import ScanRoute from "../app/(tabs)/scan";
import SettingsRoute from "../app/(tabs)/settings";

function render(route: () => ReactNode) {
  runtime.cursor = 0;
  return route();
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [
    node,
    ...elements(node.props.children as ReactNode),
    ...elements(node.props.action as ReactNode),
  ];
}
function control(tree: ReactNode, label: string) {
  return elements(tree).find((element) => element.props.label === label)!;
}
function press(tree: ReactNode, label: string) {
  return (control(tree, label).props.onPress as () => unknown)();
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}
function hasError(tree: ReactNode, message: string) {
  return elements(tree).some(
    (element) =>
      element.props.accessibilityRole === "alert" &&
      element.props.children === message,
  );
}
beforeEach(() => {
  runtime.slots = [];
  runtime.activate.mockReset();
  runtime.saveSettings.mockReset();
  runtime.deleteEverything.mockReset();
  runtime.navigate.mockReset();
  runtime.alert.mockReset();
  runtime.next = { region: "dorsal_tongue", angle: "primary" };
  runtime.store = {
    sessions: [
      {
        id: "scan",
        demo: false,
        protocol: "standard_eight_region",
        createdAt: "2026-10-01T20:00:00Z",
      },
    ],
    captures: [],
    analyses: {},
    activeSessionId: "scan",
    settings: {},
    setActiveSession: runtime.activate,
    updateSettings: runtime.saveSettings,
    deleteEverything: runtime.deleteEverything,
  };
});

describe("durable local mutation UI boundaries", () => {
  it.each([
    ["Home", HomeRoute],
    ["Scan", ScanRoute],
  ] as const)(
    "%s waits for the scan switch before capture navigation and blocks duplicate taps",
    async (_, route) => {
      const pending = deferred();
      runtime.activate.mockReturnValue(pending.promise);
      const original = render(route);
      press(original, "Continue scan");
      press(original, "Continue scan");
      const navigationsWhilePending = runtime.navigate.mock.calls.length;
      const disabled = control(render(route), "Continue scan").props.disabled;
      pending.resolve();
      await flush();
      expect(navigationsWhilePending).toBe(0);
      expect(disabled).toBe(true);
      expect(runtime.activate).toHaveBeenCalledTimes(1);
      expect(runtime.navigate).toHaveBeenCalledWith({
        pathname: "/capture/[region]",
        params: runtime.next,
      });
    },
  );

  it.each([
    ["Home", HomeRoute],
    ["Scan", ScanRoute],
  ] as const)(
    "%s handles a failed scan switch visibly and allows retry",
    async (_, route) => {
      const pending = deferred();
      runtime.activate.mockReturnValue(pending.promise);
      const returned = press(render(route), "Continue scan");
      pending.reject(new Error("The selected scan could not be saved."));
      if (returned instanceof Promise) await returned.catch(() => undefined);
      await flush();
      expect(runtime.navigate).not.toHaveBeenCalled();
      expect(
        hasError(render(route), "The selected scan could not be saved."),
      ).toBe(true);
      expect(control(render(route), "Continue scan").props.disabled).toBe(
        false,
      );
    },
  );

  it("Scan waits for a saved active scan before report navigation", async () => {
    runtime.next = null;
    const pending = deferred();
    runtime.activate.mockReturnValue(pending.promise);
    press(render(ScanRoute), "Create report");
    const navigationsWhilePending = runtime.navigate.mock.calls.length;
    pending.resolve();
    await flush();
    expect(navigationsWhilePending).toBe(0);
    expect(runtime.navigate).toHaveBeenCalledWith("/report");
  });

  it("Scan blocks a different navigation from an old handler while its scan switch is saving", async () => {
    const pending = deferred();
    runtime.activate.mockReturnValue(pending.promise);
    const original = render(ScanRoute);
    press(original, "Continue scan");
    press(original, "View on 3D map");
    press(original, "Start a new scan");
    const navigationsWhilePending = runtime.navigate.mock.calls.length;
    pending.resolve();
    await flush();
    expect(navigationsWhilePending).toBe(0);
    expect(runtime.navigate).toHaveBeenCalledTimes(1);
  });

  it("Settings holds changes and deletion while a setting is saving and catches rejection", async () => {
    const pending = deferred();
    runtime.saveSettings.mockReturnValue(pending.promise);
    const original = render(SettingsRoute);
    const toggle = control(original, "High contrast");
    const change = toggle.props.onValueChange as (value: boolean) => unknown;
    const returned = change(true);
    change(false);
    press(original, "Delete local data only");
    press(original, "Open account options");
    const waiting = render(SettingsRoute);
    const disabled = control(waiting, "High contrast").props.disabled;
    const doneDisabled = control(waiting, "Done").props.disabled;
    pending.reject(new Error("The local settings could not be saved."));
    if (returned instanceof Promise) await returned.catch(() => undefined);
    await flush();
    expect(runtime.saveSettings).toHaveBeenCalledTimes(1);
    expect(runtime.alert).not.toHaveBeenCalled();
    expect(runtime.navigate).not.toHaveBeenCalled();
    expect(disabled).toBe(true);
    expect(doneDisabled).toBe(true);
    expect(
      hasError(render(SettingsRoute), "The local settings could not be saved."),
    ).toBe(true);
    expect(control(render(SettingsRoute), "High contrast").props.disabled).toBe(
      false,
    );
  });
});
