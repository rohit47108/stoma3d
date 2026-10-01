import type { ModelCard, ModelHead } from "@stoma3d/contracts";

const SCAN_HEADS: readonly ModelHead[] = [
  "segmentation",
  "anatomy",
  "quality_control",
  "oral_tissue_segmentation",
  "out_of_distribution",
  "secondary_segmentation",
  "appearance",
];

export function requestedHeadsForScan(
  card: Pick<ModelCard, "enabledHeads">,
): ModelHead[] {
  return SCAN_HEADS.filter((head) => card.enabledHeads.includes(head));
}
