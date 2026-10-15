import {
  createElement,
  isValidElement,
  type Context,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MOUTH_REGION_DETAILS } from "@stoma3d/contracts";
import type { ObservationPin } from "../src/types";

interface NativeNode {
  kind: string;
  props: Record<string, unknown>;
  parent: NativeNode | null;
}

// Real React renders the component; only native/GL boundaries are controlled.
// These are layout-contract checks, not a native Yoga mount or hit-test proof.
const runtime = vi.hoisted(() => ({
  dimensions: { width: 414, height: 945 },
  nodes: [] as NativeNode[],
  parentContext: null as Context<NativeNode | null> | null,
}));

vi.mock("react-native", async () => {
  const react = await import("react");
  const Parent = react.createContext<NativeNode | null>(null);
  runtime.parentContext = Parent;
  const boundary = (kind: string) => (props: Record<string, unknown>) => {
    const node = { kind, props, parent: react.useContext(Parent) };
    runtime.nodes.push(node);
    return react.createElement(
      Parent.Provider,
      { value: node },
      props.children as ReactNode,
    );
  };
  return {
    View: boundary("View"),
    Text: boundary("Text"),
    Pressable: boundary("Pressable"),
    StyleSheet: { create: (styles: unknown) => styles },
    useWindowDimensions: () => runtime.dimensions,
    AccessibilityInfo: {},
  };
});
vi.mock("@react-three/fiber/native", async () => {
  const react = await import("react");
  await import("react-native");
  return {
    Canvas: (props: Record<string, unknown>) => {
      runtime.nodes.push({
        kind: "Canvas",
        props,
        parent: react.useContext(runtime.parentContext!),
      });
      return null;
    },
    useFrame: vi.fn(),
    useThree: vi.fn(),
  };
});
vi.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
vi.mock("@/constants", () => import("../src/constants"));
vi.mock(
  "@/components/oralObservationIntro",
  () => import("../src/components/oralObservationIntro"),
);
vi.mock("@/lib/observationMap", () => import("../src/lib/observationMap"));
vi.mock("@/theme", () => import("../src/theme"));
vi.mock("@/store/useStoma3DStore", () => ({
  useStoma3DStore: (select: (state: unknown) => unknown) =>
    select({ settings: { highContrast: false, largeText: false } }),
}));

import { OralObservationMap } from "../src/components/OralObservationMap";

function styleOf(node: NativeNode): Record<string, unknown> {
  const flatten = (style: unknown): Record<string, unknown> => {
    if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
    return typeof style === "object" && style !== null
      ? (style as Record<string, unknown>)
      : {};
  };
  const style = node.props.style;
  return flatten(
    typeof style === "function" ? style({ pressed: false }) : style,
  );
}

function ancestors(node: NativeNode): NativeNode[] {
  return node.parent ? [node.parent, ...ancestors(node.parent)] : [];
}

function branchWithin(node: NativeNode, ancestor: NativeNode): NativeNode {
  return node.parent === ancestor ? node : branchWithin(node.parent!, ancestor);
}

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}

const lowerLipPin: ObservationPin = {
  id: "lower-lip-pin",
  region: "lower_lip",
  meshId: MOUTH_REGION_DETAILS.find((detail) => detail.id === "lower_lip")!
    .meshId,
  uvX: 0.5,
  uvY: 0.5,
  assetVersion: "procedural-v1",
  userConfirmed: true,
  firstObservedAt: "2026-10-14T12:00:00Z",
  status: "stable",
  captureIds: ["lower-lip-photo"],
};

beforeEach(() => {
  runtime.nodes = [];
});

describe("observation map control layout", () => {
  it.each([
    { name: "phone", width: 414, height: 945, sceneHeight: 370 },
    { name: "compact landscape", width: 945, height: 414, sceneHeight: 300 },
    { name: "wide", width: 1024, height: 1366, sceneHeight: 440 },
  ])(
    "reserves a separate footer below the $name pin viewport",
    (dimensions) => {
      runtime.dimensions = dimensions;
      renderToStaticMarkup(
        createElement(OralObservationMap, {
          completedRegions: ["lower_lip"],
          selectedRegion: "lower_lip",
          onSelectRegion: vi.fn(),
          pins: [lowerLipPin],
          showRegionList: true,
        }),
      );

      const canvas = runtime.nodes.find((node) => node.kind === "Canvas")!;
      const controls = [
        "Rotate left",
        "Rotate right",
        "Zoom in",
        "Zoom out",
      ].map((label) =>
        runtime.nodes.find(
          (node) =>
            node.kind === "Pressable" &&
            node.props.accessibilityLabel === label,
        )!,
      );
      const rail = controls[0].parent!;
      const shell = ancestors(canvas).find((node) =>
        ancestors(rail).includes(node),
      )!;
      const viewport = branchWithin(canvas, shell);
      const railStyle = styleOf(rail);
      const verticalPadding = Number(railStyle.paddingVertical ?? 0);
      const railHeight = Number(
        railStyle.height ??
          railStyle.minHeight ??
          48 +
            Number(railStyle.paddingTop ?? verticalPadding) +
            Number(railStyle.paddingBottom ?? verticalPadding),
      );

      expect(
        elements(canvas.props.children as ReactNode).some(
          (element) => element.props.name === "pin-lower-lip-pin",
        ),
      ).toBe(true);
      expect(controls.every((control) => control.parent === rail)).toBe(true);
      controls.forEach((control) => {
        expect(styleOf(control)).toMatchObject({ width: 48, height: 48 });
      });
      expect(rail.parent).toBe(shell);
      expect(viewport).not.toBe(rail);
      expect(runtime.nodes.indexOf(viewport)).toBeLessThan(
        runtime.nodes.indexOf(rail),
      );
      expect(styleOf(viewport).position).not.toBe("absolute");
      expect(
        railStyle.position,
        "controls must not overlay the pin viewport",
      ).not.toBe("absolute");
      expect(railHeight).toBe(72);
      expect(
        styleOf(viewport).height,
        "preserve the existing scene height",
      ).toBe(dimensions.sceneHeight);
      const shellHeight = styleOf(shell).height;
      if (typeof shellHeight === "number") {
        expect(shellHeight).toBeGreaterThanOrEqual(
          dimensions.sceneHeight + railHeight,
        );
      }
    },
  );
});
