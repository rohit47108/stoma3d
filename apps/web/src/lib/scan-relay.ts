import {
  createHash,
  createPublicKey,
  randomBytes,
  randomUUID,
  verify,
} from "node:crypto";
import {
  analysisResultSchema,
  analyzeMetadataSchema,
  modelCardSchema,
  mouthRegionSchema,
  CONTRACT_VERSION,
  type ModelCard,
} from "@stoma3d/contracts";

// Next.js Route Handlers use the Node runtime; signatures cover the original
// response bytes, not a reserialized JSON object. https://nextjs.org/docs/app/api-reference/file-conventions/route
const MAX_IMAGE_BYTES = 1_750_000;
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 128 * 1024;
const MAX_RESPONSE_BYTES = 3_500_000;
const HEADS = [
  "segmentation",
  "anatomy",
  "quality_control",
  "oral_tissue_segmentation",
  "out_of_distribution",
  "secondary_segmentation",
  "appearance",
] as const;
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
};
type Environment = Readonly<Record<string, string | undefined>>;
type Options = {
  environment?: Environment;
  fetcher?: typeof fetch;
  rateLimit?: (request: Request) => boolean;
};
class RelayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
function failure(error: unknown): Response {
  const known =
    error instanceof RelayError
      ? error
      : new RelayError(
          503,
          "service_unavailable",
          "Photo checking is unavailable. Keep your photo and try again.",
        );
  return Response.json(
    { error: { code: known.code, message: known.message } },
    { status: known.status, headers },
  );
}
function configuration(environment: Environment) {
  try {
    const url = new URL(environment.STOMA3D_INFERENCE_URL ?? "");
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          loopback &&
          url.protocol === "http:" &&
          environment.NODE_ENV !== "production"
        ))
    )
      throw new Error();
    const encoded =
      environment.STOMA3D_RESPONSE_SIGNING_PUBLIC_KEY_B64?.trim() ?? "";
    const keyBytes = Buffer.from(encoded, "base64");
    if (keyBytes.length !== 32 || keyBytes.toString("base64") !== encoded)
      throw new Error();
    const key = createPublicKey({
      format: "der",
      type: "spki",
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        keyBytes,
      ]),
    });
    return {
      baseUrl: url.toString().replace(/\/$/, ""),
      key,
      keyId: createHash("sha256").update(keyBytes).digest("hex").slice(0, 16),
    };
  } catch {
    throw new RelayError(
      503,
      "configuration",
      "Photo analysis is being set up. Please try again later.",
    );
  }
}
async function boundedBytes(
  source: Request | Response,
  maximum: number,
): Promise<Uint8Array> {
  const declared = Number(source.headers.get("content-length"));
  if (declared > maximum)
    throw new RelayError(
      source instanceof Request ? 413 : 502,
      "size_limit",
      "This photo is too large. Choose a smaller photo.",
    );
  const reader = source.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximum) {
        await reader.cancel();
        throw new RelayError(
          source instanceof Request ? 413 : 502,
          "size_limit",
          "This photo is too large. Choose a smaller photo.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
const rateSalt = randomBytes(32);
const requests = new Map<string, { count: number; until: number }>();
export function guestRequestAllowed(request: Request): boolean {
  const now = Date.now();
  for (const [key, value] of requests)
    if (value.until <= now) requests.delete(key);
  const client = request.headers.get("x-real-ip") ?? "local";
  const key = createHash("sha256")
    .update(rateSalt)
    .update(client.slice(0, 128))
    .digest("hex");
  const state = requests.get(key) ?? { count: 0, until: now + 600_000 };
  if (requests.size >= 2048 && !requests.has(key)) return false;
  state.count += 1;
  requests.set(key, state);
  return state.count <= 120;
}
async function verifiedJson(
  path: string,
  init: RequestInit,
  options: Options,
): Promise<unknown> {
  const config = configuration(options.environment ?? process.env);
  const requestId = randomUUID();
  const requestHeaders = new Headers(init.headers);
  requestHeaders.set("X-Request-ID", requestId);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await (options.fetcher ?? fetch)(
      `${config.baseUrl}${path}`,
      {
        ...init,
        headers: requestHeaders,
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      },
    );
    const bytes = await boundedBytes(response, MAX_RESPONSE_BYTES);
    const signature = Buffer.from(
      response.headers.get("x-stoma3d-signature") ?? "",
      "base64",
    );
    const message = Buffer.concat([
      Buffer.from(`stoma3d-response-v1\n${requestId}\n`),
      bytes,
    ]);
    if (
      response.headers.get("x-request-id") !== requestId ||
      response.headers.get("x-stoma3d-key-id") !== config.keyId ||
      !response.headers
        .get("cache-control")
        ?.toLowerCase()
        .includes("no-store") ||
      signature.length !== 64 ||
      !verify(null, message, config.key, signature)
    ) {
      throw new RelayError(
        502,
        "invalid_response",
        "The analysis response could not be verified. Please retry.",
      );
    }
    if (!response.ok)
      throw new RelayError(
        response.status === 429 ? 429 : 503,
        "service_unavailable",
        response.status === 429
          ? "Photo analysis is busy. Please try again shortly."
          : "Photo analysis is unavailable. Please retry.",
      );
    try {
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as unknown;
    } catch {
      throw new RelayError(
        502,
        "invalid_response",
        "The analysis response could not be read. Please retry.",
      );
    }
  } catch (error) {
    if (controller.signal.aborted)
      throw new RelayError(
        504,
        "timeout",
        "Photo analysis took too long. Keep your photo and retry.",
      );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
async function releasedCard(options: Options): Promise<ModelCard> {
  const parsed = modelCardSchema.safeParse(
    await verifiedJson("/v1/model-card", { method: "GET" }, options),
  );
  if (!parsed.success)
    throw new RelayError(
      502,
      "invalid_response",
      "Photo analysis details could not be verified. Please retry.",
    );
  return parsed.data;
}
export async function getGuestModelCard(
  options: Options = {},
): Promise<Response> {
  try {
    return Response.json(await releasedCard(options), { headers });
  } catch (error) {
    return failure(error);
  }
}
export async function analyzeGuestScan(
  request: Request,
  options: Options = {},
): Promise<Response> {
  try {
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== new URL(request.url).origin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new RelayError(
        403,
        "cross_site",
        "Open Stoma3D to check your photo.",
      );
    if (!(options.rateLimit ?? guestRequestAllowed)(request))
      throw new RelayError(
        429,
        "rate_limit",
        "Please wait a moment before checking another photo.",
      );
    if (
      !request.headers.get("content-type")?.startsWith("multipart/form-data;")
    )
      throw new RelayError(400, "invalid_photo", "Choose a photo to continue.");
    const bytes = await boundedBytes(request, MAX_REQUEST_BYTES);
    let form: FormData;
    try {
      form = await new Response(bytes as BodyInit, {
        headers: { "content-type": request.headers.get("content-type")! },
      }).formData();
    } catch {
      throw new RelayError(
        400,
        "invalid_photo",
        "This photo could not be read. Choose another photo.",
      );
    }
    const allowed = new Set(["image", "region", "captureId", "inputOrigin"]);
    if (
      [...form.keys()].some(
        (key) => !allowed.has(key) || form.getAll(key).length !== 1,
      )
    )
      throw new RelayError(
        400,
        "invalid_metadata",
        "The photo request is incomplete. Please retry.",
      );
    const image = form.get("image");
    const region = mouthRegionSchema.safeParse(form.get("region"));
    const captureId = form.get("captureId");
    const inputOrigin = form.get("inputOrigin") ?? "live_capture";
    if (
      !(image instanceof Blob) ||
      image.size === 0 ||
      image.size > MAX_IMAGE_BYTES ||
      !["image/jpeg", "image/png", "image/webp"].includes(image.type) ||
      !region.success ||
      typeof captureId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(captureId) ||
      inputOrigin !== "live_capture"
    )
      throw new RelayError(
        400,
        "invalid_photo",
        "Choose a supported mouth photo and region.",
      );
    const magic = new Uint8Array(await image.slice(0, 12).arrayBuffer());
    const matchesType =
      image.type === "image/jpeg"
        ? magic[0] === 255 && magic[1] === 216 && magic[2] === 255
        : image.type === "image/png"
          ? Buffer.from(magic.subarray(0, 8)).equals(
              Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
            )
          : Buffer.from(magic.subarray(0, 4)).toString() === "RIFF" &&
            Buffer.from(magic.subarray(8, 12)).toString() === "WEBP";
    if (!matchesType)
      throw new RelayError(
        400,
        "invalid_photo",
        "This file is not a readable photo. Choose another.",
      );
    const card = await releasedCard(options);
    const metadata = analyzeMetadataSchema.parse({
      contractVersion: CONTRACT_VERSION,
      captureId,
      selectedRegion: region.data,
      inputOrigin: "live_capture",
      requestedHeads: HEADS.filter((head) => card.enabledHeads.includes(head)),
    });
    const upload = new FormData();
    upload.set("image", image, "capture");
    upload.set("metadata", JSON.stringify(metadata));
    const result = analysisResultSchema.safeParse(
      await verifiedJson(
        "/v1/analyze",
        { method: "POST", body: upload },
        options,
      ),
    );
    if (
      !result.success ||
      result.data.captureId !== captureId ||
      result.data.region !== region.data ||
      result.data.inputOrigin !== "live_capture" ||
      ["manual_fixture", "cached_model_result"].includes(
        result.data.analysisOrigin,
      )
    )
      throw new RelayError(
        502,
        "invalid_response",
        "The result does not match your photo. Please retry.",
      );
    return Response.json(result.data, { headers });
  } catch (error) {
    return failure(error);
  }
}
