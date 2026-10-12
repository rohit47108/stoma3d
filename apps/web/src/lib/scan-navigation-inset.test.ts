import { afterEach, describe, expect, it, vi } from "vitest";
import { observeScanNavigationInset } from "./scan-navigation-inset";

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
