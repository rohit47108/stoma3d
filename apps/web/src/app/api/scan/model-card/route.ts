import { getGuestModelCard } from "@/lib/scan-relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 35;
export async function GET() {
  return getGuestModelCard();
}
