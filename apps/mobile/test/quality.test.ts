import { describe, expect, it } from "vitest";

import { TRANSPORT_IMAGE_BYTE_LIMIT } from "../src/constants";
import { evaluateImageTelemetry } from "../src/lib/quality";

describe("capture quality gate", () => {
  it("uses sensor stability as advice, not a photo rejection", () => {
    expect(
      evaluateImageTelemetry({
        edgeStrength: 0.2,
        focusVariance: 0.02,
        meanLuminance: 0.55,
        highlightFraction: 0.01,
        obstructionEstimate: 0.02,
        faceDetected: false,
        stable: false,
      }).accepted,
    ).toBe(true);
  });

  it("does not describe unavailable local measurements as blur", () => {
    const result = evaluateImageTelemetry(
      {
        edgeStrength: 0,
        meanLuminance: 0,
        highlightFraction: 0,
        obstructionEstimate: 0,
        faceDetected: false,
        stable: true,
        measurementStatus: "unavailable",
      },
      "advisory",
    );
    expect(result.accepted).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("lets the server decide on measured photo quality", () => {
    const result = evaluateImageTelemetry(
      {
        edgeStrength: 0,
        focusVariance: 0,
        meanLuminance: 0.1,
        highlightFraction: 0,
        obstructionEstimate: 0.2,
        faceDetected: false,
        stable: true,
        width: 320,
        height: 240,
      },
      "advisory",
    );
    expect(result.accepted).toBe(true);
  });

  it("uses the standardized server-policy cutoff when saving a retry draft", () => {
    const standardized = {
      edgeStrength: 0.05,
      focusVariance: 0.0001,
      meanLuminance: 0.55,
      wellExposedFraction: 0.9,
      highlightFraction: 0.02,
      obstructionEstimate: 0.02,
      faceDetected: false,
      stable: false,
      width: 640,
      height: 480,
      measurementStatus: "measured" as const,
    };
    expect(evaluateImageTelemetry(standardized).accepted).toBe(false);
    expect(evaluateImageTelemetry(standardized, "advisory").accepted).toBe(
      true,
    );
    expect(
      evaluateImageTelemetry({ ...standardized, focusVariance: 0.002 })
        .accepted,
    ).toBe(true);
  });
  it("accepts a stable, visible, evenly lit frame", () => {
    const result = evaluateImageTelemetry({
      edgeStrength: 0.2,
      focusVariance: 0.02,
      meanLuminance: 0.55,
      highlightFraction: 0.01,
      obstructionEstimate: 0.02,
      faceDetected: false,
      stable: true,
    });
    expect(result.accepted).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.glareScore).toBeCloseTo(0.05);
    expect(result.obstructionScore).toBeCloseTo(0.02);
  });

  it("rejects before persistence when motion, blur, glare, or a face is present", () => {
    const result = evaluateImageTelemetry({
      edgeStrength: 0.2,
      focusVariance: 0.001,
      meanLuminance: 0.95,
      highlightFraction: 0.4,
      obstructionEstimate: 0.8,
      faceDetected: true,
      stable: false,
    });
    expect(result.accepted).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(5);
    expect(result.glareScore).toBe(1);
    expect(result.obstructionScore).toBeCloseTo(0.8);
    expect(result.blurScore).toBeLessThan(0.42);
  });

  it("rejects low-resolution, extreme-aspect, or oversized sanitized images", () => {
    const base = {
      edgeStrength: 0.2,
      focusVariance: 0.02,
      meanLuminance: 0.55,
      highlightFraction: 0.01,
      obstructionEstimate: 0.02,
      faceDetected: false,
      stable: true,
    };
    expect(
      evaluateImageTelemetry({ ...base, width: 320, height: 240 }),
    ).toMatchObject({ accepted: false });
    expect(
      evaluateImageTelemetry({ ...base, width: 3000, height: 500 }),
    ).toMatchObject({ accepted: false });
    expect(
      evaluateImageTelemetry({
        ...base,
        width: 1200,
        height: 1200,
        byteSize: TRANSPORT_IMAGE_BYTE_LIMIT + 1,
      }),
    ).toMatchObject({ accepted: false });
  });

  it("leaves room for two images inside the Vercel request-body ceiling", () => {
    const reservedMultipartBytes = 500_000;
    expect(
      2 * TRANSPORT_IMAGE_BYTE_LIMIT + reservedMultipartBytes,
    ).toBeLessThan(4_500_000);
  });
});
