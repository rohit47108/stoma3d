import type { ImageTelemetry } from "./quality";

/** Receives explicit RGBA_8888 pixels, never platform-default BGRA/float data. */
export function telemetryFromRgba(
  pixels: Uint8Array,
  width: number,
  height: number,
): Omit<ImageTelemetry, "stable" | "faceDetected"> {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 3 ||
    height < 3 ||
    pixels.length !== width * height * 4
  ) {
    throw new Error(
      "Photo pixels could not be read. Choose another photo or try again.",
    );
  }
  const luminance = new Float64Array(width * height);
  let luminanceTotal = 0;
  let highlights = 0;
  let dark = 0;
  let wellExposed = 0;
  let edges = 0;
  let edgeSamples = 0;
  for (let index = 0; index < luminance.length; index += 1) {
    const offset = index * 4;
    const red = pixels[offset]!;
    const green = pixels[offset + 1]!;
    const blue = pixels[offset + 2]!;
    const gray = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
    luminance[index] = gray;
    luminanceTotal += gray;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    if (
      maximum >= 245 &&
      (maximum === 0 ? 0 : ((maximum - minimum) / maximum) * 255) <= 55
    )
      highlights += 1;
    if (gray * 255 <= 20) dark += 1;
    if (gray * 255 >= 30 && gray * 255 <= 225) wellExposed += 1;
  }
  let laplacianTotal = 0;
  let laplacianSquares = 0;
  let samples = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const center = luminance[index]!;
      const laplacian =
        4 * center -
        luminance[index - 1]! -
        luminance[index + 1]! -
        luminance[index - width]! -
        luminance[index + width]!;
      laplacianTotal += laplacian;
      laplacianSquares += laplacian * laplacian;
      samples += 1;
      edges +=
        Math.abs(center - luminance[index + 1]!) +
        Math.abs(center - luminance[index + width]!);
      edgeSamples += 2;
    }
  }
  return {
    edgeStrength: edges / edgeSamples,
    focusVariance: Math.max(
      0,
      laplacianSquares / samples - (laplacianTotal / samples) ** 2,
    ),
    meanLuminance: luminanceTotal / luminance.length,
    highlightFraction: highlights / luminance.length,
    obstructionEstimate: dark / luminance.length,
    wellExposedFraction: wellExposed / luminance.length,
    measurementStatus: "measured",
  };
}
