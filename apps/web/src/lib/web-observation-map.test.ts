import { describe, expect, it } from "vitest";
import { MOUTH_REGION_DETAILS } from "@stoma3d/contracts";
import { PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  WEB_MAP_ASSET_VERSION,
  WEB_MAP_MESHES,
  webPinPosition,
  zoomWebObservationMap,
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

describe("browser observation map zoom", () => {
  it("keeps repeated zoom-in presses at the nearest allowed distance", () => {
    const camera = new PerspectiveCamera();
    const controls = new OrbitControls(camera);
    controls.target.set(0, -0.1, 0);
    controls.minDistance = 2.8;
    controls.maxDistance = 7;
    camera.position.set(0, 0.1, 4.5);
    controls.update();

    for (let press = 0; press < 200; press++)
      zoomWebObservationMap(camera, controls, 1);

    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(2.8);
  });

  it("keeps repeated zoom-out presses at the farthest allowed distance", () => {
    const camera = new PerspectiveCamera();
    const controls = new OrbitControls(camera);
    controls.target.set(0, -0.1, 0);
    controls.minDistance = 2.8;
    controls.maxDistance = 7;
    camera.position.set(0, 0.1, 4.5);
    controls.update();

    for (let press = 0; press < 200; press++)
      zoomWebObservationMap(camera, controls, -1);

    expect(camera.position.distanceTo(controls.target)).toBeCloseTo(7);
  });

  it("zooms around the orbit target without changing the viewing angle", () => {
    const camera = new PerspectiveCamera();
    const controls = new OrbitControls(camera);
    const target = new Vector3(1, -0.1, 2);
    controls.target.copy(target);
    controls.minDistance = 2.8;
    controls.maxDistance = 7;
    camera.position.copy(target).add(new Vector3(2, 1, 3));
    controls.update();
    const before = camera.position.clone().sub(target);
    const orientation = camera.quaternion.clone();

    zoomWebObservationMap(camera, controls, 1);

    const after = camera.position.clone().sub(target);
    expect(after.length()).toBeCloseTo(before.length() * 0.9);
    expect(
      after.clone().normalize().distanceTo(before.normalize()),
    ).toBeCloseTo(0);
    expect(camera.quaternion.angleTo(orientation)).toBeCloseTo(0);
    expect(
      new Vector3()
        .setFromMatrixPosition(camera.matrixWorld)
        .distanceTo(camera.position),
    ).toBeCloseTo(0);
    expect(controls.getDistance()).toBeCloseTo(after.length());
    expect(controls.target.equals(target)).toBe(true);
  });
});
