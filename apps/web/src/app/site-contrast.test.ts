import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./globals.css", import.meta.url), "utf8");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = styles.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1];
  if (!body) throw new Error(`Missing style rule for ${selector}`);
  return body;
}

function declaration(body: string, property: string): string {
  const value = body.match(
    new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+);`),
  )?.[1];
  if (!value) throw new Error(`Missing ${property} declaration`);
  return value.trim();
}

function luminance(hex: string): number {
  const components = hex.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!components) throw new Error(`Expected a six-digit color: ${hex}`);
  const [red, green, blue] = components.slice(1).map((component) => {
    const channel = Number.parseInt(component, 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return red! * 0.2126 + green! * 0.7152 + blue! * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const levels = [luminance(foreground), luminance(background)];
  return (Math.max(...levels) + 0.05) / (Math.min(...levels) + 0.05);
}

describe("landing-page text contrast", () => {
  it("keeps the light phone preview readable even when the page uses dark colors", () => {
    const preview = rule(".phone__screen");
    // The preview stays light in dark mode, so its ink must be scoped locally.
    expect(declaration(preview, "color")).toBe("var(--graphite)");
    expect(
      contrast(
        declaration(preview, "--graphite"),
        declaration(preview, "background"),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps report-preview labels readable on both light report surfaces", () => {
    const token = declaration(rule(".report-sheet__summary span"), "color");
    const name = token.match(/^var\((--[\w-]+)\)$/)?.[1];
    expect(name).toBeDefined();
    const foreground = declaration(rule(":root"), name!);
    for (const background of ["#ffffff", "#f8fbfa"]) {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
