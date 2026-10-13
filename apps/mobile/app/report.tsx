import { useRef, useState } from "react";
import { router } from "expo-router";
import { StyleSheet, Text } from "react-native";

import { Screen } from "@/components/Screen";
import { Button, Card, EmptyState, SectionTitle } from "@/components/Ui";
import {
  generateEncryptedObservationReport,
  shareEncryptedReport,
} from "@/lib/report";
import { comparisonsEndingInSession } from "@/lib/longitudinalPolicy";
import { reportContainsSyntheticData } from "@/lib/reportPolicy";
import { scanProgress } from "@/lib/scanLogic";
import { useStoma3DStore } from "@/store/useStoma3DStore";
import { useAppTheme } from "@/theme";

export default function ReportRoute() {
  const theme = useAppTheme();
  const activeSessionId = useStoma3DStore((state) => state.activeSessionId);
  const sessions = useStoma3DStore((state) => state.sessions);
  const captures = useStoma3DStore((state) => state.captures);
  const analyses = useStoma3DStore((state) => state.analyses);
  const comparisons = useStoma3DStore((state) => state.comparisons);
  const pins = useStoma3DStore((state) => state.pins);
  const reports = useStoma3DStore((state) => state.reports);
  const profile = useStoma3DStore((state) => state.profile);
  const consentedAt = useStoma3DStore((state) => state.consentedAt);
  const addReport = useStoma3DStore((state) => state.addReport);
  const [busy, setBusy] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationActive = useRef(false);
  const session = sessions.find((item) => item.id === activeSessionId);
  const sessionCaptures = captures.filter(
    (capture) => capture.sessionId === activeSessionId,
  );
  const sessionCaptureIds = new Set(
    sessionCaptures.map((capture) => capture.id),
  );
  const sessionComparisons = comparisonsEndingInSession(
    comparisons,
    sessionCaptureIds,
  );
  const comparisonCaptureIds = new Set(
    sessionComparisons.flatMap((comparison) => [
      comparison.baselineCaptureId,
      comparison.currentCaptureId,
    ]),
  );
  const comparisonCaptures = captures.filter((capture) =>
    comparisonCaptureIds.has(capture.id),
  );
  const sessionPins = pins.filter((pin) =>
    pin.captureIds.some((captureId) => sessionCaptureIds.has(captureId)),
  );
  const latest = reports
    .filter((report) => report.sessionId === activeSessionId)
    .at(-1);
  const progress = activeSessionId
    ? scanProgress(captures, activeSessionId)
    : null;
  const syntheticReport = session
    ? reportContainsSyntheticData(session, sessionCaptures)
    : false;

  const generate = async () => {
    if (!session || operationActive.current) return;
    operationActive.current = true;
    setBusy(true);
    setError(null);
    try {
      await addReport(
        await generateEncryptedObservationReport({
          session,
          captures: sessionCaptures,
          comparisonCaptures,
          analyses,
          comparisons: sessionComparisons,
          pins: sessionPins,
          profile: session.intakeProfile ?? profile,
          consentedAt: session.consentedAt ?? consentedAt,
        }),
      );
    } catch (reportError) {
      setError(
        reportError instanceof Error
          ? reportError.message
          : "Report generation failed.",
      );
    } finally {
      operationActive.current = false;
      setBusy(false);
    }
  };

  const share = async () => {
    if (!latest || operationActive.current) return;
    operationActive.current = true;
    setShareBusy(true);
    setError(null);
    try {
      await shareEncryptedReport(latest);
    } catch (shareError) {
      setError(
        shareError instanceof Error
          ? shareError.message
          : "Could not export the PDF. Try again.",
      );
    } finally {
      operationActive.current = false;
      setShareBusy(false);
    }
  };

  if (!session || !progress || progress.completed < progress.total)
    return (
      <Screen title="Scan report">
        <Card>
          <EmptyState
            icon="document-outline"
            title={
              session
                ? `Finish your scan (${progress?.completed ?? 0} of 8)`
                : "Start a scan first"
            }
            body="Save an accepted photo for all eight regions to create your PDF."
            action={
              <Button
                label="Go to scan"
                onPress={() => router.replace("/(tabs)/scan")}
              />
            }
          />
        </Card>
      </Screen>
    );
  return (
    <Screen
      title={syntheticReport ? "Synthetic demonstration report" : "Scan report"}
      eyebrow={syntheticReport ? "Not patient data" : "Saved on this device"}
      action={
        <Button label="Back" variant="ghost" onPress={() => router.back()} />
      }
    >
      {syntheticReport ? (
        <Card accent="coral">
          <SectionTitle
            title="Synthetic demonstration - not patient data"
            subtitle="The generated PDF carries the same watermark and must not be used for care or represented as a patient report."
            icon="flask-outline"
          />
        </Card>
      ) : null}
      <Text
        style={[
          styles.body,
          {
            color: theme.secondaryText,
            fontSize: 15 * theme.fontScale,
            lineHeight: 23 * theme.fontScale,
          },
        ]}
      >
        Your photos, scan notes, and observations in one PDF.
      </Text>
      {latest ? (
        <Card>
          <SectionTitle
            title="Report ready"
            subtitle={`Generated ${new Date(latest.createdAt).toLocaleString()}`}
            icon="checkmark-circle-outline"
          />
          <Button
            label="Export PDF"
            icon="share-outline"
            loading={shareBusy}
            loadingLabel="Opening PDF..."
            disabled={busy || shareBusy}
            onPress={() => {
              void share();
            }}
          />
        </Card>
      ) : null}
      <Button
        label={latest ? "Update report" : "Generate PDF"}
        variant={latest ? "ghost" : "primary"}
        icon="document-lock-outline"
        loading={busy}
        loadingLabel="Creating PDF..."
        disabled={busy || shareBusy}
        onPress={() => {
          void generate();
        }}
      />
      <Text
        style={[
          styles.small,
          {
            color: theme.secondaryText,
            fontSize: 12 * theme.fontScale,
            lineHeight: 18 * theme.fontScale,
          },
        ]}
      >
        Your saved report is encrypted. Export opens a copy you can save or
        share.
      </Text>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.error, { color: theme.danger }]}
        >
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 13, lineHeight: 20 },
  small: { fontSize: 11, lineHeight: 17 },
  error: { textAlign: "center", fontSize: 13, fontWeight: "700" },
});
