import type { Metadata } from "next";
import { ScanExperience } from "@/components/scan-experience";
import "./scan/scan.css";

export const metadata: Metadata = {
  title: "Scan",
  description: "Start a mouth scan or explore the guided Stoma3D sample demo.",
  alternates: { canonical: "https://stoma3d.vercel.app/" },
};

export default function HomePage() {
  return <ScanExperience />;
}
