"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ScanWorkspace } from "./scan-workspace";

const GuidedDemo = dynamic(
  () => import("./guided-demo").then((module) => module.GuidedDemo),
  {
    loading: () => (
      <div className="scan-shell">
        <p className="scan-content" role="status">
          Opening the sample demo…
        </p>
      </div>
    ),
  },
);

// Sample state never enters the encrypted real-scan store or inference client.
export function ScanExperience() {
  const [demo, setDemo] = useState(false);
  return demo ? (
    <GuidedDemo onExit={() => setDemo(false)} />
  ) : (
    <ScanWorkspace onDemo={() => setDemo(true)} />
  );
}
