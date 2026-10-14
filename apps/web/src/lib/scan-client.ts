import { analysisResultSchema, type MouthRegion } from "@stoma3d/contracts";
import type { PreparedPhoto } from "./scan-image";

export async function analyzeGuestPhoto(
  photo: PreparedPhoto,
  region: MouthRegion,
  captureId: string,
  signal: AbortSignal,
) {
  const requestId = crypto.randomUUID();
  const send = () => {
    signal.throwIfAborted();
    // Build a fresh body for each attempt; request streams cannot be reused.
    // https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch#setting_a_body
    const body = new FormData();
    body.set("image", photo.blob, "mouth.jpg");
    body.set("region", region);
    body.set("captureId", captureId);
    body.set("inputOrigin", "live_capture");
    return fetch("/api/scan/analyze", {
      method: "POST",
      body,
      signal,
      cache: "no-store",
      headers: { "x-stoma3d-request-id": requestId },
    });
  };
  const response = await send().catch(async (error: unknown) => {
    if (signal.aborted || !(error instanceof TypeError)) throw error;
    // This endpoint only computes analysis; it saves no captures or jobs.
    // Retry one transport failure with the same capture identity.
    // https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2
    try {
      return await send();
    } catch (retryError) {
      if (signal.aborted || !(retryError instanceof TypeError))
        throw retryError;
      throw new Error(
        "Could not connect. Your photo is still here; try again.",
      );
    }
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : null;
    const message =
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : "Analysis is unavailable right now. Try again.";
    throw new Error(message);
  }
  const parsed = analysisResultSchema.safeParse(payload);
  if (
    !parsed.success ||
    parsed.data.captureId !== captureId ||
    parsed.data.region !== region ||
    parsed.data.inputOrigin !== "live_capture" ||
    !["live_model", "unavailable"].includes(parsed.data.analysisOrigin)
  ) {
    throw new Error(
      "The analysis response could not be verified. Your photo is still here; try again.",
    );
  }
  return parsed.data;
}
