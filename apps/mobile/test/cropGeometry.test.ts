import { describe, expect, it } from "vitest";
import { cropToPixels, moveCrop, resizeCrop } from "../src/lib/cropGeometry";

describe("mouth-only crop", () => {
  it("keeps movement inside the image", () => {
    expect(
      moveCrop({ x: 0.2, y: 0.2, width: 0.5, height: 0.4 }, 1, -1),
    ).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.4 });
  });
  it("keeps a resized crop in bounds", () => {
    const crop = resizeCrop({ x: 0.6, y: 0.6, width: 0.3, height: 0.3 }, 2);
    expect(crop.x + crop.width).toBeLessThanOrEqual(1);
    expect(crop.y + crop.height).toBeLessThanOrEqual(1);
  });
  it("uses unmirrored image pixel coordinates", () => {
    expect(
      cropToPixels({ x: 0.1, y: 0.3, width: 0.8, height: 0.5 }, 1000, 800),
    ).toEqual({ originX: 100, originY: 240, width: 800, height: 400 });
  });
});
