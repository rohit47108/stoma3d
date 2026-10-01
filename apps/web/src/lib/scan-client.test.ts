import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeGuestPhoto } from "./scan-client";

const photo = {
  image: "data:image/jpeg;base64,dGVzdA==",
  blob: new Blob(["test"], { type: "image/jpeg" }),
  width: 640,
  height: 480,
};

afterEach(() => vi.unstubAllGlobals());

describe("guest analysis response handling", () => {
  it("shows the relay's recoverable service message instead of inventing analysis", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "unavailable",
              message: "The analysis service is offline. Try again.",
            },
          }),
          { status: 503 },
        ),
    );
    await expect(
      analyzeGuestPhoto(
        photo,
        "dorsal_tongue",
        "capture-1",
        new AbortController().signal,
      ),
    ).rejects.toThrow("offline");
  });

  it("rejects malformed successful responses", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({ status: "complete", captureId: "capture-1" }),
        ),
    );
    await expect(
      analyzeGuestPhoto(
        photo,
        "dorsal_tongue",
        "capture-1",
        new AbortController().signal,
      ),
    ).rejects.toThrow("verified");
  });

  it("does not treat an HTML error page as a normal result", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("<html>Service error</html>", { status: 502 }),
    );
    await expect(
      analyzeGuestPhoto(
        photo,
        "dorsal_tongue",
        "capture-1",
        new AbortController().signal,
      ),
    ).rejects.toThrow("unavailable");
  });

  it("propagates cancelled or timed out requests without fabricated output", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(
      analyzeGuestPhoto(
        photo,
        "dorsal_tongue",
        "capture-1",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
