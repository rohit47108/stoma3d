import { useState } from "react";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  MOUTH_REGION_DETAILS,
  type CaptureAngle,
  type MouthRegion,
} from "@stoma3d/contracts";

import { Screen } from "@/components/Screen";
import { Button, EmptyState, SectionTitle } from "@/components/Ui";
import {
  acceptedAngles,
  detailedScanProgress,
  requiredAnglesForProtocol,
} from "@/lib/scanLogic";
import { nextScanCapture, resumableSession } from "@/lib/usabilityFlow";
import { useStoma3DStore } from "@/store/useStoma3DStore";
import { useAppTheme } from "@/theme";

export default function ScanRoute() {
  const theme = useAppTheme();
  const sessions = useStoma3DStore((state) => state.sessions);
  const captures = useStoma3DStore((state) => state.captures);
  const analyses = useStoma3DStore((state) => state.analyses);
  const activeSessionId = useStoma3DStore((state) => state.activeSessionId);
  const setActiveSession = useStoma3DStore((state) => state.setActiveSession);
  const [otherScansOpen, setOtherScansOpen] = useState(false);
  const session =
    sessions.find((item) => item.id === activeSessionId && !item.demo) ??
    resumableSession(sessions, captures, null);
  const openCapture = (region: MouthRegion, angle: CaptureAngle) => {
    if (!session) return;
    setActiveSession(session.id);
    router.push({ pathname: "/capture/[region]", params: { region, angle } });
  };
  if (!session)
    return (
      <Screen title="Scan">
        <EmptyState
          icon="scan-outline"
          title="One region at a time"
          body="Take or upload a photo of each mouth region. You can pause and return whenever you need."
        />
        <Button
          label="Start scan"
          icon="arrow-forward"
          onPress={() => router.push("/onboarding")}
        />
        <Button
          label="Explore the 3D map"
          variant="ghost"
          icon="cube-outline"
          onPress={() => router.push("/(tabs)/map")}
        />
      </Screen>
    );
  const progress = detailedScanProgress(captures, session.id, session.protocol);
  const next = nextScanCapture(session, captures);
  const nextDetail = MOUTH_REGION_DETAILS.find(
    (detail) => detail.id === next?.region,
  );
  const complete = next === null;
  return (
    <Screen title={complete ? "Scan complete" : "Your scan"}>
      <View style={styles.progressHeading}>
        <Text style={[styles.progressText, { color: theme.text }]}>
          {progress.completeRegions} of 8 regions
        </Text>
        <Text style={[styles.date, { color: theme.secondaryText }]}>
          {new Date(session.createdAt).toLocaleDateString()}
        </Text>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel="Scan progress"
        accessibilityValue={{ min: 0, max: 8, now: progress.completeRegions }}
        style={[styles.track, { backgroundColor: theme.line }]}
      >
        <View
          style={[
            styles.fill,
            {
              width: `${(progress.completeRegions / 8) * 100}%`,
              backgroundColor: theme.primary,
            },
          ]}
        />
      </View>
      {session.protocol !== "standard_eight_region" ? (
        <Text style={[styles.body, { color: theme.secondaryText }]}>
          Saved{" "}
          {session.protocol === "guided_video_sweep"
            ? "video-sweep"
            : "multi-angle"}{" "}
          scan · {progress.completedViews} of {progress.totalViews} views
        </Text>
      ) : null}
      {next && nextDetail ? (
        <View style={styles.next}>
          <Text style={[styles.nextLabel, { color: theme.secondaryText }]}>
            Up next
          </Text>
          <Text style={[styles.nextTitle, { color: theme.text }]}>
            {nextDetail.label}
          </Text>
          <Text style={[styles.body, { color: theme.secondaryText }]}>
            {nextDetail.captureInstruction}
          </Text>
          <Button
            label="Continue scan"
            icon="camera-outline"
            onPress={() => openCapture(next.region, next.angle)}
          />
        </View>
      ) : (
        <>
          <Text style={[styles.body, { color: theme.secondaryText }]}>
            All eight regions are saved. Review your observations or make a
            report.
          </Text>
          <Button
            label="Create report"
            icon="document-text-outline"
            onPress={() => {
              setActiveSession(session.id);
              router.push("/report");
            }}
          />
        </>
      )}
      <Button
        label="View on 3D map"
        icon="cube-outline"
        variant="ghost"
        onPress={() => router.push("/(tabs)/map")}
      />
      <SectionTitle title="Mouth regions" />
      <View>
        {MOUTH_REGION_DETAILS.map((region, index) => {
          const angles = acceptedAngles(captures, session.id, region.id);
          const required = requiredAnglesForProtocol(session.protocol);
          const done = required.every((angle) => angles.includes(angle));
          const latest = captures
            .filter(
              (item) =>
                item.sessionId === session.id &&
                item.region === region.id &&
                item.quality.accepted,
            )
            .at(-1);
          const resultReady =
            latest && analyses[latest.id]?.status === "complete";
          const angle =
            required.find((item) => !angles.includes(item)) ??
            required[0] ??
            "primary";
          return (
            <Pressable
              key={region.id}
              accessibilityRole="button"
              accessibilityLabel={`${region.label}, ${done ? "saved" : "not captured"}${resultReady ? ", open result" : ""}`}
              onPress={() =>
                resultReady
                  ? router.push({
                      pathname: "/result/[captureId]",
                      params: { captureId: latest.id },
                    })
                  : openCapture(region.id, angle)
              }
              style={({ pressed }) => [
                styles.regionRow,
                { borderBottomColor: theme.border },
                pressed && styles.pressed,
              ]}
            >
              <View
                style={[
                  styles.step,
                  { backgroundColor: done ? theme.mint : theme.surface },
                ]}
              >
                {done ? (
                  <Ionicons name="checkmark" color={theme.primary} size={19} />
                ) : (
                  <Text
                    style={[styles.stepText, { color: theme.secondaryText }]}
                  >
                    {index + 1}
                  </Text>
                )}
              </View>
              <View style={styles.regionCopy}>
                <Text style={[styles.regionTitle, { color: theme.text }]}>
                  {region.shortLabel}
                </Text>
                <Text
                  style={[styles.regionStatus, { color: theme.secondaryText }]}
                >
                  {done
                    ? resultReady
                      ? "Result ready"
                      : "Photo saved"
                    : "Not captured"}
                  {session.protocol !== "standard_eight_region"
                    ? ` · ${angles.length}/${required.length} views`
                    : ""}
                </Text>
              </View>
              <Ionicons
                name="chevron-forward"
                color={theme.secondaryText}
                size={19}
              />
            </Pressable>
          );
        })}
      </View>
      <Button
        label="Start a new scan"
        variant="ghost"
        icon="add-outline"
        onPress={() => router.push("/onboarding")}
      />
      {sessions.filter((item) => !item.demo).length > 1 ? (
        <>
          <Button
            label={otherScansOpen ? "Hide saved scans" : "Choose a saved scan"}
            variant="ghost"
            onPress={() => setOtherScansOpen((value) => !value)}
          />
          {otherScansOpen
            ? sessions
                .filter((item) => !item.demo)
                .slice()
                .reverse()
                .map((item) => (
                  <Button
                    key={item.id}
                    label={`${new Date(item.createdAt).toLocaleString()}${item.id === session.id ? " · Current" : ""}`}
                    variant="secondary"
                    onPress={() => setActiveSession(item.id)}
                  />
                ))
            : null}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  progressHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  progressText: { fontSize: 18, fontWeight: "700" },
  date: { fontSize: 13 },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: "100%" },
  body: { fontSize: 15, lineHeight: 23 },
  next: { gap: 12, paddingVertical: 12 },
  nextLabel: { fontSize: 13 },
  nextTitle: { fontSize: 24, fontWeight: "700", letterSpacing: -0.4 },
  regionRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
  step: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: 14, fontWeight: "700" },
  regionCopy: { flex: 1, gap: 4 },
  regionTitle: { fontSize: 15, fontWeight: "700" },
  regionStatus: { fontSize: 12 },
  pressed: { opacity: 0.75 },
});
