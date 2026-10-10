import type { GuestSession } from "./guest-scan";

export interface GuestReportDownload {
  url: string;
  fileName: string;
}

type Renderer = (
  session: GuestSession,
  signal: AbortSignal,
) => Promise<Uint8Array<ArrayBuffer>>;

export async function prepareGuestReportDownload(
  session: GuestSession,
  signal: AbortSignal,
  render: Renderer = async (saved, cancellation) => {
    // Load PDF code only when requested; the camera and map do not pay its startup cost.
    const { createGuestReportPdf } = await import("./guest-report-pdf");
    return createGuestReportPdf(saved, cancellation);
  },
): Promise<GuestReportDownload> {
  signal.throwIfAborted();
  const bytes = await render(session, signal);
  signal.throwIfAborted();
  const fileName = `Stoma3D-report-${new Date(session.createdAt).toISOString().slice(0, 10)}.pdf`;
  return {
    url: URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })),
    fileName,
  };
}

export function releaseGuestReportDownload(
  artifact: GuestReportDownload | null,
): void {
  // Release the in-memory PDF when leaving the page, changing scans, or clearing data.
  // https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static
  if (artifact) URL.revokeObjectURL(artifact.url);
}
