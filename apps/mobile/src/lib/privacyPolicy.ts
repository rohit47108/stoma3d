import type { SanitizedCapture } from "@/lib/imagePipeline";
import { evaluateImageTelemetry } from "./quality";

export function retryDraftQuality(capture: SanitizedCapture) {
  if (
    capture.privacyStatus !== "passed" ||
    capture.telemetry.measurementStatus !== "measured" ||
    capture.source === "video_sweep"
  )
    return null;
  const quality = evaluateImageTelemetry({
    ...capture.telemetry,
    width: capture.width,
    height: capture.height,
    byteSize: capture.byteSize,
  });
  return quality.accepted ? quality : null;
}

export function withFaceDetectionResult(
  capture: SanitizedCapture,
  faceDetected: boolean,
): SanitizedCapture {
  return {
    ...capture,
    privacyStatus: faceDetected ? "face_detected" : "passed",
    telemetry: {
      ...capture.telemetry,
      faceDetected,
    },
  };
}

export function withUnavailablePrivacyCheck(
  capture: SanitizedCapture,
): SanitizedCapture {
  return {
    ...capture,
    privacyStatus: "unavailable",
    telemetry: { ...capture.telemetry, faceDetected: false },
  };
}

export function canSendForServerPrivacyCheck(
  capture: SanitizedCapture,
  consented: boolean,
): boolean {
  return (
    consented &&
    capture.privacyStatus === "unavailable" &&
    capture.cropped === true
  );
}

interface CapturePrivacyDetector {
  status: string;
  initialize: (options: {
    performanceMode: "accurate";
    landmarkMode: false;
    contourMode: false;
    classificationMode: false;
    minFaceSize: number;
    isTrackingEnabled: false;
  }) => Promise<void>;
  detectFaces: (uri: string) => Promise<{ faces: unknown[] } | undefined>;
}

export async function checkCapturePrivacy(
  capture: SanitizedCapture,
  detector: CapturePrivacyDetector,
): Promise<SanitizedCapture> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const unavailable = withUnavailablePrivacyCheck(capture);
  try {
    const checked = async () => {
      if (["init", "modelLoading", "error"].includes(detector.status)) {
        await detector.initialize({
          performanceMode: "accurate",
          landmarkMode: false,
          contourMode: false,
          classificationMode: false,
          minFaceSize: 0.1,
          isTrackingEnabled: false,
        });
      }
      if (detector.status === "error") return unavailable;
      const result = await detector.detectFaces(capture.uri);
      return result && Array.isArray(result.faces)
        ? withFaceDetectionResult(capture, result.faces.length > 0)
        : unavailable;
    };
    return await Promise.race([
      checked(),
      new Promise<SanitizedCapture>((resolve) => {
        timeout = setTimeout(() => resolve(unavailable), 8000);
      }),
    ]);
  } catch {
    return unavailable;
  } finally {
    clearTimeout(timeout);
  }
}
