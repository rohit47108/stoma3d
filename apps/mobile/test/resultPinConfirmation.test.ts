import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  DISCLAIMER,
  type AnalysisResult,
} from "@stoma3d/contracts";
import type { CaptureRecord } from "../src/types";

// Exercise the real result handlers with persistent hook slots. Native rendering,
// image previews and lifecycle effects are intentionally outside this test.
const runtime = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  store: {} as Record<string, unknown>,
  confirm: vi.fn(),
  activate: vi.fn(),
  navigate: vi.fn(),
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
  useMemo: (calculate: () => unknown) => calculate(),
  useEffect: () => undefined,
}));
vi.mock("expo-router", () => ({
  router: {
    push: runtime.navigate,
    replace: runtime.navigate,
    back: runtime.navigate,
  },
  useLocalSearchParams: () => ({ captureId: "saved-photo" }),
}));
vi.mock("react-native", () => ({
  Alert: {},
  AppState: {},
  Image: "Image",
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Ionicons" }));
vi.mock("@/constants", () => ({
  DISCLAIMER: "This result is not a diagnosis.",
}));
vi.mock("@/components/MaskOverlay", () => ({ MaskOverlay: "MaskOverlay" }));
vi.mock("@/components/Screen", () => ({ Screen: "Screen" }));
vi.mock("@/components/Ui", () => ({
  Button: "Button",
  Card: "Card",
  MetricBar: "MetricBar",
  SectionTitle: "SectionTitle",
}));
vi.mock("@/lib/api", () => ({ analyzeCapture: vi.fn() }));
vi.mock("@/lib/analysisPresentation", () => ({
  ADDITIONAL_ANALYSIS_TITLE: "Additional analysis",
  isReleasedModelOutput: () => false,
}));
vi.mock("@/lib/analysisPolicy", () => ({
  captureAnalysisRetryDisposition: vi.fn(),
  captureStorageRejectionReasons: vi.fn(),
}));
vi.mock("@/lib/guidanceRules", () => ({
  evaluateBundledGuidance: () => ({
    enabled: false,
    message: "Seek advice when needed.",
  }),
}));
vi.mock("@/lib/notifications", () => ({
  scheduleObservationReminder: vi.fn(),
}));
vi.mock("@/lib/reminderPolicy", () => ({
  reminderSuggestion: () => ({ delayDays: 7 }),
}));
vi.mock("@/lib/resultCopy", () => ({
  analysisStatusTitle: () => "Analysis complete",
  humanizeResultReason: (reason: string) => reason,
}));
vi.mock("@/lib/usabilityFlow", async () => ({
  ...(await import("../src/lib/usabilityFlow")),
  nextScanCapture: () => null,
}));
vi.mock("@/lib/secureFiles", () => ({
  decryptToTemporaryFile: vi.fn(),
  removeTemporaryFile: vi.fn(),
}));
vi.mock("@/store/useStoma3DStore", () => ({
  useStoma3DStore: (select: (state: Record<string, unknown>) => unknown) =>
    select(runtime.store),
}));
vi.mock("@/theme", () => ({ useAppTheme: () => ({ fontScale: 1 }) }));

import ResultRoute from "../app/result/[captureId]";

const capture: CaptureRecord = {
  id: "saved-photo",
  sessionId: "scan",
  region: "dorsal_tongue",
  angle: "primary",
  mediaKind: "image",
  capturedAt: "2026-10-01T20:00:00Z",
  encryptedUri: "file:///documents/stoma3d-vault/saved-photo.osv",
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
};
const analysis: AnalysisResult = {
  contractVersion: CONTRACT_VERSION,
  captureId: capture.id,
  region: capture.region,
  quality: capture.quality,
  anatomyPrediction: {
    region: capture.region,
    confidence: 0.9,
    supported: true,
    selectedRegionMatches: true,
  },
  candidateMask: {
    polygon: [
      [0.1, 0.1],
      [0.2, 0.1],
      [0.2, 0.2],
    ],
    boundingBox: [0.1, 0.1, 0.1, 0.1],
    normalizedArea: 0.01,
  },
  descriptors: null,
  appearanceOutput: null,
  diseaseResearchOutput: null,
  uncertainty: {
    overallConfidence: 0.8,
    imageQualityConfidence: 0.9,
    datasetSimilarity: null,
    modelAgreement: null,
    limitations: [],
  },
  abstentionReasons: [],
  modelVersions: { segmentation: "test" },
  inputOrigin: "live_capture",
  analysisOrigin: "live_model",
  status: "complete",
  disclaimer: DISCLAIMER,
};

function renderRoute() {
  runtime.cursor = 0;
  return ResultRoute();
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
function button(tree: ReactNode, label: string) {
  return elements(tree).find((element) => element.props.label === label)!;
}
function press(element: ReactElement<Record<string, unknown>>) {
  return (element.props.onPress as () => unknown)();
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

beforeEach(() => {
  runtime.slots = [];
  runtime.confirm.mockReset();
  runtime.activate.mockReset();
  runtime.activate.mockResolvedValue(undefined);
  runtime.navigate.mockReset();
  runtime.store = {
    captures: [capture],
    analyses: { [capture.id]: analysis },
    pins: [],
    comparisons: [],
    sessions: [{ id: capture.sessionId, protocol: "standard_eight_region" }],
    profile: null,
    confirmObservationPin: runtime.confirm,
    setActiveSession: runtime.activate,
    updateCaptureAnalysis: vi.fn(),
    discardCapture: vi.fn(),
  };
});

describe("result pin confirmation persistence", () => {
  it("waits for the active scan to commit before opening a report and blocks duplicate taps", async () => {
    const pending = deferred();
    runtime.activate.mockReturnValue(pending.promise);
    const createReport = button(renderRoute(), "Create report");
    press(createReport);
    press(createReport);
    const navigationsWhilePending = runtime.navigate.mock.calls.length;
    const disabled = button(renderRoute(), "Back").props.disabled;
    pending.resolve();
    await flush();
    expect(navigationsWhilePending).toBe(0);
    expect(disabled).toBe(true);
    expect(runtime.activate).toHaveBeenCalledTimes(1);
    expect(runtime.navigate).toHaveBeenCalledWith("/report");
  });

  it("shows a failed scan switch and does not navigate to an unsaved report context", async () => {
    const pending = deferred();
    runtime.activate.mockReturnValue(pending.promise);
    const returned = press(button(renderRoute(), "Create report"));
    pending.reject(new Error("The selected scan could not be saved."));
    if (returned instanceof Promise) await returned.catch(() => undefined);
    await flush();
    expect(runtime.navigate).not.toHaveBeenCalled();
    expect(
      elements(renderRoute()).some(
        (element) =>
          element.props.accessibilityRole === "alert" &&
          element.props.children === "The selected scan could not be saved.",
      ),
    ).toBe(true);
    expect(button(renderRoute(), "Create report").props.disabled).toBe(false);
  });

  it("blocks an immediate duplicate confirmation before a render", async () => {
    const pending = deferred();
    runtime.confirm.mockReturnValue(pending.promise);
    const confirm = button(renderRoute(), "Add observation to map");
    press(confirm);
    press(confirm);
    pending.resolve();
    await flush();
    expect(runtime.confirm).toHaveBeenCalledTimes(1);
  });

  it("shows the pending save and blocks result navigation until confirmation commits", async () => {
    const pending = deferred();
    runtime.confirm.mockReturnValue(pending.promise);
    const original = renderRoute();
    press(button(original, "Add observation to map"));
    const waiting = renderRoute();
    const confirmation = button(waiting, "Add observation to map");
    const labels = ["Back", "Create report", "View on 3D map"];
    const disabled = labels.map(
      (label) => button(waiting, label).props.disabled,
    );
    labels.forEach((label) => press(button(original, label)));
    const loading = confirmation.props.loading;
    const navigations = runtime.navigate.mock.calls.length;
    pending.resolve();
    await flush();
    expect(loading).toBe(true);
    expect(disabled).toEqual([true, true, true]);
    expect(navigations).toBe(0);
    expect(button(renderRoute(), "View on 3D map").props.disabled).toBe(false);
  });

  it("handles a rejected pin save visibly and allows an explicit retry", async () => {
    const pending = deferred();
    runtime.confirm.mockReturnValue(pending.promise);
    const returned = press(button(renderRoute(), "Add observation to map"));
    pending.reject(new Error("The map location could not be saved."));
    // The old direct handler returns the raw rejected promise. Catch it here
    // so RED stays focused on the missing visible error, not an unhandled error.
    if (returned instanceof Promise) await returned.catch(() => undefined);
    await flush();
    const tree = renderRoute();
    expect(
      elements(tree).find(
        (element) => element.props.accessibilityRole === "alert",
      )?.props.children,
    ).toBe("The map location could not be saved.");
    expect(button(tree, "Add observation to map").props.loading).toBe(false);
    runtime.confirm.mockResolvedValue(undefined);
    press(button(tree, "Add observation to map"));
    await flush();
    expect(runtime.confirm).toHaveBeenCalledTimes(2);
  });

  it("sends a fresh navigation event when the same saved result opens the map again", () => {
    press(button(renderRoute(), "View on 3D map"));
    press(button(renderRoute(), "View on 3D map"));
    const [first, second] = runtime.navigate.mock.calls.map((call) => call[0]);
    expect(first).toMatchObject({
      pathname: "/(tabs)/map",
      params: { captureId: capture.id, region: capture.region },
    });
    expect(second.params.mapRequestId).not.toBe(first.params.mapRequestId);
  });
});
