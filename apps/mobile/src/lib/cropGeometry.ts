export interface NormalizedCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function moveCrop(
  crop: NormalizedCrop,
  dx: number,
  dy: number,
): NormalizedCrop {
  return {
    ...crop,
    x: clamp(crop.x + dx, 0, 1 - crop.width),
    y: clamp(crop.y + dy, 0, 1 - crop.height),
  };
}

export function resizeCrop(
  crop: NormalizedCrop,
  factor: number,
): NormalizedCrop {
  const width = clamp(crop.width * factor, 0.15, 1);
  const height = clamp(crop.height * factor, 0.15, 1);
  return {
    width,
    height,
    x: clamp(crop.x + (crop.width - width) / 2, 0, 1 - width),
    y: clamp(crop.y + (crop.height - height) / 2, 0, 1 - height),
  };
}

export function cropToPixels(
  crop: NormalizedCrop,
  width: number,
  height: number,
) {
  const originX = Math.round(crop.x * width);
  const originY = Math.round(crop.y * height);
  return {
    originX,
    originY,
    width: Math.max(
      1,
      Math.min(width - originX, Math.round(crop.width * width)),
    ),
    height: Math.max(
      1,
      Math.min(height - originY, Math.round(crop.height * height)),
    ),
  };
}
