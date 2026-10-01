import type { AnalysisOrigin, InputOrigin } from "@stoma3d/contracts";

const analysisLabels: Record<AnalysisOrigin, string> = {
  live_model: "live model",
  cached_model_result: "cached model result",
  manual_fixture: "manually prepared example",
  unavailable: "unavailable",
};

export function analysisOriginLabel(origin: AnalysisOrigin): string {
  return analysisLabels[origin];
}

export function inputOriginLabel(origin: InputOrigin): string {
  return origin === "live_capture" ? "your photo" : "bundled example";
}
