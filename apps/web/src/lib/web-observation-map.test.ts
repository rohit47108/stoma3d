import { describe, expect, it } from "vitest";
import { MOUTH_REGION_DETAILS } from "@stoma3d/contracts";
import {
  WEB_MAP_ASSET_VERSION,
  WEB_MAP_MESHES,
  webPinPosition,
} from "./web-observation-map";

describe("browser observation map metadata", () => {
  it("uses the same named meshes for all eight canonical regions", () => {
    for (const detail of MOUTH_REGION_DETAILS)
      expect(WEB_MAP_MESHES[detail.id]).toBe(detail.meshId);
    expect(WEB_MAP_ASSET_VERSION).toBe("procedural-v1");
  });

  it("derives world coordinates from versioned region and UV data", () => {
    const pin = {
      captureId: "capture-1",
      region: "dorsal_tongue" as const,
      meshId: "tongue_dorsal",
      uvX: 0.5,
      uvY: 0.5,
      assetVersion: WEB_MAP_ASSET_VERSION,
      confirmedAt: "2026-10-01T12:00:00.000Z",
    };
    expect(webPinPosition(pin)[0]).toBe(0);
    expect(webPinPosition(pin)[1]).toBe(-0.36);
    expect(webPinPosition(pin)[2]).toBeCloseTo(0.735);
    expect(() => webPinPosition({ ...pin, meshId: "lip_upper" })).toThrow(
      "version",
    );
  });
});
