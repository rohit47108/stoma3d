import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOUTH_REGIONS, type AnalysisResult } from "@stoma3d/contracts";
import type { CaptureRecord, ReportRecord, ScanSession } from "../src/types";

// Execute the real routes and handlers; native components and file work are
// controlled boundaries here. These tests are not a phone UI mount.
const runtime = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  store: {} as Record<string, unknown>,
  navigate: vi.fn(),
  generate: vi.fn(),
  share: vi.fn(),
  addReport: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => {
    const index = runtime.cursor++;
    if (!(index in runtime.slots)) runtime.slots[index] = initial;
    return [
      runtime.slots[index],
      (value: unknown) => {
        runtime.slots[index] =
          typeof value === "function" ? value(runtime.slots[index]) : value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = runtime.cursor++;
    runtime.slots[index] ??= { current: initial };
    return runtime.slots[index];
  },
}));
vi.mock("react-native", () => ({
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
  StyleSheet: { create: (styles: unknown) => styles },
}));
vi.mock("expo-router", () => ({
  router: { push: runtime.navigate, replace: runtime.navigate, back: vi.fn() },
}));
vi.mock("@/components/Screen", () => ({ Screen: "Screen" }));
vi.mock("@/components/Ui", () => ({
  Button: "Button",
  Card: "Card",
  ChoiceChip: "ChoiceChip",
  EmptyState: "EmptyState",
  SectionTitle: "SectionTitle",
}));
vi.mock("@/components/VisualTrajectoryChart", () => ({
  VisualTrajectoryChart: "TrajectoryChart",
}));
vi.mock("@/store/useStoma3DStore", () => ({
  useStoma3DStore: (select: (state: Record<string, unknown>) => unknown) =>
    select(runtime.store),
}));
vi.mock("@/theme", () => ({ useAppTheme: () => ({ fontScale: 1 }) }));
vi.mock("@/lib/report", () => ({
  generateEncryptedObservationReport: runtime.generate,
  shareEncryptedReport: runtime.share,
}));
vi.mock(
  "@/lib/longitudinalPolicy",
  () => import("../src/lib/longitudinalPolicy"),
);
vi.mock("@/lib/resultCopy", () => import("../src/lib/resultCopy"));
vi.mock("@/lib/trajectory", () => import("../src/lib/trajectory"));
vi.mock("@/lib/reportPolicy", () => import("../src/lib/reportPolicy"));
vi.mock("@/lib/scanLogic", () => import("../src/lib/scanLogic"));

import TimelineRoute from "../app/(tabs)/timeline";
import ReportRoute from "../app/report";

const session: ScanSession = {
  id: "scan-one",
  createdAt: "2026-10-12T12:00:00Z",
  demo: false,
  label: "Scan",
  protocol: "standard_eight_region",
};
function capture(
  region: CaptureRecord["region"],
  sessionId = session.id,
): CaptureRecord {
  return {
    id: `${sessionId}-${region}`,
    sessionId,
    region,
    angle: "primary",
    mediaKind: "image",
    capturedAt: "2026-10-12T12:00:00Z",
    encryptedUri: "protected.osv",
    mimeType: "image/jpeg",
    inputOrigin: "live_capture",
    captureSource: "photo_library",
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
}
function analysis(photo: CaptureRecord): AnalysisResult {
  return {
    captureId: photo.id,
    region: photo.region,
    quality: photo.quality,
    anatomyPrediction: {
      region: photo.region,
      confidence: 0.9,
      supported: true,
      selectedRegionMatches: true,
    },
    candidateMask: {
      polygon: [
        [0.1, 0.1],
        [0.3, 0.1],
        [0.2, 0.3],
      ],
      boundingBox: [0.1, 0.1, 0.2, 0.2],
      normalizedArea: 0.1,
    },
    descriptors: {
      normalizedArea: 0.1,
      perimeter: 0.4,
      borderIrregularity: 0.1,
      meanRedness: 0.5,
      meanBrightness: 0.5,
      textureContrast: 0.3,
      measurementLabel: "approximate",
    },
    uncertainty: {
      overallConfidence: 0.8,
      imageQualityConfidence: 0.9,
      datasetSimilarity: null,
      modelAgreement: null,
      limitations: ["Test metadata"],
    },
    abstentionReasons: [],
    modelVersions: { segmentation: "unit-test-only" },
    inputOrigin: "live_capture",
    analysisOrigin: "live_model",
    status: "complete",
  };
}
const report: ReportRecord = {
  id: "report-one",
  sessionId: session.id,
  createdAt: "2026-10-12T12:01:00Z",
  encryptedUri: "report.osv",
};
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [
    node,
    ...elements(node.props.action as ReactNode),
    ...elements(node.props.children as ReactNode),
  ];
}
function render(route: () => ReactNode) {
  runtime.cursor = 0;
  return route();
}
function button(tree: ReactNode, label: string) {
  return elements(tree).find(
    (element) => element.type === "Button" && element.props.label === label,
  );
}
function press(button: ReactElement<Record<string, unknown>> | undefined) {
  expect(button).toBeDefined();
  return (button!.props.onPress as () => unknown)();
}
beforeEach(() => {
  runtime.slots = [];
  runtime.navigate.mockReset();
  runtime.generate.mockReset();
  runtime.share.mockReset();
  runtime.addReport.mockReset();
  runtime.addReport.mockResolvedValue(undefined);
  const photos = MOUTH_REGIONS.map((region) => capture(region));
  runtime.store = {
    sessions: [session],
    captures: photos,
    analyses: Object.fromEntries(
      photos.map((photo) => [photo.id, analysis(photo)]),
    ),
    comparisons: [],
    pins: [],
    reports: [],
    activeSessionId: session.id,
    profile: null,
    consentedAt: "2026-10-12T11:59:00Z",
    addReport: runtime.addReport,
  };
});

describe("focused History", () => {
  it("opens with saved photos instead of comparison panels", () => {
    const tree = render(TimelineRoute);
    expect(
      elements(tree).find((element) => element.props.title === "Saved photos"),
    ).toBeDefined();
    expect(
      elements(tree).filter((element) => element.type === "Pressable"),
    ).toHaveLength(8);
    expect(
      elements(tree).find((element) => element.type === "TrajectoryChart"),
    ).toBeUndefined();
    expect(button(tree, "Compare two observations")).toBeUndefined();
  });

  it("keeps comparison tools available through an explicit disclosure", () => {
    press(button(render(TimelineRoute), "Tools"));
    const tree = render(TimelineRoute);
    expect(button(tree, "Compare photos")?.props.disabled).toBe(true);
    expect(
      elements(tree).find((element) => element.type === "TrajectoryChart"),
    ).toBeDefined();
    expect(button(tree, "Done")?.props.accessibilityState).toEqual({
      expanded: true,
    });
    press(button(tree, "Done"));
    expect(
      elements(render(TimelineRoute)).find(
        (element) => element.type === "TrajectoryChart",
      ),
    ).toBeUndefined();
  });

  it("preserves exact result IDs and does not reorder stored captures", () => {
    const photos = runtime.store.captures as CaptureRecord[];
    const before = photos.map((photo) => photo.id);
    const tree = render(TimelineRoute);
    const row = elements(tree).find((element) => element.type === "Pressable");
    expect(row).toBeDefined();
    (row!.props.onPress as () => void)();
    expect(runtime.navigate).toHaveBeenCalledWith({
      pathname: "/result/[captureId]",
      params: { captureId: photos[0].id },
    });
    expect(photos.map((photo) => photo.id)).toEqual(before);
  });

  it("enables comparison only for eligible photos of one region from separate scans", () => {
    const prior = capture("dorsal_tongue", "earlier-scan");
    (runtime.store.captures as CaptureRecord[]).push(prior);
    (runtime.store.analyses as Record<string, AnalysisResult>)[prior.id] =
      analysis(prior);
    press(button(render(TimelineRoute), "Tools"));
    const compare = button(render(TimelineRoute), "Compare photos");
    expect(compare?.props.disabled).toBe(false);
    press(compare);
    expect(runtime.navigate).toHaveBeenCalledWith("/compare");
  });
});

describe("focused report actions", () => {
  it("makes export the primary action after a protected report is ready", () => {
    runtime.store.reports = [report];
    const tree = render(ReportRoute);
    expect(button(tree, "Export PDF")).toBeDefined();
    expect(button(tree, "Export PDF")?.props.variant ?? "primary").toBe(
      "primary",
    );
    expect(button(tree, "Update report")?.props.variant).toBe("ghost");
  });

  it("does not generate a second report before the first tap can rerender", async () => {
    let finish: (value: ReportRecord) => void = () => undefined;
    runtime.generate.mockImplementation(
      () =>
        new Promise<ReportRecord>((resolve) => {
          finish = resolve;
        }),
    );
    const generate = elements(render(ReportRoute)).find(
      (element) =>
        element.type === "Button" &&
        element.props.icon === "document-lock-outline",
    );
    press(generate);
    press(generate);
    expect(runtime.generate).toHaveBeenCalledOnce();
    finish(report);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.addReport).toHaveBeenCalledOnce();
  });

  it("does not open two export sheets before a rerender", async () => {
    runtime.store.reports = [report];
    let finish: () => void = () => undefined;
    runtime.share.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const share = elements(render(ReportRoute)).find(
      (element) =>
        element.type === "Button" && element.props.icon === "share-outline",
    );
    press(share);
    press(share);
    expect(runtime.share).toHaveBeenCalledOnce();
    finish();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("does not export an old report while its replacement is being generated", async () => {
    runtime.store.reports = [report];
    let finish: (value: ReportRecord) => void = () => undefined;
    runtime.generate.mockImplementation(
      () =>
        new Promise<ReportRecord>((resolve) => {
          finish = resolve;
        }),
    );
    const tree = render(ReportRoute);
    const pending = press(button(tree, "Update report"));
    press(button(tree, "Export PDF"));
    expect(runtime.share).not.toHaveBeenCalled();
    finish(report);
    await pending;
  });

  it("releases the operation guard after a generation error so the user can retry", async () => {
    runtime.generate
      .mockRejectedValueOnce(new Error("Not enough storage"))
      .mockResolvedValueOnce(report);
    await press(button(render(ReportRoute), "Generate PDF"));
    const tree = render(ReportRoute);
    expect(
      elements(tree).find(
        (element) => element.props.accessibilityRole === "alert",
      )?.props.children,
    ).toBe("Not enough storage");
    await press(button(tree, "Generate PDF"));
    expect(runtime.generate).toHaveBeenCalledTimes(2);
    expect(runtime.addReport).toHaveBeenCalledOnce();
  });

  it("releases the operation guard after an export error so the user can retry", async () => {
    runtime.store.reports = [report];
    runtime.share
      .mockRejectedValueOnce(new Error("Export unavailable"))
      .mockResolvedValueOnce(undefined);
    await press(button(render(ReportRoute), "Export PDF"));
    const tree = render(ReportRoute);
    expect(
      elements(tree).find(
        (element) => element.props.accessibilityRole === "alert",
      )?.props.children,
    ).toBe("Export unavailable");
    await press(button(tree, "Export PDF"));
    expect(runtime.share).toHaveBeenCalledTimes(2);
  });
});
