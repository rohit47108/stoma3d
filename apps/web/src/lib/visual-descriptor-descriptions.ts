import type { VisualDescriptors } from "@stoma3d/contracts";

export function visualDescriptorDescriptions(descriptors: VisualDescriptors) {
  return [
    {
      label: "Color",
      description:
        descriptors.meanRedness > 0.6 ? "Redder tone" : "Mixed tissue tone",
    },
    {
      label: "Border",
      description:
        descriptors.borderIrregularity > 1.5
          ? "Uneven outline"
          : "Relatively even outline",
    },
    {
      label: "Texture",
      description:
        descriptors.textureContrast > 0.3
          ? "More varied surface texture"
          : "More even surface texture",
    },
  ];
}
