import { useMemo, useState } from "react";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MOUTH_REGION_DETAILS, type MouthRegion } from "@stoma3d/contracts";

import { Screen } from "@/components/Screen";
import {
  Button,
  Card,
  ChoiceChip,
  EmptyState,
  SectionTitle,
} from "@/components/Ui";
import { VisualTrajectoryChart } from "@/components/VisualTrajectoryChart";
import { isEligibleLongitudinalCapture } from "@/lib/longitudinalPolicy";
import { humanizeResultReason } from "@/lib/resultCopy";
import { buildTrajectorySeries, captureQualityScore } from "@/lib/trajectory";
import { useStoma3DStore } from "@/store/useStoma3DStore";
import { useAppTheme } from "@/theme";

const REGION_DETAIL_BY_ID = new Map(
  MOUTH_REGION_DETAILS.map((detail) => [detail.id, detail]),
);

export default function TimelineRoute() {
  const theme = useAppTheme();
  const storedCaptures = useStoma3DStore((state) => state.captures);
  const captures = useMemo(
    () => storedCaptures.filter((capture) => !capture.samplePlaceholder),
    [storedCaptures],
  );
  const analyses = useStoma3DStore((state) => state.analyses);
  const comparisons = useStoma3DStore((state) => state.comparisons);
  const pins = useStoma3DStore((state) => state.pins);
  const sessions = useStoma3DStore((state) => state.sessions);
  const [selectedTrajectoryRegion, setSelectedTrajectoryRegion] =
    useState<MouthRegion | null>(null);
  const capturesById = useMemo(
    () => new Map(captures.map((capture) => [capture.id, capture])),
    [captures],
  );
  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions],
  );
  const eligibleLiveSessions = new Map<string, Set<string>>();
  for (const capture of captures) {
    const analysis = analyses[capture.id];
    if (!isEligibleLongitudinalCapture(capture, analysis)) {
      continue;
    }
    const sessions =
      eligibleLiveSessions.get(capture.region) ?? new Set<string>();
    sessions.add(capture.sessionId);
    eligibleLiveSessions.set(capture.region, sessions);
  }
  const comparisonReady = [...eligibleLiveSessions.values()].some(
    (sessions) => sessions.size >= 2,
  );
  const trajectories = useMemo(
    () => buildTrajectorySeries(captures, analyses, comparisons),
    [analyses, captures, comparisons],
  );
  const selectedTrajectory =
    trajectories.find(
      (trajectory) => trajectory.region === selectedTrajectoryRegion,
    ) ?? trajectories[0];

  return (
    <Screen title="History">
      {captures.length === 0 ? (
        <Card>
          <EmptyState
            icon="analytics-outline"
            title="Your scans will appear here"
            body="Save a photo to start your history. You can compare the same area across later scans."
            action={
              <Button
                label="Go to scan"
                variant="secondary"
                onPress={() => router.push("/(tabs)/scan")}
              />
            }
          />
        </Card>
      ) : (
        <>
          <Card accent="amber">
            <SectionTitle
              title="Review before linking"
              subtitle={
                comparisonReady
                  ? "Two accepted live observations of the same region from separate scans are available. Stoma3D can request a gated match suggestion, but you must review and confirm the pair before any change calculation is attempted."
                  : "A comparison requires accepted live captures of the same region from two separate scans. An honest model abstention does not hide an otherwise valid capture."
              }
              icon="person-circle-outline"
            />
            <Button
              label="Compare two observations"
              icon="git-compare-outline"
              disabled={!comparisonReady}
              onPress={() => router.push("/compare")}
            />
            {!comparisonReady ? (
              <Text style={[styles.detail, { color: theme.secondaryText }]}>
                Capture the same region in another live scan, then return here.
              </Text>
            ) : null}
          </Card>
          {selectedTrajectory ? (
            <Card accent="teal">
              <SectionTitle
                title="Visual-change trajectory"
                subtitle="Each dot is one image-normalized estimate. A solid segment appears only when that exact pair passed user confirmation and every comparison gate."
                icon="trending-up-outline"
              />
              <View
                accessibilityRole="radiogroup"
                style={styles.trajectoryChoices}
              >
                {trajectories.map((trajectory) => {
                  const label =
                    REGION_DETAIL_BY_ID.get(trajectory.region)?.shortLabel ??
                    trajectory.region;
                  return (
                    <ChoiceChip
                      key={trajectory.region}
                      label={`${label} (${trajectory.points.length})`}
                      selected={selectedTrajectory.region === trajectory.region}
                      accessibilityRole="radio"
                      onPress={() =>
                        setSelectedTrajectoryRegion(trajectory.region)
                      }
                    />
                  );
                })}
              </View>
              <VisualTrajectoryChart points={selectedTrajectory.points} />
              <Text style={[styles.detail, { color: theme.secondaryText }]}>
                Unconnected dots must not be read as growth or shrinkage.
                Measurements are approximate and are not millimeters.
              </Text>
            </Card>
          ) : null}
          <Card>
            <SectionTitle
              title="Observation history"
              subtitle="Tap a saved observation to reopen its image and honest analysis state."
              icon="time-outline"
            />
            {captures
              .slice()
              .sort((left, right) =>
                right.capturedAt.localeCompare(left.capturedAt),
              )
              .map((capture) => {
                const analysis = analyses[capture.id];
                const session = sessionsById.get(capture.sessionId);
                const symptomSummary = session?.intakeProfile?.symptoms.length
                  ? session.intakeProfile.symptoms.join(", ")
                  : "none reported";
                const qualityScore = Math.round(
                  captureQualityScore(capture.quality) * 100,
                );
                const label =
                  REGION_DETAIL_BY_ID.get(capture.region)?.shortLabel ??
                  capture.region;
                const detail =
                  analysis?.status === "complete" && analysis.descriptors
                    ? `Approx. area ${(analysis.descriptors.normalizedArea * 100).toFixed(1)}% - confidence ${Math.round(analysis.uncertainty.overallConfidence * 100)}%`
                    : analysis?.status === "complete"
                      ? "Analysis completed - no candidate outline was returned; this does not rule out disease"
                      : analysis?.status === "abstained"
                        ? "Analysis abstained - no visual result was produced"
                        : analysis?.status === "unsupported"
                          ? "Image unsupported - open for details or retake"
                          : analysis?.status === "failed"
                            ? "Analysis unavailable - open to retry the saved image"
                            : "No stored analysis response - open for details";
                return (
                  <Pressable
                    key={capture.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${label} observation from ${new Date(capture.capturedAt).toLocaleString()}. ${detail}`}
                    onPress={() =>
                      router.push({
                        pathname: "/result/[captureId]",
                        params: { captureId: capture.id },
                      })
                    }
                    style={({ pressed }) => [
                      styles.event,
                      {
                        borderLeftColor:
                          analysis?.status === "complete"
                            ? theme.primary
                            : theme.amber,
                        backgroundColor: pressed ? theme.mint : "transparent",
                      },
                    ]}
                  >
                    <Text style={[styles.date, { color: theme.secondaryText }]}>
                      {new Date(capture.capturedAt).toLocaleString()}
                    </Text>
                    <Text style={[styles.title, { color: theme.text }]}>
                      {label}
                    </Text>
                    <Text
                      style={[styles.detail, { color: theme.secondaryText }]}
                    >
                      {detail}
                    </Text>
                    <Text
                      style={[styles.detail, { color: theme.secondaryText }]}
                    >
                      Image quality {qualityScore}% · Reported symptoms:{" "}
                      {symptomSummary}
                    </Text>
                    <Text style={[styles.provenance, { color: theme.primary }]}>
                      {capture.inputOrigin === "bundled_demo"
                        ? `Synthetic input - ${analysis?.analysisOrigin ?? "not analyzed"}`
                        : `Live capture - ${analysis?.analysisOrigin ?? "not analyzed"}`}
                    </Text>
                    <Text style={[styles.open, { color: theme.primary }]}>
                      Open saved result →
                    </Text>
                  </Pressable>
                );
              })}
          </Card>
        </>
      )}
      {comparisons.length ? (
        <Card>
          <SectionTitle
            title="User-confirmed comparison results"
            subtitle="Change remains hidden when registration gates do not pass."
            icon="resize-outline"
          />
          {comparisons
            .slice()
            .reverse()
            .map((comparison, index) => {
              const current = capturesById.get(comparison.currentCaptureId);
              const label =
                REGION_DETAIL_BY_ID.get(comparison.region)?.shortLabel ??
                comparison.region;
              return (
                <View
                  key={`${comparison.currentCaptureId}-${index}`}
                  style={styles.comparison}
                >
                  <Text style={[styles.title, { color: theme.text }]}>
                    {label} -{" "}
                    {comparison.comparable
                      ? "Comparable"
                      : "Insufficient comparable data"}
                  </Text>
                  <Text style={[styles.date, { color: theme.secondaryText }]}>
                    {current
                      ? new Date(current.capturedAt).toLocaleString()
                      : "Capture time unavailable"}
                  </Text>
                  <Text style={[styles.detail, { color: theme.secondaryText }]}>
                    {comparison.comparable &&
                    comparison.normalizedChange !== null
                      ? `Approximate normalized change ${(comparison.normalizedChange * 100).toFixed(1)}% - registration confidence ${Math.round(comparison.registrationConfidence * 100)}%`
                      : comparison.suppressionReasons
                          .map(humanizeResultReason)
                          .join(" ") ||
                        "Change was suppressed by comparison policy."}
                  </Text>
                  <Text style={[styles.provenance, { color: theme.primary }]}>
                    {comparison.inputOrigin === "bundled_demo"
                      ? "Synthetic legacy comparison"
                      : "Live comparison"}{" "}
                    - user confirmed -{" "}
                    {comparison.analysisOrigin.replaceAll("_", " ")}
                  </Text>
                </View>
              );
            })}
        </Card>
      ) : null}
      {pins.length ? (
        <Card>
          <SectionTitle
            title="Observation-map links"
            subtitle="Each link stores a named mesh, region-relative UV coordinates, and the generic asset version."
            icon="location-outline"
          />
          {pins.map((pin) => {
            const label =
              REGION_DETAIL_BY_ID.get(pin.region)?.shortLabel ?? pin.region;
            return (
              <Text key={pin.id} style={[styles.detail, { color: theme.text }]}>
                {label}: {pin.status.replaceAll("_", " ")} -{" "}
                {pin.captureIds.length} linked capture
                {pin.captureIds.length === 1 ? "" : "s"} - {pin.meshId} @{" "}
                {pin.uvX.toFixed(2)}, {pin.uvY.toFixed(2)}
              </Text>
            );
          })}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  event: {
    borderLeftWidth: 3,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 9,
    gap: 3,
  },
  date: { fontSize: 11, fontWeight: "700" },
  title: { fontSize: 16, fontWeight: "800" },
  detail: { fontSize: 13, lineHeight: 19 },
  provenance: { fontSize: 11, fontWeight: "800" },
  open: { fontSize: 12, fontWeight: "800", marginTop: 2 },
  comparison: { gap: 3, paddingVertical: 8 },
  trajectoryChoices: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
});
