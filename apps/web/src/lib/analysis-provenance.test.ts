import { describe, expect, it } from "vitest";
import { analysisOriginLabel, inputOriginLabel } from "./analysis-provenance";

describe("analysis provenance wording", () => {
  it("does not call unavailable analysis a live model result", () => {
    expect(analysisOriginLabel("unavailable")).toBe("unavailable");
  });

  it("names live, cached, and manually prepared outputs accurately", () => {
    expect(analysisOriginLabel("live_model")).toBe("live model");
    expect(analysisOriginLabel("cached_model_result")).toBe(
      "cached model result",
    );
    expect(analysisOriginLabel("manual_fixture")).toBe(
      "manually prepared example",
    );
  });

  it("distinguishes a user's photo from a bundled example", () => {
    expect(inputOriginLabel("live_capture")).toBe("your photo");
    expect(inputOriginLabel("bundled_demo")).toBe("bundled example");
  });
});
