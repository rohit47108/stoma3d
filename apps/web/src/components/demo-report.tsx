"use client";

import { useEffect, useRef, useState } from "react";
import { DemoPhoto } from "./demo-photo";
import { sampleCase } from "@/lib/demo-tour";

export function DemoReport({ matchConfirmed }: { matchConfirmed: boolean }) {
  const [download, setDownload] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(false);
  const active = useRef(true);
  const artifact = useRef<string | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (artifact.current) URL.revokeObjectURL(artifact.current);
    };
  }, []);

  async function prepare() {
    if (busy) return;
    setBusy(true);
    setProblem(false);
    try {
      const { createDemoReportPdf } = await import("@/lib/demo-report");
      const bytes = await createDemoReportPdf(matchConfirmed);
      if (!active.current) return;
      if (artifact.current) URL.revokeObjectURL(artifact.current);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/pdf" }),
      );
      artifact.current = url;
      setDownload(url);
    } catch {
      if (active.current) setProblem(true);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  const observation = sampleCase.observations[0];
  return (
    <>
      <section
        className="demo-report-sheet"
        aria-label="Sample observation report"
      >
        <div className="demo-report-heading">
          <div>
            <p className="demo-eyebrow">Stoma3D</p>
            <h2>Observation report</h2>
          </div>
          <span className="demo-badge">Sample</span>
        </div>
        <p>October 17, 2026 · Eight-region sample scan</p>
        <div className="demo-two-column">
          <DemoPhoto region={observation.region} mask />
          <div>
            <h3>Left inner cheek</h3>
            <p>{observation.description}</p>
            <dl className="demo-descriptors">
              <div>
                <dt>Approximate normalized area</dt>
                <dd>3.2% of the image</dd>
              </div>
              <div>
                <dt>Appearance</dt>
                <dd>Rounded · Red · Smooth surface</dd>
              </div>
              <div>
                <dt>Comparison</dt>
                <dd>
                  {matchConfirmed
                    ? "4.0% → 3.2% · 20% smaller sample area"
                    : "Match not confirmed in this tour"}
                </dd>
              </div>
            </dl>
          </div>
        </div>
        <p className="demo-caption">
          Synthetic artwork and prepared values. The comparison uses one image
          with two example outlines. This result is not a diagnosis.
        </p>
      </section>
      <div className="demo-report-actions">
        {download ? (
          <>
            <a
              className="scan-button scan-button-primary"
              href={download}
              download="Stoma3D-sample-report.pdf"
            >
              Download sample PDF
            </a>
            <a
              className="scan-button"
              href={download}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open PDF
            </a>
          </>
        ) : (
          <button
            type="button"
            className="scan-button scan-button-primary"
            onClick={() => void prepare()}
            disabled={busy}
          >
            {busy ? "Preparing PDF…" : "Prepare sample PDF"}
          </button>
        )}
        <button
          type="button"
          className="scan-text-button"
          onClick={() => window.print()}
        >
          Print report
        </button>
        {problem && (
          <p role="alert">
            Couldn’t create the PDF. Try again or print this report.
          </p>
        )}
      </div>
    </>
  );
}
