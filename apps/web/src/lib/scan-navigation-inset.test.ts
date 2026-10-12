import { afterEach, describe, expect, it, vi } from "vitest";
import {
  keepScanFocusVisible,
  observeScanNavigationInset,
} from "./scan-navigation-inset";

afterEach(() => vi.unstubAllGlobals());

describe("scan navigation inset", () => {
  function browserNodes(initialValue = "") {
    const values = new Map([["--scan-navigation-inset", initialValue]]);
    const root = {
      style: {
        getPropertyValue: (name: string) => values.get(name) ?? "",
        getPropertyPriority: () => "",
        setProperty: (name: string, value: string) => values.set(name, value),
        removeProperty: (name: string) => values.delete(name),
      },
    } as unknown as HTMLElement;
    const bounds = { height: 76 };
    const navigation = {
      getBoundingClientRect: () => bounds,
    } as unknown as HTMLElement;
    const disconnect = vi.fn();
    let resize: () => void = () => undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    return {
      root,
      navigation,
      bounds,
      values,
      disconnect,
      resize: () => resize(),
    };
  }

  it("reserves measured navigation height and updates it when text enlarges", () => {
    const nodes = browserNodes();
    const stop = observeScanNavigationInset(nodes.navigation, nodes.root);
    expect(nodes.values.get("--scan-navigation-inset")).toBe("88px");
    nodes.bounds.height = 166.5;
    nodes.resize();
    expect(nodes.values.get("--scan-navigation-inset")).toBe("179px");
    stop();
    expect(nodes.disconnect).toHaveBeenCalledOnce();
    expect(nodes.values.has("--scan-navigation-inset")).toBe(false);
  });

  it("restores the previous root style on unmount", () => {
    const nodes = browserNodes("120px");
    const stop = observeScanNavigationInset(nodes.navigation, nodes.root);
    stop();
    expect(nodes.values.get("--scan-navigation-inset")).toBe("120px");
  });

  it("keeps the CSS fallback when observation is unavailable", () => {
    const nodes = browserNodes();
    vi.stubGlobal("ResizeObserver", undefined);
    const stop = observeScanNavigationInset(nodes.navigation, nodes.root);
    expect(nodes.values.get("--scan-navigation-inset")).toBe("");
    expect(stop).not.toThrow();
  });
});

describe("scan keyboard focus visibility", () => {
  const navigation = {
    getBoundingClientRect: () => ({
      left: 0,
      right: 390,
      top: 678,
      height: 166,
    }),
  } as unknown as HTMLElement;

  it("brings a control above navigation even when native focus scrolling ignores CSS padding", () => {
    const scrollIntoView = vi.fn();
    const control = {
      matches: () => true,
      getBoundingClientRect: () => ({
        left: 16,
        right: 256,
        top: 727,
        bottom: 803,
      }),
      scrollIntoView,
    } as unknown as HTMLElement;
    keepScanFocusVisible(control, navigation);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "instant",
      block: "center",
      inline: "nearest",
    });
  });

  it("does not move controls that already clear the navigation", () => {
    const scrollIntoView = vi.fn();
    const control = {
      matches: () => true,
      getBoundingClientRect: () => ({
        left: 16,
        right: 256,
        top: 350,
        bottom: 426,
      }),
      scrollIntoView,
    } as unknown as HTMLElement;
    keepScanFocusVisible(control, navigation);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not scroll content beside the desktop sidebar", () => {
    const scrollIntoView = vi.fn();
    const control = {
      matches: () => true,
      getBoundingClientRect: () => ({
        left: 219,
        right: 600,
        top: 350,
        bottom: 426,
      }),
      scrollIntoView,
    } as unknown as HTMLElement;
    const sidebar = {
      getBoundingClientRect: () => ({
        left: 0,
        right: 168,
        top: 76,
        height: 768,
      }),
    } as unknown as HTMLElement;
    keepScanFocusVisible(control, sidebar);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not move a pointer-focused button during a click", () => {
    const scrollIntoView = vi.fn();
    const control = {
      matches: () => false,
      getBoundingClientRect: () => ({
        left: 16,
        right: 256,
        top: 640,
        bottom: 716,
      }),
      scrollIntoView,
    } as unknown as HTMLElement;
    keepScanFocusVisible(control, navigation);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
