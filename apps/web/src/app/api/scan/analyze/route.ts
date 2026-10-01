import { analyzeGuestScan } from "@/lib/scan-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 65;
export async function POST(request: Request) {
  return analyzeGuestScan(request);
}
