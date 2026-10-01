import { describe, expect, it } from "vitest";

import { telemetryFromRgba } from "../src/lib/imageTelemetry";

function pixels(
  width: number,
  height: number,
  value: (x: number, y: number) => number,
) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data.set([value(x, y), value(x, y), value(x, y), 255], offset);
    }
  }
  return data;
}

describe("decoded capture measurements", () => {
  it("reports a pixel read failure rather than made-up zero quality", () => {
    expect(() => telemetryFromRgba(new Uint8Array(8), 16, 16)).toThrow(
      "pixels",
    );
  });

  it("reads RGBA color channels as bytes", () => {
    const data = new Uint8Array(4 * 4 * 4);
    for (let offset = 0; offset < data.length; offset += 4)
      data.set([255, 0, 0, 255], offset);
    expect(telemetryFromRgba(data, 4, 4).meanLuminance).toBeCloseTo(0.299, 3);
  });

  it("distinguishes textured tissue-like detail from a flat blurred image", () => {
    const detailed = telemetryFromRgba(
      pixels(64, 64, (x, y) => 100 + ((x + y) % 2) * 24),
      64,
      64,
    );
    const flat = telemetryFromRgba(
      pixels(64, 64, () => 112),
      64,
      64,
    );
    expect(detailed.focusVariance).toBeGreaterThan(0.001);
    expect(flat.focusVariance).toBe(0);
    expect(flat.meanLuminance).toBeCloseTo(112 / 255);
  });
});
