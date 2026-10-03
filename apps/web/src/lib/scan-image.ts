export interface PreparedPhoto {
  image: string;
  blob: Blob;
  width: number;
  height: number;
}
export interface PhotoCrop {
  left: number;
  top: number;
  width: number;
  height: number;
}
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 1_750_000;

export function preparedPhotoFromSaved(
  image: string,
  width: number,
  height: number,
): PreparedPhoto {
  const prefix = "data:image/jpeg;base64,";
  if (!image.startsWith(prefix))
    throw new Error("The saved photo could not be read.");
  const binary = atob(image.slice(prefix.length));
  const bytes = Uint8Array.from(binary, (value) => value.charCodeAt(0));
  return {
    image,
    width,
    height,
    blob: new Blob([bytes], { type: "image/jpeg" }),
  };
}

export function validatePhotoFile(file: Pick<File, "type" | "size" | "name">) {
  if (file.size > MAX_SOURCE_BYTES)
    throw new Error("Choose a photo smaller than 25 MB.");
  if (
    !/^image\/(jpeg|png|webp|heic|heif|avif)$/i.test(file.type) &&
    !/\.(jpe?g|png|webp|heic|heif|avif)$/i.test(file.name)
  ) {
    throw new Error("Choose a JPEG, PNG, HEIC, or other supported photo.");
  }
}

export function fittedImageSize(width: number, height: number, maxSide = 1600) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("The photo could not be read. Choose another.");
  const ratio = Math.min(1, maxSide / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(
              new Error("The photo could not be prepared. Choose another."),
            ),
      "image/jpeg",
      quality,
    ),
  );
}

export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(new Error("The photo could not be read. Choose another."));
    reader.readAsDataURL(blob);
  });
}

export async function prepareCanvasPhoto(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  crop?: PhotoCrop,
  turns = 0,
): Promise<PreparedPhoto> {
  const area = crop ?? { left: 0, top: 0, width: 1, height: 1 };
  const sx = Math.round(area.left * sourceWidth),
    sy = Math.round(area.top * sourceHeight);
  const sw = Math.round(area.width * sourceWidth),
    sh = Math.round(area.height * sourceHeight);
  if (
    sw <= 0 ||
    sh <= 0 ||
    sx < 0 ||
    sy < 0 ||
    sx + sw > sourceWidth ||
    sy + sh > sourceHeight
  )
    throw new Error("Keep the crop inside the photo.");
  const rotated = Math.abs(turns) % 2 === 1;
  const fitted = fittedImageSize(rotated ? sh : sw, rotated ? sw : sh);
  const canvas = document.createElement("canvas");
  canvas.width = fitted.width;
  canvas.height = fitted.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context)
    throw new Error("Photo processing is unavailable in this browser.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((turns * Math.PI) / 2);
  context.drawImage(
    source,
    sx,
    sy,
    sw,
    sh,
    -(rotated ? fitted.height : fitted.width) / 2,
    -(rotated ? fitted.width : fitted.height) / 2,
    rotated ? fitted.height : fitted.width,
    rotated ? fitted.width : fitted.height,
  );
  let blob = await canvasBlob(canvas, 0.84);
  if (blob.size > MAX_UPLOAD_BYTES) blob = await canvasBlob(canvas, 0.62);
  if (blob.size > MAX_UPLOAD_BYTES)
    throw new Error(
      "This photo is too large to send. Crop closer to the mouth.",
    );
  return { ...fitted, blob, image: await blobDataUrl(blob) };
}

export async function decodePhoto(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    // A decode failure and a decoded image that is too large need different
    // recovery instructions. https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode
    try {
      await image.decode();
    } catch {
      throw new Error(
        "This browser could not read that photo. For HEIC photos, choose a JPEG copy or take a photo here.",
      );
    }
    if (image.naturalWidth * image.naturalHeight > 50_000_000)
      throw new Error("Choose a smaller photo.");
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function preparePhotoFile(file: File): Promise<PreparedPhoto> {
  validatePhotoFile(file);
  const image = await decodePhoto(file);
  // Canvas re-encoding applies browser-decoded orientation and drops EXIF metadata.
  // https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
  return prepareCanvasPhoto(image, image.naturalWidth, image.naturalHeight);
}
