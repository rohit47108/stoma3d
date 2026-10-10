import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScanCamera } from "./scan-camera";

// Render-state checks, not a DOM mount or device-camera test. Browser checks
// separately exercise pending preparation and the actual Cancel interaction.
const hooks = vi.hoisted(() => ({
  cursor: 0,
  values: new Map<number, unknown>(),
  stateUpdates: vi.fn(),
  refCursor: 0,
  refs: [] as { current: unknown }[],
  effects: [] as (() => void)[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const slot = hooks.cursor++;
    return [
      hooks.values.has(slot) ? hooks.values.get(slot) : initial,
      hooks.stateUpdates,
    ];
  },
  useRef: (initial: unknown) => {
    const slot = hooks.refCursor++;
    return (hooks.refs[slot] ??= { current: initial });
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (setup: () => void) => hooks.effects.push(setup),
}));

function cameraTree() {
  hooks.cursor = 0;
  hooks.refCursor = 0;
  hooks.effects.length = 0;
  return ScanCamera({
    initialFacing: "user",
    onPhoto: vi.fn(),
    onProblem: vi.fn(),
    onFacingChange: vi.fn(),
  });
}

function renderCamera() {
  return renderToStaticMarkup(cameraTree());
}

type Button = ReactElement<{
  children?: ReactNode;
  onClick: () => void;
  ref?: { current: { focus: () => void } | null };
}>;
function buttons(node: ReactNode): Button[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [
    ...(node.type === "button" ? [node as Button] : []),
    ...buttons(node.props.children),
  ];
}

beforeEach(() => {
  hooks.values.clear();
  hooks.cursor = 0;
  hooks.refCursor = 0;
  hooks.refs.length = 0;
  vi.clearAllMocks();
});

describe("camera preparation feedback", () => {
  it("returns keyboard focus to the capture action after cancellation", () => {
    hooks.values.set(2, true);
    const controls = buttons(cameraTree());
    const primary = controls.find(
      (button) => button.props.children === "Preparing photo…",
    )!;
    expect(primary.props.ref).toBeDefined();
    const focus = vi.fn();
    primary.props.ref!.current = { focus };
    controls
      .find((button) => button.props.children === "Cancel")!
      .props.onClick();
    hooks.values.set(2, false);
    renderCamera();
    hooks.effects.at(-1)!();

    expect(focus).toHaveBeenCalledOnce();
    renderCamera();
    hooks.effects.at(-1)!();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("keeps the duplicate file input out of keyboard navigation and disabled during preparation", () => {
    hooks.values.set(2, true);
    const html = renderCamera();
    const input = html.match(/<input[^>]*type="file"[^>]*>/)![0];

    expect(input).toContain('disabled=""');
    expect(input).toMatch(/tabindex="-1"/i);
  });

  it("names an uploaded photo's preparation and provides an enabled cancel action", () => {
    hooks.values.set(2, true);
    const html = renderCamera();

    expect(html).toContain("Preparing photo…");
    expect(html).toContain(
      '<p role="status" class="sr-only">Preparing photo…</p>',
    );
    const cancel = html.match(/<button([^>]*)>Cancel<\/button>/);
    expect(cancel).not.toBeNull();
    expect(cancel![1]).not.toContain("disabled");
    expect(html).not.toContain(">Open camera</button>");
  });

  it("offers cancellation while a live-camera photo is prepared", () => {
    hooks.values.set(1, "open");
    hooks.values.set(2, true);
    const html = renderCamera();

    expect(html).toContain("Preparing photo…");
    expect(html).toContain(">Cancel</button>");
    expect(html).toContain(
      '<p role="status" class="sr-only">Preparing photo…</p>',
    );
  });

  it("announces camera startup with a cancel action", () => {
    hooks.values.set(1, "opening");
    const html = renderCamera();

    expect(html).toContain(
      '<p role="status" class="sr-only">Opening camera…</p>',
    );
    expect(html).toContain(">Cancel</button>");
  });

  it("keeps the announcement region mounted while the camera is idle", () => {
    const html = renderCamera();

    expect(html).toContain('<p role="status" class="sr-only"></p>');
    expect(html).toContain(">Open camera</button>");
    expect(html).not.toContain(">Cancel</button>");
  });
});
