import { MOUTH_REGIONS, type MouthRegion } from "@stoma3d/contracts";

export type DemoStep =
  | { kind: "region"; region: MouthRegion; title: string }
  | {
      kind:
        | "welcome"
        | "results"
        | "map"
        | "history"
        | "compare"
        | "report"
        | "finish";
      title: string;
    };

export const DEMO_STEPS: readonly DemoStep[] = [
  { kind: "welcome", title: "A clearer view of your mouth" },
  ...MOUTH_REGIONS.map((region) => ({
    kind: "region" as const,
    region,
    title: "Review photo",
  })),
  { kind: "results", title: "Your scan, brought together" },
  { kind: "map", title: "Put observations in context" },
  { kind: "history", title: "A record you can return to" },
  { kind: "compare", title: "See what changed" },
  { kind: "report", title: "Take the record with you" },
  { kind: "finish", title: "Ready for your own scan" },
];

export interface DemoState {
  index: number;
  matchConfirmed: boolean;
}
export function initialDemoState(): DemoState {
  return { index: 0, matchConfirmed: false };
}
export function demoTransition(
  state: DemoState,
  action: "next" | "back" | "skip" | "restart",
): DemoState {
  if (action === "restart") return initialDemoState();
  return {
    ...state,
    index: Math.max(
      0,
      Math.min(
        DEMO_STEPS.length - 1,
        state.index + (action === "back" ? -1 : 1),
      ),
    ),
  };
}

// Authored presentation data, deliberately NOT an AnalysisResult or GuestSession.
// Values illustrate the interface; they are not model predictions or measurements.
export const sampleCase = {
  id: "stoma3d-synthetic-tour-v1",
  inputOrigin: "synthetic_sample",
  analysisOrigin: "manual_fixture",
  image: "/samples/mouth-regions-v1.png",
  currentDate: "2026-10-17",
  baselineDate: "2026-10-03",
  observations: [
    {
      id: "sample-left-cheek-observation",
      region: "left_buccal_mucosa" as MouthRegion,
      description: "Small red area",
      shape: "Rounded, soft edge",
      texture: "Smooth surface",
      color: "Redder than surrounding tissue",
      currentAreaPercent: 3.2,
      baselineAreaPercent: 4.0,
      mask: { x: 0.52, y: 0.37, width: 0.202, height: 0.202 },
    },
  ],
} as const;

export function sampleRegionPosition(region: MouthRegion) {
  const i = MOUTH_REGIONS.indexOf(region);
  return `${(i % 4) * (100 / 3)}% ${i < 4 ? 0 : 100}%`;
}

export const DEMO_CHAPTERS = [
  { label: "Start", index: 0 },
  { label: "Photos", index: 1 },
  { label: "Results", index: 9 },
  { label: "3D map", index: 10 },
  { label: "History", index: 11 },
  { label: "Compare", index: 12 },
  { label: "Report", index: 13 },
] as const;
