import { AlphaType, ColorType, Skia } from "@shopify/react-native-skia";
import * as FileSystem from "expo-file-system/legacy";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Image as NativeImage } from "react-native";

import { TRANSPORT_IMAGE_BYTE_LIMIT } from "@/constants";
import { evaluateImageTelemetry, type ImageTelemetry } from "@/lib/quality";
import { createStoma3DTempUri, removeFileIfPresent } from "@/lib/tempFiles";
import { telemetryFromRgba } from "@/lib/imageTelemetry";

export interface SanitizedCapture {
  uri: string;
  mimeType: "image/jpeg" | "image/png";
  telemetry: ImageTelemetry;
  source: "camera" | "photo_library" | "video_sweep";
  width: number;
  height: number;
  byteSize: number;
  privacyStatus?: "passed" | "face_detected" | "unavailable";
  cropped?: boolean;
}

// Vercel Functions reject a whole request above 4.5 MB. Two comparison images
// plus multipart metadata therefore need a deliberately conservative per-image
// ceiling. Container deployments can accept more, but every mobile capture uses
// the same portable bound so saved observations remain comparable on either host.
const SANITIZATION_PROFILES = [
  { longestEdge: 2048, compression: 0.86 },
  { longestEdge: 1792, compression: 0.78 },
  { longestEdge: 1536, compression: 0.7 },
  { longestEdge: 1280, compression: 0.62 },
  { longestEdge: 1152, compression: 0.52 },
] as const;

function telemetryFromBase64(
  base64: string,
  stable: boolean,
  width: number,
  height: number,
  byteSize: number,
): ImageTelemetry {
  let image: ReturnType<typeof Skia.Image.MakeImageFromEncoded> = null;
  try {
    image = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(base64));
    if (!image) throw new Error("Image decode failed");
    const decodedWidth = image.width();
    const decodedHeight = image.height();
    // Pin the output format; native Skia defaults differ across devices.
    // https://shopify.github.io/react-native-skia/docs/images/
    const pixels = image.readPixels(0, 0, {
      width: decodedWidth,
      height: decodedHeight,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    });
    if (!(pixels instanceof Uint8Array))
      throw new Error("Image pixels unavailable");
    return {
      ...telemetryFromRgba(pixels, decodedWidth, decodedHeight),
      faceDetected: false,
      stable,
      width,
      height,
      byteSize,
    };
  } catch {
    // An unavailable measurement is not evidence of blur or darkness.
    return {
      edgeStrength: 0,
      focusVariance: 0,
      meanLuminance: 0,
      highlightFraction: 0,
      obstructionEstimate: 0,
      faceDetected: false,
      stable,
      width,
      height,
      byteSize,
      measurementStatus: "unavailable",
      processingError:
        "Photo checks could not run on this device. The service will check the photo before saving it.",
    };
  } finally {
    image?.dispose();
  }
}

async function imageDimensions(
  uri: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    NativeImage.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () =>
        reject(new Error("The selected file could not be read as an image.")),
    );
  });
}

async function sanitizeImageCapture(
  uri: string,
  options: {
    stable: boolean;
    source: SanitizedCapture["source"];
    unmirror?: boolean;
  },
): Promise<SanitizedCapture> {
  let manipulatedUri: string | null = null;
  let protectedTempUri: string | null = null;
  try {
    const dimensions = await imageDimensions(uri);
    if (
      dimensions.width * dimensions.height > 60_000_000 ||
      Math.max(dimensions.width, dimensions.height) > 16_384
    ) {
      throw new Error(
        "This photo is too large to open on this device. Choose a smaller copy.",
      );
    }
    const sourceLongestEdge = Math.max(dimensions.width, dimensions.height);
    let output: {
      uri: string;
      width: number;
      height: number;
      base64?: string;
    } | null = null;
    let byteSize = Number.POSITIVE_INFINITY;
    for (const profile of SANITIZATION_PROFILES) {
      // Context API performs orientation-aware decoding and creates fresh JPEG
      // pixels, so the original metadata never enters protected storage.
      // https://docs.expo.dev/versions/latest/sdk/imagemanipulator/
      const context = ImageManipulator.manipulate(uri);
      if (options.unmirror) context.flip("horizontal");
      if (sourceLongestEdge > profile.longestEdge) {
        context.resize(
          dimensions.width >= dimensions.height
            ? { width: profile.longestEdge }
            : { height: profile.longestEdge },
        );
      }
      const rendered = await context.renderAsync();
      const candidate = await rendered.saveAsync({
        compress: profile.compression,
        format: SaveFormat.JPEG,
        base64: true,
      });
      if (
        manipulatedUri &&
        manipulatedUri !== uri &&
        manipulatedUri !== candidate.uri
      ) {
        await removeFileIfPresent(manipulatedUri);
      }
      manipulatedUri = candidate.uri;
      output = candidate;
      if (!candidate.base64) {
        throw new Error("Could not create a metadata-free image.");
      }
      byteSize = Math.floor((candidate.base64.length * 3) / 4);
      if (byteSize <= TRANSPORT_IMAGE_BYTE_LIMIT) break;
    }
    if (!output?.base64 || byteSize > TRANSPORT_IMAGE_BYTE_LIMIT) {
      throw new Error(
        "The image could not be reduced to the protected upload-size limit. Choose a more tightly framed photo.",
      );
    }
    protectedTempUri = await createStoma3DTempUri("capture", "jpg");
    await FileSystem.writeAsStringAsync(protectedTempUri, output.base64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    let telemetry: ImageTelemetry;
    let qualityUri: string | null = null;
    try {
      const context = ImageManipulator.manipulate(output.uri);
      const longest = Math.max(output.width, output.height);
      if (longest > 512)
        context.resize(
          output.width >= output.height ? { width: 512 } : { height: 512 },
        );
      const rendered = await context.renderAsync();
      const measurementImage = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.95,
        base64: true,
      });
      qualityUri = measurementImage.uri;
      if (!measurementImage.base64) throw new Error("Photo pixels unavailable");
      telemetry = telemetryFromBase64(
        measurementImage.base64,
        options.stable,
        output.width,
        output.height,
        byteSize,
      );
    } catch {
      telemetry = {
        edgeStrength: 0,
        meanLuminance: 0,
        highlightFraction: 0,
        obstructionEstimate: 0,
        faceDetected: false,
        stable: options.stable,
        width: output.width,
        height: output.height,
        byteSize,
        measurementStatus: "unavailable",
        processingError:
          "Photo checks could not run on this device. The service will check the photo before saving it.",
      };
    } finally {
      if (qualityUri && qualityUri !== output.uri)
        await removeFileIfPresent(qualityUri);
    }
    const capture = {
      uri: protectedTempUri,
      mimeType: "image/jpeg" as const,
      telemetry,
      source: options.source,
      width: output.width,
      height: output.height,
      byteSize,
    };
    protectedTempUri = null;
    return capture;
  } finally {
    if (manipulatedUri && manipulatedUri !== uri) {
      await removeFileIfPresent(manipulatedUri);
    }
    await removeFileIfPresent(protectedTempUri);
  }
}

export async function sanitizeCameraCapture(
  uri: string,
  stable: boolean,
  unmirror = false,
): Promise<SanitizedCapture> {
  return sanitizeImageCapture(uri, { stable, source: "camera", unmirror });
}

export async function sanitizeSelectedImage(
  uri: string,
): Promise<SanitizedCapture> {
  return sanitizeImageCapture(uri, {
    stable: true,
    source: "photo_library",
  });
}

export async function sanitizeVideoFrame(
  uri: string,
  unmirror = false,
): Promise<SanitizedCapture> {
  return sanitizeImageCapture(uri, {
    stable: true,
    source: "video_sweep",
    unmirror,
  });
}

export function qualityForSanitizedCapture(capture: SanitizedCapture) {
  return evaluateImageTelemetry(capture.telemetry, "advisory");
}

export async function editSanitizedCapture(
  capture: SanitizedCapture,
  edit: {
    crop?: { originX: number; originY: number; width: number; height: number };
    rotate?: number;
  },
): Promise<SanitizedCapture> {
  let editedUri: string | null = null;
  try {
    const context = ImageManipulator.manipulate(capture.uri);
    if (edit.rotate) context.rotate(edit.rotate);
    if (edit.crop) context.crop(edit.crop);
    const rendered = await context.renderAsync();
    const edited = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.95,
    });
    editedUri = edited.uri;
    return {
      ...(await sanitizeImageCapture(edited.uri, {
        source: capture.source,
        stable: capture.telemetry.stable,
      })),
      cropped: edit.crop !== undefined || capture.cropped === true,
    };
  } finally {
    await removeFileIfPresent(editedUri);
  }
}
