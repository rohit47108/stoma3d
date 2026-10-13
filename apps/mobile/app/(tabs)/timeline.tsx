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
import {
  historyInputLabel,
  historyResultDescription,
  humanizeResultReason,
} from "@/lib/resultCopy";
import { buildTrajectorySeries } from "@/lib/trajectory";
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
  const [toolsOpen, setToolsOpen] = useState(false);
  const [selectedTrajectoryRegion, setSelectedTrajectoryRegion] =
    useState<MouthRegion | null>(null);
  const capturesById = useMemo(
    () => new Map(captures.map((capture) => [capture.id, capture])),
    [captures],
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
    <Screen
      title="History"
      action={
        captures.length > 0 ? (
          <Button
            label={toolsOpen ? "Done" : "Tools"}
            variant="ghost"
            accessibilityState={{ expanded: toolsOpen }}
            onPress={() => setToolsOpen(!toolsOpen)}
          />
        ) : undefined
      }
    >
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
          {toolsOpen ? (
            <>
              <Card>
                <SectionTitle
                  title="Compare scans"
                  subtitle={
                    comparisonReady
                      ? "Choose photos from two scans, then confirm they show the same observation."
                      : "Save the same region in another scan to compare photos."
                  }
                  icon="person-circle-outline"
                />
                <Button
                  label="Compare photos"
                  icon="git-compare-outline"
                  disabled={!comparisonReady}
                  onPress={() => router.push("/compare")}
                />
              </Card>
              {selectedTrajectory ? (
                <Card accent="teal">
                  <SectionTitle
                    title="Area over time"
                    subtitle="Dots show approximate area in each photo. A line connects only confirmed, comparable observations."
                    icon="trending-up-outline"
                  />
                  <View
                    accessibilityRole="radiogroup"
                    style={styles.trajectoryChoices}
                  >
                    {trajectories.map((trajectory) => {
                      const label =
                        REGION_DETAIL_BY_ID.get(trajectory.region)
                          ?.shortLabel ?? trajectory.region;
                      return (
                        <ChoiceChip
                          key={trajectory.region}
                          label={`${label} (${trajectory.points.length})`}
                          selected={
                            selectedTrajectory.region === trajectory.region
                          }
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
                    Separate dots do not show growth or shrinkage. Area is
                    relative to the photo, not measured in millimeters.
                  </Text>
                </Card>
              ) : null}
            </>
          ) : (
            <Card>
              <SectionTitle
                title="Saved photos"
                subtitle="Open a photo to see its result."
                icon="time-outline"
              />
              {captures
                .slice()
                .sort((left, right) =>
                  right.capturedAt.localeCompare(left.capturedAt),
                )
                .map((capture) => {
                  const analysis = analyses[capture.id];
                  const label =
                    REGION_DETAIL_BY_ID.get(capture.region)?.shortLabel ??
                    capture.region;
                  const detail = historyResultDescription(analysis);
                  const provenance = historyInputLabel(
                    capture,
                    analysis?.analysisOrigin,
                  );
                  return (
                    <Pressable
                      key={capture.id}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${label} result from ${new Date(capture.capturedAt).toLocaleString()}. ${detail}. ${provenance}`}
                      onPress={() =>
                        router.push({
                          pathname: "/result/[captureId]",
                          params: { captureId: capture.id },
                        })
                      }
                      style={({ pressed }) => [
                        styles.event,
                        {
                          borderBottomColor: theme.border,
                          backgroundColor: pressed ? theme.mint : "transparent",
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.date,
                          {
                            color: theme.secondaryText,
                            fontSize: 12 * theme.fontScale,
                          },
                        ]}
                      >
                        {new Date(capture.capturedAt).toLocaleString()}
                      </Text>
                      <Text
                        style={[
                          styles.title,
                          { color: theme.text, fontSize: 16 * theme.fontScale },
                        ]}
                      >
                        {label}
                      </Text>
                      <Text
                        style={[
                          styles.detail,
                          {
                            color: theme.secondaryText,
                            fontSize: 13 * theme.fontScale,
                            lineHeight: 19 * theme.fontScale,
                          },
                        ]}
                      >
                        {detail}
                      </Text>
                      <Text
                        style={[
                          styles.provenance,
                          {
                            color: theme.secondaryText,
                            fontSize: 12 * theme.fontScale,
                          },
                        ]}
                      >
                        {provenance}
                      </Text>
                      <Text style={[styles.open, { color: theme.primary }]}>
                        Open saved result →
                      </Text>
                    </Pressable>
                  );
                })}
            </Card>
          )}
        </>
      )}
      {toolsOpen && comparisons.length > 0 ? (
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
      {toolsOpen && pins.length > 0 ? (
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 16,
    gap: 5,
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
