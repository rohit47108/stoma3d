import { describe, expect, it } from "vitest";
import { MOUTH_REGIONS } from "@stoma3d/contracts";
import {
  DEMO_STEPS,
  demoTransition,
  initialDemoState,
  sampleCase,
} from "./demo-tour";
import { guestSessionSchema } from "./guest-scan";

describe("the isolated sample tour", () => {
  it("visits each canonical region exactly once before results", () => {
    expect(
      DEMO_STEPS.filter((step) => step.kind === "region").map(
        (step) => step.region,
      ),
    ).toEqual(MOUTH_REGIONS);
    expect(DEMO_STEPS.map((step) => step.kind).slice(-6)).toEqual([
      "results",
      "map",
      "history",
      "compare",
      "report",
      "finish",
    ]);
  });
  it("bounds back, next, and skip without wrapping the tour", () => {
    let state = initialDemoState();
    expect(demoTransition(state, "back").index).toBe(0);
    state = demoTransition(state, "skip");
    expect(state.index).toBe(1);
    for (let i = 0; i < 50; i++) state = demoTransition(state, "next");
    expect(state.index).toBe(DEMO_STEPS.length - 1);
  });
  it("restarts only the tour, including the comparison confirmation", () => {
    const state = { index: 12, matchConfirmed: true };
    expect(demoTransition(state, "restart")).toEqual(initialDemoState());
    expect(demoTransition(state, "back").matchConfirmed).toBe(true);
  });
  it("identifies prepared image and analysis provenance, not live model output", () => {
    expect(sampleCase.inputOrigin).toBe("synthetic_sample");
    expect(sampleCase.analysisOrigin).toBe("manual_fixture");
    expect(sampleCase.observations[0].region).toBe("left_buccal_mucosa");
    expect(guestSessionSchema.safeParse(sampleCase).success).toBe(false);
  });
});
