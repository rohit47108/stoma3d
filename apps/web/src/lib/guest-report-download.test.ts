import { afterEach, describe, expect, it, vi } from "vitest";
import { createGuestSession } from "./guest-scan";
import {
  prepareGuestReportDownload,
  releaseGuestReportDownload,
} from "./guest-report-download";

afterEach(() => vi.restoreAllMocks());

describe("guest report download lifetime", () => {
  it("offers a PDF blob with a fixed, safe filename and releases its URL", async () => {
    const saved = createGuestSession(
      "../../not-a-filename",
      "2026-10-09T12:00:00.000Z",
    );
    const createUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:report-test");
    const revokeUrl = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const artifact = await prepareGuestReportDownload(
      saved,
      new AbortController().signal,
      async () => new Uint8Array([37, 80, 68, 70]),
    );
    expect(artifact.fileName).toBe("Stoma3D-report-2026-10-09.pdf");
    expect(artifact.url).toBe("blob:report-test");
    const blob = createUrl.mock.calls[0]![0] as Blob;
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBe(4);
    releaseGuestReportDownload(artifact);
    expect(revokeUrl).toHaveBeenCalledWith("blob:report-test");
  });

  it("does not create a download if the page closes or data is cleared during generation", async () => {
    const controller = new AbortController();
    const createUrl = vi.spyOn(URL, "createObjectURL");
    let finish!: (bytes: Uint8Array<ArrayBuffer>) => void;
    const rendering = new Promise<Uint8Array<ArrayBuffer>>((resolve) => {
      finish = resolve;
    });
    const result = prepareGuestReportDownload(
      createGuestSession("scan"),
      controller.signal,
      () => rendering,
    );
    controller.abort();
    finish(new Uint8Array([37, 80, 68, 70]));
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("does not start an already cancelled export or manufacture a PDF after renderer failure", async () => {
    const controller = new AbortController();
    controller.abort();
    const renderer = vi.fn(async () => new Uint8Array([1]));
    await expect(
      prepareGuestReportDownload(
        createGuestSession("scan"),
        controller.signal,
        renderer,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(renderer).not.toHaveBeenCalled();
    const createUrl = vi.spyOn(URL, "createObjectURL");
    await expect(
      prepareGuestReportDownload(
        createGuestSession("scan"),
        new AbortController().signal,
        async () => {
          throw new Error("unreadable saved photo");
        },
      ),
    ).rejects.toThrow("unreadable saved photo");
    expect(createUrl).not.toHaveBeenCalled();
  });
});
