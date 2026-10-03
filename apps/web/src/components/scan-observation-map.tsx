"use client";

import { useEffect, useRef, useState } from "react";
import { MOUTH_REGION_DETAILS, type MouthRegion } from "@stoma3d/contracts";
import type {
  Group,
  Mesh,
  MeshStandardMaterial,
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
} from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  WEB_MAP_MESHES,
  WEB_REGION_POSITIONS,
  WEB_REGION_SCALES,
  webPinPosition,
  rotateWebObservationMap,
  zoomWebObservationMap,
  type WebMapRotation,
} from "@/lib/web-observation-map";
import type { GuestPin } from "@/lib/guest-scan";

interface Props {
  completed: readonly MouthRegion[];
  selected: MouthRegion;
  pins: readonly GuestPin[];
  onSelect: (region: MouthRegion) => void;
}
interface MapRuntime {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  regions: Map<MouthRegion, Mesh>;
  pins: Group;
  draw: () => void;
}

const ROTATION_KEYS: Record<string, WebMapRotation | undefined> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

export function ScanObservationMap({
  completed,
  selected,
  pins,
  onSelect,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const runtime = useRef<MapRuntime | null>(null);
  const selectRef = useRef(onSelect);
  const [state, setState] = useState<"loading" | "ready" | "fallback">(
    "loading",
  );
  useEffect(() => {
    selectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    const mount = mountRef.current;
    if (!mount) return;
    void Promise.all([
      import("three"),
      import("three/examples/jsm/controls/OrbitControls.js"),
    ])
      .then(([THREE, { OrbitControls }]) => {
        if (cancelled) return;
        const renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0xf0f5f2, 1);
        renderer.domElement.setAttribute(
          "aria-label",
          "Interactive oral map. Drag or use arrow keys to rotate. Use the zoom controls to zoom. Select regions in the list.",
        );
        renderer.domElement.setAttribute("role", "img");
        renderer.domElement.tabIndex = 0;
        mount.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
        camera.position.set(0, 0.1, 4.5);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enablePan = false;
        controls.minDistance = 2.8;
        controls.maxDistance = 7;
        controls.target.set(0, -0.1, 0);
        const draw = () => renderer.render(scene, camera);
        const regions = new Map<MouthRegion, Mesh>();
        const sphere = (
          name: string,
          position: [number, number, number],
          scale: [number, number, number],
          color: number,
          opacity = 1,
        ) => {
          const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.55, 32, 20),
            new THREE.MeshStandardMaterial({
              color,
              roughness: 0.7,
              transparent: opacity < 1,
              opacity,
            }),
          );
          mesh.name = name;
          mesh.position.set(...position);
          mesh.scale.set(...scale);
          scene.add(mesh);
          return mesh;
        };
        sphere(
          "posterior-oral-wall",
          [0, -0.02, -0.8],
          [1.2, 1.6, 0.3],
          0x743a48,
          0.65,
        );
        sphere(
          "floor-of-mouth",
          [0, -0.55, -0.4],
          [1.5, 0.62, 0.2],
          0xa95f68,
          0.8,
        );
        for (const region of MOUTH_REGION_DETAILS) {
          const mesh = sphere(
            WEB_MAP_MESHES[region.id],
            WEB_REGION_POSITIONS[region.id],
            WEB_REGION_SCALES[region.id],
            0xc5848b,
          );
          mesh.userData.region = region.id;
          regions.set(region.id, mesh);
        }
        for (let i = 0; i < 11; i++) {
          const angle = Math.PI * (0.08 + (i / 10) * 0.84),
            x = Math.cos(angle) * 0.88,
            curve = Math.sin(angle);
          sphere(
            `upper-tooth-${i + 1}`,
            [x, 0.42 + curve * 0.17, 0.22],
            [0.2, 0.31, 0.16],
            0xf4ebdd,
          );
          sphere(
            `lower-tooth-${i + 1}`,
            [x, -0.48 - curve * 0.14, 0.2],
            [0.18, 0.27, 0.15],
            0xf4ebdd,
          );
        }
        scene.add(new THREE.HemisphereLight(0xffffff, 0x706368, 2.3));
        const light = new THREE.DirectionalLight(0xffffff, 2);
        light.position.set(2, 3, 5);
        scene.add(light);
        const pinGroup = new THREE.Group();
        scene.add(pinGroup);
        runtime.current = {
          renderer,
          scene,
          camera,
          controls,
          regions,
          pins: pinGroup,
          draw,
        };
        const resize = () => {
          const width = mount.clientWidth,
            height = mount.clientHeight || 420;
          renderer.setSize(width, height);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          draw();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(mount);
        const raycaster = new THREE.Raycaster();
        let down = { x: 0, y: 0 };
        const pointerDown = (event: PointerEvent) => {
          down = { x: event.clientX, y: event.clientY };
        };
        const pointerUp = (event: PointerEvent) => {
          if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8)
            return;
          const bounds = renderer.domElement.getBoundingClientRect();
          raycaster.setFromCamera(
            new THREE.Vector2(
              ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
              (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
            ),
            camera,
          );
          const hit = raycaster.intersectObjects([
            ...regions.values(),
            ...pinGroup.children,
          ])[0];
          const region = hit?.object.userData.region as MouthRegion | undefined;
          if (region) selectRef.current(region);
        };
        const lost = (event: Event) => {
          event.preventDefault();
          setState("fallback");
        };
        const keyDown = (event: KeyboardEvent) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          const direction = ROTATION_KEYS[event.key];
          if (!direction) return;
          event.preventDefault();
          rotateWebObservationMap(camera, controls, direction);
          draw();
        };
        renderer.domElement.addEventListener("pointerdown", pointerDown);
        renderer.domElement.addEventListener("pointerup", pointerUp);
        renderer.domElement.addEventListener("webglcontextlost", lost);
        renderer.domElement.addEventListener("keydown", keyDown);
        controls.addEventListener("change", draw);
        controls.update();
        resize();
        setState("ready");
        cleanup = () => {
          observer.disconnect();
          renderer.domElement.removeEventListener("pointerdown", pointerDown);
          renderer.domElement.removeEventListener("pointerup", pointerUp);
          renderer.domElement.removeEventListener("webglcontextlost", lost);
          renderer.domElement.removeEventListener("keydown", keyDown);
          controls.removeEventListener("change", draw);
          controls.dispose();
          runtime.current = null;
          scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              object.geometry.dispose();
              const materials = Array.isArray(object.material)
                ? object.material
                : [object.material];
              materials.forEach((material) => material.dispose());
            }
          });
          renderer.dispose();
          renderer.domElement.remove();
        };
      })
      .catch(() => {
        if (!cancelled) setState("fallback");
      });
    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    const map = runtime.current;
    if (!map || state !== "ready") return;
    for (const [region, mesh] of map.regions) {
      const material = mesh.material as MeshStandardMaterial;
      material.color.set(
        region === selected
          ? 0x096d67
          : completed.includes(region)
            ? 0xb3737d
            : 0xcda0a5,
      );
      material.emissive.set(region === selected ? 0x062623 : 0x000000);
    }
    void import("three").then((THREE) => {
      if (runtime.current !== map) return;
      map.pins.children.forEach((child) => {
        const mesh = child as Mesh;
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
      });
      map.pins.clear();
      for (const pin of pins) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.06, 16, 12),
          new THREE.MeshStandardMaterial({
            color: 0xa55710,
            emissive: 0x381b04,
          }),
        );
        mesh.position.set(...webPinPosition(pin));
        mesh.userData.region = pin.region;
        map.pins.add(mesh);
      }
      map.draw();
    });
  }, [completed, selected, pins, state]);

  function zoom(direction: 1 | -1) {
    const map = runtime.current;
    if (!map) return;
    zoomWebObservationMap(map.camera, map.controls, direction);
    map.draw();
  }

  function rotate(direction: WebMapRotation) {
    const map = runtime.current;
    if (!map) return;
    rotateWebObservationMap(map.camera, map.controls, direction);
    map.draw();
  }

  return (
    <div className="scan-map-layout">
      <div className="scan-map-stage">
        <div
          ref={mountRef}
          className="scan-map-canvas"
          hidden={state === "fallback"}
        />
        {state === "loading" && (
          <p className="scan-map-loading" role="status">
            Opening the 3D map…
          </p>
        )}
        {state === "fallback" && (
          <div className="scan-map-fallback">
            <h3>Region view</h3>
            <p>
              3D is unavailable on this device. All regions and observations are
              available below.
            </p>
            <svg
              viewBox="0 0 360 280"
              role="img"
              aria-label="Eight-region oral observation map"
            >
              <ellipse cx="180" cy="140" rx="133" ry="105" fill="#ebc3c6" />
              <ellipse cx="180" cy="135" rx="100" ry="76" fill="#8d525d" />
              {MOUTH_REGION_DETAILS.map((item, i) => {
                const [x, y] = WEB_REGION_POSITIONS[item.id];
                return (
                  <g key={item.id}>
                    <circle
                      cx={180 + x * 87}
                      cy={128 - y * 78}
                      r="16"
                      fill={item.id === selected ? "#096d67" : "#fff"}
                    />
                    <text
                      x={180 + x * 87}
                      y={133 - y * 78}
                      textAnchor="middle"
                      fill={item.id === selected ? "#fff" : "#142d31"}
                    >
                      {i + 1}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
        {state === "ready" && (
          <div className="scan-map-controls">
            <span>Drag to rotate</span>
            <button type="button" aria-label="Zoom in" onClick={() => zoom(1)}>
              +
            </button>
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() => zoom(-1)}
            >
              −
            </button>
            <details className="scan-map-rotation">
              <summary>Rotate map</summary>
              <div className="scan-map-rotation-buttons">
                {(
                  [
                    ["left", "←"],
                    ["right", "→"],
                    ["up", "↑"],
                    ["down", "↓"],
                  ] as const
                ).map(([direction, arrow]) => (
                  <button
                    key={direction}
                    type="button"
                    aria-label={`Rotate ${direction}`}
                    onClick={() => rotate(direction)}
                  >
                    <span aria-hidden="true">{arrow}</span>
                  </button>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>
      <ol className="scan-map-regions" aria-label="Mouth regions">
        {MOUTH_REGION_DETAILS.map((region, index) => (
          <li key={region.id}>
            <button
              type="button"
              aria-pressed={selected === region.id}
              onClick={() => onSelect(region.id)}
            >
              <span className="scan-region-number">{index + 1}</span>
              <span>
                {region.shortLabel}
                <small>
                  {completed.includes(region.id)
                    ? "Photo accepted"
                    : "No photo yet"}
                  {pins.some((pin) => pin.region === region.id)
                    ? " · Observation saved"
                    : ""}
                </small>
              </span>
              <span aria-hidden="true">
                {completed.includes(region.id) ? "✓" : "›"}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
