import * as Crypto from "expo-crypto";
import { File as LocalFile } from "expo-file-system";
import * as Network from "expo-network";
import {
  apiErrorSchema,
  analyzeMetadataSchema,
  analysisResultSchema,
  compareMetadataSchema,
  comparisonResultSchema,
  CONTRACT_VERSION,
  DISCLAIMER,
  modelCardSchema,
  type AnalysisCalibrationRequest,
  type AnalysisResult,
  type ComparisonCalibrationRequest,
  type ComparisonResult,
  type ModelCard,
  type ModelHead,
  type MouthRegion,
  type QualityResult,
} from "@stoma3d/contracts";

import { API_BASE_URL } from "@/constants";
import {
  assertComparisonRequest,
  assertComparisonResult,
  type ComparisonAnalysisReference,
} from "@/lib/comparisonPolicy";
import {
  assertLiveMobileInput,
  assertLiveResultOrigin,
} from "@/lib/liveInputPolicy";
import {
  assertEchoedRequestId,
  verifyResponseSignature,
} from "@/lib/responseSignature";
import { enforceApiTransport } from "@/lib/transportSecurity";
import { requestedHeadsForScan } from "@/lib/modelHeadPolicy";

const REQUEST_TIMEOUT_MS = 18_000;

class ApiRequestError extends Error {
  constructor(
    readonly kind:
      | "configuration"
      | "offline"
      | "timeout"
      | "network"
      | "server"
      | "invalid_response",
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

interface AnalyzeCaptureInput {
  captureId: string;
  selectedRegion: MouthRegion;
  imageUri: string;
  mimeType: "image/jpeg" | "image/png";
  inputOrigin: "live_capture";
  requestedHeads?: ModelHead[];
  localQuality: QualityResult;
  calibration?: AnalysisCalibrationRequest | null;
}

export type { ComparisonAnalysisReference } from "@/lib/comparisonPolicy";

interface CompareCaptureInput {
  baselineCaptureId: string;
  currentCaptureId: string;
  region: MouthRegion;
  baselineImageUri: string;
  currentImageUri: string;
  baselineMimeType: "image/jpeg" | "image/png";
  currentMimeType: "image/jpeg" | "image/png";
  baselineAnalysis: ComparisonAnalysisReference;
  currentAnalysis: ComparisonAnalysisReference;
  inputOrigin: "live_capture";
  userConfirmedMatch: boolean;
  baselineCalibration?: ComparisonCalibrationRequest | null;
  currentCalibration?: ComparisonCalibrationRequest | null;
}

function uploadPart(uri: string): LocalFile {
  return new LocalFile(uri);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<{ requestId: string; response: Response }> {
  const transport = enforceApiTransport(url);
  const pinnedPublicKey =
    process.env.EXPO_PUBLIC_RESPONSE_SIGNING_PUBLIC_KEY_B64?.trim();
  if (!transport.isLoopback && !pinnedPublicKey) {
    throw new ApiRequestError(
      "configuration",
      "A pinned response signing public key is required outside loopback development.",
    );
  }
  if (!transport.isLoopback) {
    const networkState = await Network.getNetworkStateAsync().catch(() => null);
    if (
      networkState &&
      (networkState.isConnected === false ||
        networkState.isInternetReachable === false)
    ) {
      throw new ApiRequestError(
        "offline",
        "You're offline. Your photo is still here. Reconnect and try again.",
      );
    }
  }
  const requestId = Crypto.randomUUID();
  const headers = new Headers(init.headers);
  headers.set("X-Request-ID", requestId);
  const controller = new AbortController();
  const externalSignal = init.signal;
  const abortFromCaller = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });
      return { requestId, response };
    } catch (error) {
      if (__DEV__) {
        console.warn(
          "[Stoma3D] Analysis transport failed before a response was received.",
          error,
        );
      }
      if (timedOut) {
        throw new ApiRequestError(
          "timeout",
          "Analysis took too long. Your photo is still here. Try again.",
        );
      }
      if (externalSignal?.aborted) throw error;
      if (error instanceof ApiRequestError) throw error;
      throw new ApiRequestError(
        "network",
        "The analysis service could not be reached. Check the service address and your connection, then retry.",
      );
    }
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

async function secureJsonBody(
  response: Response,
  endpointUrl: string,
  expectedRequestId: string,
): Promise<unknown> {
  const transport = enforceApiTransport(endpointUrl);
  const cacheControl = response.headers.get("cache-control") ?? "";
  const echoedRequestId = response.headers.get("x-request-id");
  if (!cacheControl.toLowerCase().includes("no-store")) {
    throw new Error("Inference response omitted required privacy headers.");
  }
  assertEchoedRequestId(expectedRequestId, echoedRequestId);
  const raw = await response.text();
  const publicKeyBase64 =
    process.env.EXPO_PUBLIC_RESPONSE_SIGNING_PUBLIC_KEY_B64?.trim();
  const signatureRequired = !transport.isLoopback || Boolean(publicKeyBase64);
  if (signatureRequired) {
    if (!publicKeyBase64) {
      throw new Error(
        "A pinned response signing public key is required outside loopback development.",
      );
    }
    const signatureBase64 = response.headers.get("x-stoma3d-signature");
    const keyId = response.headers.get("x-stoma3d-key-id");
    if (!signatureBase64 || !keyId) {
      throw new Error(
        "Inference response omitted its required Ed25519 signature.",
      );
    }
    verifyResponseSignature({
      publicKeyBase64,
      signatureBase64,
      keyId,
      requestId: expectedRequestId,
      rawResponseBody: raw,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new ApiRequestError(
      "invalid_response",
      "The analysis service returned an unreadable response.",
    );
  }
  if (!response.ok) {
    const apiError = apiErrorSchema.safeParse(parsed);
    throw new ApiRequestError(
      "server",
      apiError.success
        ? apiError.data.error.message
        : `The analysis service could not complete the request (${response.status}).`,
    );
  }
  return parsed;
}

function apiEndpoint(path: string): string {
  return `${API_BASE_URL.replace(/\/$/, "")}${path}`;
}

export function analysisReference(
  analysis: AnalysisResult,
): ComparisonAnalysisReference {
  return {
    captureId: analysis.captureId,
    region: analysis.region,
    status: analysis.status,
    analysisOrigin: analysis.analysisOrigin,
    qualityAccepted: analysis.quality.accepted,
    candidateNormalizedArea: analysis.candidateMask?.normalizedArea ?? null,
    modelVersions: analysis.modelVersions,
  };
}

function unavailableAnalysis(
  input: AnalyzeCaptureInput,
  reason: string,
): AnalysisResult {
  return analysisResultSchema.strict().parse({
    contractVersion: CONTRACT_VERSION,
    captureId: input.captureId,
    region: input.selectedRegion,
    quality: input.localQuality,
    anatomyPrediction: {
      region: null,
      confidence: 0,
      supported: false,
      selectedRegionMatches: false,
    },
    candidateMask: null,
    descriptors: null,
    appearanceOutput: null,
    diseaseResearchOutput: null,
    uncertainty: {
      overallConfidence: 0,
      imageQualityConfidence: input.localQuality.accepted ? 0.5 : 0,
      datasetSimilarity: null,
      modelAgreement: null,
      limitations: [
        "Analysis was unavailable. No substitute result was created.",
      ],
    },
    abstentionReasons: [reason],
    modelVersions: {},
    inputOrigin: input.inputOrigin,
    analysisOrigin: "unavailable",
    status: "failed",
    disclaimer: DISCLAIMER,
  });
}

export async function analyzeCapture(
  input: AnalyzeCaptureInput,
): Promise<AnalysisResult> {
  assertLiveMobileInput(input.inputOrigin);
  const endpoint = apiEndpoint("/v1/analyze");
  try {
    const card = await fetchModelCard();
    const metadata = analyzeMetadataSchema.parse({
      contractVersion: CONTRACT_VERSION,
      captureId: input.captureId,
      selectedRegion: input.selectedRegion,
      inputOrigin: input.inputOrigin,
      requestedHeads: input.requestedHeads
        ? input.requestedHeads.filter((head) =>
            card.enabledHeads.includes(head),
          )
        : requestedHeadsForScan(card),
      ...(input.calibration ? { calibration: input.calibration } : {}),
    });
    const form = new FormData();
    form.append(
      "image",
      uploadPart(input.imageUri),
      `capture.${input.mimeType === "image/png" ? "png" : "jpg"}`,
    );
    form.append("metadata", JSON.stringify(metadata));

    const { requestId, response } = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: form,
    });
    const result = analysisResultSchema
      .strict()
      .parse(await secureJsonBody(response, endpoint, requestId));
    if (
      result.captureId !== input.captureId ||
      result.region !== input.selectedRegion ||
      result.inputOrigin !== input.inputOrigin
    ) {
      throw new Error("Inference response identity did not match the capture.");
    }
    assertLiveResultOrigin(result.analysisOrigin);
    return result;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Inference request failed.";
    return unavailableAnalysis(input, reason);
  }
}

export async function compareCaptures(
  input: CompareCaptureInput,
): Promise<ComparisonResult> {
  assertLiveMobileInput(input.inputOrigin);
  const expectedIdentity = {
    baselineCaptureId: input.baselineCaptureId,
    currentCaptureId: input.currentCaptureId,
    region: input.region,
    inputOrigin: input.inputOrigin,
    userConfirmedMatch: input.userConfirmedMatch,
    baselineAnalysis: input.baselineAnalysis,
    currentAnalysis: input.currentAnalysis,
  };
  assertComparisonRequest(expectedIdentity);
  const metadata = {
    contractVersion: CONTRACT_VERSION,
    baselineCaptureId: input.baselineCaptureId,
    currentCaptureId: input.currentCaptureId,
    region: input.region,
    userConfirmedMatch: input.userConfirmedMatch,
    inputOrigin: input.inputOrigin,
    baselineAnalysis: input.baselineAnalysis,
    currentAnalysis: input.currentAnalysis,
    baselineCalibration: input.baselineCalibration ?? null,
    currentCalibration: input.currentCalibration ?? null,
  };
  const validatedMetadata = compareMetadataSchema.parse(metadata);
  const form = new FormData();
  const baselineExtension =
    input.baselineMimeType === "image/png" ? "png" : "jpg";
  const currentExtension =
    input.currentMimeType === "image/png" ? "png" : "jpg";
  form.append(
    "baseline_image",
    uploadPart(input.baselineImageUri),
    `baseline.${baselineExtension}`,
  );
  form.append(
    "current_image",
    uploadPart(input.currentImageUri),
    `current.${currentExtension}`,
  );
  form.append("metadata", JSON.stringify(validatedMetadata));

  const endpoint = apiEndpoint("/v1/compare");
  try {
    const { requestId, response } = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: form,
    });
    const result = comparisonResultSchema
      .strict()
      .parse(await secureJsonBody(response, endpoint, requestId));
    assertComparisonResult(result, expectedIdentity);
    assertLiveResultOrigin(result.analysisOrigin);
    return result;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Comparison request failed.";
    const unavailable = comparisonResultSchema.strict().parse({
      contractVersion: CONTRACT_VERSION,
      baselineCaptureId: input.baselineCaptureId,
      currentCaptureId: input.currentCaptureId,
      region: input.region,
      candidateMatchScore: null,
      userConfirmedMatch: input.userConfirmedMatch,
      registrationConfidence: 0,
      inlierRatio: 0,
      reprojectionErrorRatio: 1,
      repeatedCaptureAreaError: null,
      repeatabilityGatePassed: false,
      registrationAlignment: null,
      normalizedChange: null,
      descriptorChanges: null,
      calibratedMeasurementChanges: null,
      calibrationSuppressionReasons:
        input.baselineCalibration || input.currentCalibration
          ? ["comparison_not_comparable"]
          : [],
      comparable: false,
      suppressionReasons: [
        reason,
        ...(!input.userConfirmedMatch ? ["user_confirmation_required"] : []),
        "Insufficient comparable data.",
      ],
      modelVersions: {},
      inputOrigin: input.inputOrigin,
      analysisOrigin: "unavailable",
      disclaimer: DISCLAIMER,
    });
    assertComparisonResult(unavailable, expectedIdentity);
    return unavailable;
  }
}

export async function fetchModelCard(signal?: AbortSignal): Promise<ModelCard> {
  const endpoint = apiEndpoint("/v1/model-card");
  const { requestId, response } = await fetchWithTimeout(endpoint, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  return modelCardSchema
    .strict()
    .parse(await secureJsonBody(response, endpoint, requestId));
}
