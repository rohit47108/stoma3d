import type { MouthRegion } from "@stoma3d/contracts";
import type { PerspectiveCamera } from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import asset from "../../../../assets/mouth/manifest.json";
import type { GuestPin } from "./guest-scan";

export const WEB_MAP_ASSET_VERSION = asset.assetVersion;
export const WEB_MAP_MESHES = Object.fromEntries(
  asset.targetRegions.map((region) => [region.regionId, region.meshId]),
) as Record<MouthRegion, string>;
// Coordinates and scale are the procedural-v1 surface shared with the native map.
export const WEB_REGION_POSITIONS: Record<
  MouthRegion,
  [number, number, number]
> = {
  dorsal_tongue: [0, -0.36, 0.28],
  ventral_tongue: [0, -0.72, -0.02],
  left_buccal_mucosa: [-1.02, 0, 0],
  right_buccal_mucosa: [1.02, 0, 0],
  upper_lip: [0, 0.82, 0.34],
  lower_lip: [0, -1.03, 0.32],
  upper_dental_arch: [0, 0.45, -0.02],
  lower_dental_arch: [0, -0.52, -0.2],
};
export const WEB_REGION_SCALES: Record<MouthRegion, [number, number, number]> =
  {
    dorsal_tongue: [1.15, 0.72, 0.42],
    ventral_tongue: [0.72, 0.26, 0.3],
    left_buccal_mucosa: [0.42, 1.26, 0.6],
    right_buccal_mucosa: [0.42, 1.26, 0.6],
    upper_lip: [1.48, 0.26, 0.35],
    lower_lip: [1.35, 0.26, 0.35],
    upper_dental_arch: [1.1, 0.26, 0.25],
    lower_dental_arch: [1.08, 0.24, 0.25],
  };

export function webPinPosition(pin: GuestPin): [number, number, number] {
  if (
    pin.assetVersion !== WEB_MAP_ASSET_VERSION ||
    pin.meshId !== WEB_MAP_MESHES[pin.region]
  )
    throw new Error("This observation belongs to another map version.");
  const base = WEB_REGION_POSITIONS[pin.region],
    scale = WEB_REGION_SCALES[pin.region];
  return [
    base[0] + (pin.uvX - 0.5) * scale[0] * 0.65,
    base[1] + (0.5 - pin.uvY) * scale[1] * 0.65,
    base[2] + 0.35 + scale[2] * 0.25,
  ];
}

export function zoomWebObservationMap(
  camera: PerspectiveCamera,
  controls: OrbitControls,
  direction: 1 | -1,
): void {
  const offset = camera.position.clone().sub(controls.target);
  offset
    .multiplyScalar(direction > 0 ? 0.9 : 1.1)
    .clampLength(controls.minDistance, controls.maxDistance);
  camera.position.copy(controls.target).add(offset);
  // Manual camera transforms must update the orbit state before rendering.
  // https://threejs.org/docs/pages/OrbitControls.html
  controls.update();
}
