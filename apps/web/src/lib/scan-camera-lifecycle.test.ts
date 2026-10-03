import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAMERA_STARTUP_TIMEOUT_MS,
  CameraStartupTimeoutError,
  prepareCurrentCameraPhoto,
  startCameraPreview,
} from "./scan-camera-lifecycle";

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function cameraStream() {
  const track = {
    readyState: "live",
    stop() {
      this.readyState = "ended";
    },
  };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

function observe<Value>(promise: Promise<Value>) {
  const result = {
    state: "pending" as "pending" | "ready" | "failed",
    value: undefined as Value | undefined,
    error: undefined as unknown,
  };
  void promise.then(
    (value) => {
      result.state = "ready";
      result.value = value;
    },
    (error) => {
      result.state = "failed";
      result.error = error;
    },
  );
  return result;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("browser camera startup", () => {
  it("finishes a stalled permission request after twenty seconds", async () => {
    vi.useFakeTimers();
    const permission = deferred<MediaStream>();
    const result = observe(
      startCameraPreview({
        requestStream: () => permission.promise,
        playStream: async () => undefined,
        signal: new AbortController().signal,
      }),
    );

    await vi.advanceTimersByTimeAsync(CAMERA_STARTUP_TIMEOUT_MS - 1);
    expect(result.state).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(result.state).toBe("failed");
    expect(result.error).toBeInstanceOf(CameraStartupTimeoutError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops a stream granted after timeout without opening its preview", async () => {
    vi.useFakeTimers();
    const permission = deferred<MediaStream>();
    const { stream, track } = cameraStream();
    let previewOpened = false;
    const result = observe(
      startCameraPreview({
        requestStream: () => permission.promise,
        playStream: async () => {
          previewOpened = true;
        },
        signal: new AbortController().signal,
      }),
    );

    await vi.advanceTimersByTimeAsync(CAMERA_STARTUP_TIMEOUT_MS);
    permission.resolve(stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(result.state).toBe("failed");
    expect(track.readyState).toBe("ended");
    expect(previewOpened).toBe(false);
  });

  it("bounds stalled video playback and releases the acquired stream", async () => {
    vi.useFakeTimers();
    const playback = deferred<void>();
    const { stream, track } = cameraStream();
    const result = observe(
      startCameraPreview({
        requestStream: async () => stream,
        playStream: () => playback.promise,
        signal: new AbortController().signal,
      }),
    );

    await vi.advanceTimersByTimeAsync(CAMERA_STARTUP_TIMEOUT_MS);
    expect(result.state).toBe("failed");
    expect(result.error).toBeInstanceOf(CameraStartupTimeoutError);
    expect(track.readyState).toBe("ended");
    playback.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(result.state).toBe("failed");
  });

  it("cancels an unresolved permission request and stops any late stream", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const permission = deferred<MediaStream>();
    const { stream, track } = cameraStream();
    const result = observe(
      startCameraPreview({
        requestStream: () => permission.promise,
        playStream: async () => undefined,
        signal: controller.signal,
      }),
    );

    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(result.state).toBe("failed");
    expect(result.error).toMatchObject({ name: "AbortError" });
    expect(vi.getTimerCount()).toBe(0);
    permission.resolve(stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(track.readyState).toBe("ended");
    expect(result.state).toBe("failed");
  });

  it("cannot reopen the camera when playback finishes after cancellation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const playback = deferred<void>();
    const { stream, track } = cameraStream();
    const result = observe(
      startCameraPreview({
        requestStream: async () => stream,
        playStream: () => playback.promise,
        signal: controller.signal,
      }),
    );

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(result.state).toBe("failed");
    expect(track.readyState).toBe("ended");
    playback.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(result.state).toBe("failed");
  });

  it("does not request media when the capture screen is already closed", async () => {
    const controller = new AbortController();
    controller.abort();
    let requested = false;
    const { stream, track } = cameraStream();

    await expect(
      startCameraPreview({
        requestStream: async () => {
          requested = true;
          return stream;
        },
        playStream: async () => undefined,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(requested).toBe(false);
    expect(track.readyState).toBe("live");
  });

  it("keeps a successful preview open without leaving a timeout behind", async () => {
    vi.useFakeTimers();
    const { stream, track } = cameraStream();
    const result = observe(
      startCameraPreview({
        requestStream: async () => stream,
        playStream: async () => undefined,
        signal: new AbortController().signal,
      }),
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(result.state).toBe("ready");
    expect(result.value).toBe(stream);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(CAMERA_STARTUP_TIMEOUT_MS);
    expect(track.readyState).toBe("live");
  });

  it("preserves a permission refusal instead of treating it as timeout", async () => {
    vi.useFakeTimers();
    const refusal = new DOMException("Permission refused.", "NotAllowedError");
    await expect(
      startCameraPreview({
        requestStream: async () => {
          throw refusal;
        },
        playStream: async () => undefined,
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(refusal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the stream when its preview cannot play", async () => {
    const { stream, track } = cameraStream();
    const failure = new Error("Preview could not play.");
    await expect(
      startCameraPreview({
        requestStream: async () => stream,
        playStream: async () => {
          throw failure;
        },
        signal: new AbortController().signal,
      }),
    ).rejects.toBe(failure);
    expect(track.readyState).toBe("ended");
  });
});

describe("camera and uploaded photo preparation", () => {
  it("ignores a photo that finishes decoding after capture is closed", async () => {
    const decode = deferred<string>();
    let current = true;
    const result = prepareCurrentCameraPhoto(
      () => decode.promise,
      () => current,
    );
    current = false;
    decode.resolve("prepared mouth photo");
    await expect(result).resolves.toBeNull();
  });

  it("ignores a decoding failure from an abandoned capture", async () => {
    const decode = deferred<string>();
    let current = true;
    const result = prepareCurrentCameraPhoto(
      () => decode.promise,
      () => current,
    );
    current = false;
    decode.reject(new Error("This photo cannot be decoded."));
    await expect(result).resolves.toBeNull();
  });

  it("returns a prepared photo while its capture remains current", async () => {
    await expect(
      prepareCurrentCameraPhoto(
        async () => "prepared mouth photo",
        () => true,
      ),
    ).resolves.toBe("prepared mouth photo");
  });

  it("preserves a decoding failure from the current capture", async () => {
    const failure = new Error("This photo cannot be decoded.");
    await expect(
      prepareCurrentCameraPhoto(
        async () => {
          throw failure;
        },
        () => true,
      ),
    ).rejects.toBe(failure);
  });
});
