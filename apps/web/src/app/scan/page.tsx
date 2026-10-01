import type { Metadata } from "next";
import { ScanWorkspace } from "@/components/scan-workspace";
import "./scan.css";

export const metadata: Metadata = {
  title: "Scan",
  robots: { index: false, follow: false },
};

export default function ScanPage() {
  return <ScanWorkspace />;
}
