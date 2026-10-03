export const CAMERA_STARTUP_TIMEOUT_MS = 20_000;

export class CameraStartupTimeoutError extends Error {
  constructor() {
    super("Camera startup timed out.");
    this.name = "CameraStartupTimeoutError";
  }
}

interface CameraStartupOptions {
  requestStream: () => Promise<MediaStream>;
  playStream: (stream: MediaStream) => Promise<void>;
  signal: AbortSignal;
  timeoutMs?: number;
}

export function stopCameraStream(stream: MediaStream) {
  // Stop every track when a preview is cancelled or replaced.
  // https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/stop#examples
  stream.getTracks().forEach((track) => track.stop());
}

export function startCameraPreview({
  requestStream,
  playStream,
  signal,
  timeoutMs = CAMERA_STARTUP_TIMEOUT_MS,
}: CameraStartupOptions): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    let finished = false;
    let stream: MediaStream | null = null;
    // A permission request may never settle; playback can also be delayed.
    // https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
    // https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play#usage_notes
    const timeout = setTimeout(
      () => fail(new CameraStartupTimeoutError()),
      timeoutMs,
    );
    const cleanup = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancelled);
    };
    const fail = (error: unknown) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (stream) stopCameraStream(stream);
      reject(error);
    };
    const cancelled = () =>
      fail(new DOMException("Camera startup cancelled.", "AbortError"));

    if (signal.aborted) {
      cancelled();
      return;
    }
    signal.addEventListener("abort", cancelled, { once: true });
    try {
      void requestStream().then(async (received) => {
        if (finished) {
          // getUserMedia cannot be aborted. Release a late permission grant.
          stopCameraStream(received);
          return;
        }
        stream = received;
        try {
          await playStream(received);
          if (finished) return;
          finished = true;
          cleanup();
          resolve(received);
        } catch (error) {
          fail(error);
        }
      }, fail);
    } catch (error) {
      fail(error);
    }
  });
}

export async function prepareCurrentCameraPhoto<Photo>(
  prepare: () => Promise<Photo>,
  isCurrent: () => boolean,
): Promise<Photo | null> {
  if (!isCurrent()) return null;
  try {
    const photo = await prepare();
    return isCurrent() ? photo : null;
  } catch (error) {
    if (isCurrent()) throw error;
    return null;
  }
}
