import { afterEach, describe, expect, it, vi } from "vitest";
import { blobDataUrl, decodePhoto, prepareCanvasPhoto } from "./scan-image";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function observe<T>(promise: Promise<T>) {
  const result: { state: string; value?: T; error?: unknown } = {
    state: "pending",
  };
  void promise.then(
    (value) => Object.assign(result, { state: "ready", value }),
    (error: unknown) => Object.assign(result, { state: "failed", error }),
  );
  return result;
}

function pendingDecoder() {
  let finish!: () => void;
  const decoded = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const images: Array<{ src: string }> = [];
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      naturalWidth = 512;
      naturalHeight = 512;
      constructor() {
        images.push(this);
      }
      decode() {
        return decoded;
      }
    },
  );
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:photo-test");
  const revoked = vi
    .spyOn(URL, "revokeObjectURL")
    .mockImplementation(() => undefined);
  return { images, finish, revoked };
}

describe("photo preparation recovery", () => {
  it("ends a stalled decoder with retry advice, releases its image, and ignores late success", async () => {
    vi.useFakeTimers();
    const decoder = pendingDecoder();
    const result = observe(decodePhoto(new Blob(["photo"])));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(result.state).toBe("failed");
    expect(result.error).toMatchObject({
      name: "PhotoPreparationTimeoutError",
      message:
        "Preparing this photo took too long. Try again or choose another.",
    });
    expect(decoder.revoked).toHaveBeenCalledWith("blob:photo-test");
    expect(decoder.images[0]!.src).toBe("");
    decoder.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(result.state).toBe("failed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels an abandoned decoder immediately rather than waiting for its result", async () => {
    vi.useFakeTimers();
    const decoder = pendingDecoder();
    const controller = new AbortController();
    const result = observe(decodePhoto(new Blob(["photo"]), controller.signal));
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(result.error).toMatchObject({ name: "AbortError" });
    expect(decoder.revoked).toHaveBeenCalledWith("blob:photo-test");
    expect(decoder.images[0]!.src).toBe("");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not allocate an image URL for work already cancelled", async () => {
    pendingDecoder();
    const created = vi.mocked(URL.createObjectURL);
    const controller = new AbortController();
    controller.abort();
    const result = observe(decodePhoto(new Blob(["photo"]), controller.signal));
    await Promise.resolve();
    expect(result.error).toMatchObject({ name: "AbortError" });
    expect(created).not.toHaveBeenCalled();
  });

  it("ends stalled canvas encoding without returning an empty or substitute photo", async () => {
    vi.useFakeTimers();
    let callback!: BlobCallback;
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect() {},
        translate() {},
        rotate() {},
        drawImage() {},
      }),
      toBlob: (received: BlobCallback) => {
        callback = received;
      },
    };
    vi.stubGlobal("document", { createElement: () => canvas });
    const result = observe(
      prepareCanvasPhoto({} as CanvasImageSource, 640, 480),
    );
    await vi.advanceTimersByTimeAsync(20_000);
    expect(result.error).toMatchObject({
      name: "PhotoPreparationTimeoutError",
    });
    expect(result.value).toBeUndefined();
    callback(new Blob(["late JPEG"], { type: "image/jpeg" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(result.state).toBe("failed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a pending photo read and removes its event handlers", async () => {
    vi.useFakeTimers();
    const readers: Array<{
      onload: unknown;
      onerror: unknown;
      onabort: unknown;
      aborted: boolean;
    }> = [];
    vi.stubGlobal(
      "FileReader",
      class {
        onload = null;
        onerror = null;
        onabort = null;
        aborted = false;
        readAsDataURL() {
          readers.push(this);
        }
        abort() {
          this.aborted = true;
        }
      },
    );
    const controller = new AbortController();
    const result = observe(blobDataUrl(new Blob(["photo"]), controller.signal));
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(result.error).toMatchObject({ name: "AbortError" });
    expect(readers[0]!.aborted).toBe(true);
    expect(readers[0]!.onload).toBeNull();
    expect(readers[0]!.onerror).toBeNull();
    expect(readers[0]!.onabort).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a stalled photo read without keeping its reader active", async () => {
    vi.useFakeTimers();
    let aborted = false;
    vi.stubGlobal(
      "FileReader",
      class {
        onload = null;
        onerror = null;
        onabort = null;
        readAsDataURL() {}
        abort() {
          aborted = true;
        }
      },
    );
    const result = observe(blobDataUrl(new Blob(["photo"])));
    await vi.advanceTimersByTimeAsync(20_000);
    expect(result.error).toMatchObject({
      name: "PhotoPreparationTimeoutError",
    });
    expect(aborted).toBe(true);
    expect(result.value).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("releases the temporary canvas on cancellation and does not read a late encoded photo", async () => {
    vi.useFakeTimers();
    let callback!: BlobCallback;
    const read = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect() {},
        translate() {},
        rotate() {},
        drawImage() {},
      }),
      toBlob: (received: BlobCallback) => {
        callback = received;
      },
    };
    vi.stubGlobal("document", { createElement: () => canvas });
    vi.stubGlobal(
      "FileReader",
      class {
        readAsDataURL = read;
      },
    );
    const controller = new AbortController();
    const result = observe(
      prepareCanvasPhoto(
        {} as CanvasImageSource,
        640,
        480,
        undefined,
        0,
        controller.signal,
      ),
    );
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(result.error).toMatchObject({ name: "AbortError" });
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    callback(new Blob(["late JPEG"], { type: "image/jpeg" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(read).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps an encoding failure distinct from blur and releases the temporary pixels", async () => {
    vi.useFakeTimers();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect() {},
        translate() {},
        rotate() {},
        drawImage() {},
      }),
      toBlob: (received: BlobCallback) => received(null),
    };
    vi.stubGlobal("document", { createElement: () => canvas });
    await expect(
      prepareCanvasPhoto({} as CanvasImageSource, 640, 480),
    ).rejects.toThrow("The photo could not be prepared. Choose another.");
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["context", "drawing"])(
    "clears temporary pixels when %s fails before encoding",
    async (stage) => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () =>
          stage === "context"
            ? null
            : {
                fillRect() {},
                translate() {},
                rotate() {},
                drawImage() {
                  throw new Error("The source could not be drawn.");
                },
              },
        toBlob: vi.fn(),
      };
      vi.stubGlobal("document", { createElement: () => canvas });
      await expect(
        prepareCanvasPhoto({} as CanvasImageSource, 640, 480),
      ).rejects.toThrow(
        stage === "context"
          ? "Photo processing is unavailable in this browser."
          : "The source could not be drawn.",
      );
      expect(canvas.width).toBe(0);
      expect(canvas.height).toBe(0);
      expect(canvas.toBlob).not.toHaveBeenCalled();
    },
  );

  it("returns the re-encoded photo at its fitted size and clears all temporary work", async () => {
    vi.useFakeTimers();
    const encoded = new Blob(["encoded JPEG"], { type: "image/jpeg" });
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect() {},
        translate() {},
        rotate() {},
        drawImage() {},
      }),
      toBlob: (received: BlobCallback) => received(encoded),
    };
    vi.stubGlobal("document", { createElement: () => canvas });
    vi.stubGlobal(
      "FileReader",
      class {
        result = "data:image/jpeg;base64,cGhvdG8=";
        onload: (() => void) | null = null;
        onerror = null;
        onabort = null;
        readAsDataURL() {
          this.onload?.();
        }
      },
    );
    await expect(
      prepareCanvasPhoto({} as CanvasImageSource, 3200, 2400),
    ).resolves.toMatchObject({
      width: 1600,
      height: 1200,
      blob: encoded,
      image: "data:image/jpeg;base64,cGhvdG8=",
    });
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("photo decoding errors", () => {
  it("asks for a smaller photo when a valid JPEG exceeds the decoded pixel limit", async () => {
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        naturalWidth = 10_000;
        naturalHeight = 6_000;
        async decode() {}
      },
    );

    await expect(
      decodePhoto(new Blob(["jpeg"], { type: "image/jpeg" })),
    ).rejects.toThrow("Choose a smaller photo.");
  });

  it("keeps format recovery advice for a photo the browser cannot decode", async () => {
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        async decode() {
          throw new Error("Unsupported format.");
        }
      },
    );

    await expect(
      decodePhoto(new Blob(["heic"], { type: "image/heic" })),
    ).rejects.toThrow(
      "This browser could not read that photo. For HEIC photos, choose a JPEG copy or take a photo here.",
    );
  });

  it("returns a successfully decoded photo within the pixel limit", async () => {
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        naturalWidth = 512;
        naturalHeight = 512;
        async decode() {}
      },
    );

    await expect(
      decodePhoto(new Blob(["jpeg"], { type: "image/jpeg" })),
    ).resolves.toMatchObject({ naturalWidth: 512, naturalHeight: 512 });
  });
});
