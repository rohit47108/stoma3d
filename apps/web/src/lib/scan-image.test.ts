import { afterEach, describe, expect, it, vi } from "vitest";
import { decodePhoto } from "./scan-image";

afterEach(() => {
  vi.unstubAllGlobals();
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
