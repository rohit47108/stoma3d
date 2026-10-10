"use client";

import { useEffect, useRef, useState } from "react";
import type { GuestSession } from "@/lib/guest-scan";
import { subscribeGuestDataReset } from "@/lib/guest-storage";
import {
  prepareGuestReportDownload,
  releaseGuestReportDownload,
  type GuestReportDownload,
} from "@/lib/guest-report-download";

export function ScanReportTools({ session }: { session: GuestSession }) {
  const [download, setDownload] = useState<GuestReportDownload | null>(null);
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pendingRef = useRef<AbortController | null>(null);
  const downloadRef = useRef<GuestReportDownload | null>(null);

  useEffect(() => {
    const clear = () => {
      pendingRef.current?.abort();
      pendingRef.current = null;
      releaseGuestReportDownload(downloadRef.current);
      downloadRef.current = null;
    };
    const unsubscribe = subscribeGuestDataReset(() => {
      clear();
      setDownload(null);
      setCreating(false);
      setProblem(null);
    });
    return () => {
      unsubscribe();
      clear();
    };
  }, []);

  async function create() {
    if (pendingRef.current || downloadRef.current) return;
    const controller = new AbortController();
    pendingRef.current = controller;
    setCreating(true);
    setProblem(null);
    try {
      const artifact = await prepareGuestReportDownload(
        session,
        controller.signal,
      );
      if (controller.signal.aborted) {
        releaseGuestReportDownload(artifact);
        return;
      }
      downloadRef.current = artifact;
      setDownload(artifact);
    } catch {
      if (!controller.signal.aborted)
        setProblem(
          "The PDF could not be created. Try again, or use Print report.",
        );
    } finally {
      if (pendingRef.current === controller) {
        pendingRef.current = null;
        setCreating(false);
      }
    }
  }

  return (
    <section aria-label="Report" className="scan-report-tools">
      <div className="scan-actions">
        {download ? (
          <a
            className="scan-text-button"
            href={download.url}
            download={download.fileName}
          >
            Download PDF
          </a>
        ) : (
          <button
            type="button"
            className="scan-text-button"
            disabled={creating}
            onClick={() => void create()}
          >
            {creating ? "Creating report…" : "Create PDF report"}
          </button>
        )}
        <button
          type="button"
          className="scan-text-button"
          disabled={creating}
          onClick={() => window.print()}
        >
          Print report
        </button>
      </div>
      {download && (
        <p className="scan-help" role="status">
          PDF ready. A downloaded copy stays in your files.
        </p>
      )}
      {problem && (
        <p className="scan-error" role="alert">
          {problem}
        </p>
      )}
    </section>
  );
}
