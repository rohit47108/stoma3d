import {
  MOUTH_REGIONS,
  type CaptureAngle,
  type MouthRegion,
} from "@stoma3d/contracts";
import { detailedScanProgress } from "./scanLogic";
import type { CaptureRecord, IntakeProfile, ScanSession } from "../types";

export function nextScanCapture(
  session: ScanSession,
  captures: readonly CaptureRecord[],
): { region: MouthRegion; angle: CaptureAngle } | null {
  const progress = detailedScanProgress(captures, session.id, session.protocol);
  for (const region of MOUTH_REGIONS) {
    const angle = progress.missingByRegion[region][0];
    if (angle) return { region, angle };
  }
  return null;
}

export function resumableSession(
  sessions: readonly ScanSession[],
  captures: readonly CaptureRecord[],
  activeSessionId: string | null,
): ScanSession | null {
  const unfinished = sessions.filter(
    (session) => !session.demo && nextScanCapture(session, captures),
  );
  return (
    unfinished.find((session) => session.id === activeSessionId) ??
    unfinished.at(-1) ??
    null
  );
}

export function intakeProfileForScan(input: {
  symptoms: string[];
  firstNoticed: string;
  durationDays: string;
  change: IntakeProfile["change"];
  extra?: Partial<IntakeProfile>;
}): IntakeProfile {
  const hasSymptoms = input.symptoms.length > 0;
  const days =
    hasSymptoms && input.durationDays.trim()
      ? Number(input.durationDays)
      : undefined;
  if (
    days !== undefined &&
    (!Number.isInteger(days) || days < 0 || days > 36_500)
  ) {
    throw new Error(
      "Enter a number of days from 0 to 36,500, or choose Not sure.",
    );
  }
  return {
    ageRange: "prefer_not_to_say",
    assisted: false,
    tobaccoExposure: "prefer_not_to_say",
    alcoholExposure: "prefer_not_to_say",
    previousConditions: "",
    professionallyExamined: false,
    ...input.extra,
    symptoms: input.symptoms,
    firstNoticed: hasSymptoms ? input.firstNoticed.trim() : "",
    change: hasSymptoms ? input.change : "not_sure",
    ...(days === undefined ? {} : { durationDays: days }),
  };
}
