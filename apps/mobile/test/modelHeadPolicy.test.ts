import { describe, expect, it } from "vitest";
import { requestedHeadsForScan } from "../src/lib/modelHeadPolicy";

describe("automatic model selection", () => {
  it("requests released image heads without optional research output", () => {
    expect(
      requestedHeadsForScan({
        enabledHeads: [
          "segmentation",
          "anatomy",
          "appearance",
          "disease_research",
          "lesion_reidentification",
        ],
      }),
    ).toEqual(["segmentation", "anatomy", "appearance"]);
  });
  it("never adds disabled quality heads or research heads", () => {
    expect(
      requestedHeadsForScan({ enabledHeads: ["segmentation", "anatomy"] }),
    ).toEqual(["segmentation", "anatomy"]);
  });
});
