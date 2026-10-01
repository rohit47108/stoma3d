import { useEffect, useMemo, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MOUTH_REGION_DETAILS, type MouthRegion } from "@stoma3d/contracts";

import { OralObservationMap } from "@/components/OralObservationMap";
import { Screen } from "@/components/Screen";
import { Button, Card, EmptyState, SectionTitle } from "@/components/Ui";
import {
  buildObservationReplayFrames,
  buildRegionObservationSummaries,
} from "@/lib/observationMap";
import { animationDurationMs } from "@/lib/motionPreferences";
import { useStoma3DStore } from "@/store/useStoma3DStore";
import { useAppTheme, useShouldReduceMotion } from "@/theme";

const DETAIL_BY_REGION = new Map(
  MOUTH_REGION_DETAILS.map((detail) => [detail.id, detail]),
);

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const statusLabel = (status: string) =>
  status
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());

export default function MapRoute() {
  const theme = useAppTheme();
  const reduceMotion = useShouldReduceMotion();
  const animationSpeed = useStoma3DStore(
    (state) => state.settings.animationSpeed,
  );
  const captures = useStoma3DStore((state) => state.captures);
  const analyses = useStoma3DStore((state) => state.analyses);
  const pins = useStoma3DStore((state) => state.pins);
  const activeSessionId = useStoma3DStore((state) => state.activeSessionId);
  const [selected, setSelected] = useState<MouthRegion | null>(null);
  const { region } = useLocalSearchParams<{ region?: string }>();
  useEffect(() => {
    const matched = MOUTH_REGION_DETAILS.find((detail) => detail.id === region);
    if (matched) setSelected(matched.id);
  }, [region]);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replaying, setReplaying] = useState(false);

  const frames = useMemo(
    () => buildObservationReplayFrames(captures, analyses, pins),
    [analyses, captures, pins],
  );

  useEffect(() => {
    setReplayIndex(Math.max(0, frames.length - 1));
    setReplaying(false);
  }, [frames.length]);

  useEffect(() => {
    if (!replaying || reduceMotion || frames.length < 2) return undefined;
    const interval = setInterval(
      () => {
        setReplayIndex((current) => {
          if (current >= frames.length - 1) {
            setReplaying(false);
            return current;
          }
          return current + 1;
        });
      },
      animationDurationMs(1_250, animationSpeed),
    );
    return () => clearInterval(interval);
  }, [animationSpeed, frames.length, reduceMotion, replaying]);

  const latestSummaries = useMemo(
    () => buildRegionObservationSummaries(captures, analyses, pins),
    [analyses, captures, pins],
  );
  const frame = frames[replayIndex];
  const summaries = frame?.summaries ?? latestSummaries;
  const completed =
    frame?.completedRegions ??
    MOUTH_REGION_DETAILS.filter(
      (detail) => summaries[detail.id].acceptedCaptureCount > 0,
    ).map((detail) => detail.id);
  const visiblePinIds =
    frame?.visiblePinIds ??
    pins
      .filter((pin) => summaries[pin.region].confirmedPinCount > 0)
      .map((pin) => pin.id);
  const visiblePinSet = new Set(visiblePinIds);
  const visiblePins = pins.filter((pin) => visiblePinSet.has(pin.id));
  const capturesById = new Map(
    captures.map((capture) => [capture.id, capture]),
  );
  const detail = selected ? DETAIL_BY_REGION.get(selected) : undefined;
  const selectedSummary = selected ? summaries[selected] : null;
  const regionPins = selected
    ? visiblePins.filter((pin) => pin.region === selected)
    : [];
  const hasLiveHistory = frames.length > 0;

  const moveReplay = (direction: -1 | 1) => {
    setReplaying(false);
    setReplayIndex((current) =>
      Math.max(0, Math.min(frames.length - 1, current + direction)),
    );
  };

  const startReplay = () => {
    if (reduceMotion) {
      moveReplay(1);
      return;
    }
    if (replayIndex >= frames.length - 1) setReplayIndex(0);
    setReplaying(true);
  };

  return (
    <Screen title="3D Map">
      <Text style={[styles.intro, { color: theme.secondaryText }]}>
        Tap a region to explore your photos and observations.
      </Text>

      {frames.length > 1 ? (
        <View
          style={[
            styles.replayPanel,
            { backgroundColor: theme.surface, borderColor: theme.border },
          ]}
        >
          <View style={styles.replayHeading}>
            <View style={styles.replayHeadingCopy}>
              <Text
                accessibilityRole="header"
                style={[
                  styles.replayTitle,
                  { color: theme.text, fontSize: 16 * theme.fontScale },
                ]}
              >
                Map history
              </Text>
              <Text
                accessibilityLiveRegion="polite"
                style={[styles.replayDate, { color: theme.secondaryText }]}
              >
                Through {frame ? formatDate(frame.cutoffAt) : "latest"} · scan{" "}
                {replayIndex + 1} of {frames.length}
              </Text>
            </View>
            <View style={[styles.replayCount, { backgroundColor: theme.mint }]}>
              <Text style={[styles.replayCountText, { color: theme.primary }]}>
                {completed.length}/8 covered
              </Text>
            </View>
          </View>
          <View style={styles.replayControls}>
            <ReplayButton
              label="Previous scan"
              icon="play-skip-back"
              disabled={replayIndex === 0}
              onPress={() => moveReplay(-1)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                reduceMotion
                  ? "Show next scan in map history"
                  : replaying
                    ? "Pause map history replay"
                    : "Replay map history"
              }
              onPress={() => (replaying ? setReplaying(false) : startReplay())}
              style={({ pressed }) => [
                styles.replayPrimary,
                { backgroundColor: theme.primary },
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name={
                  reduceMotion ? "arrow-forward" : replaying ? "pause" : "play"
                }
                size={19}
                color={theme.white}
              />
              <Text style={[styles.replayPrimaryText, { color: theme.white }]}>
                {reduceMotion ? "Next" : replaying ? "Pause" : "Replay"}
              </Text>
            </Pressable>
            <ReplayButton
              label="Next scan"
              icon="play-skip-forward"
              disabled={replayIndex === frames.length - 1}
              onPress={() => moveReplay(1)}
            />
          </View>
          <View accessible={false} style={styles.replayTrack}>
            {frames.map((item, index) => (
              <View
                key={item.id}
                style={[
                  styles.replayTick,
                  {
                    backgroundColor:
                      index <= replayIndex ? theme.primary : theme.border,
                  },
                ]}
              />
            ))}
          </View>
          {reduceMotion ? (
            <Text
              style={[styles.reducedMotionNote, { color: theme.secondaryText }]}
            >
              Automatic replay is off because Reduce Motion is enabled. Use the
              scan buttons to step through dates.
            </Text>
          ) : null}
        </View>
      ) : null}

      <OralObservationMap
        completedRegions={completed}
        selectedRegion={selected}
        onSelectRegion={setSelected}
        pins={pins}
        summaries={summaries}
        visiblePinIds={visiblePinIds}
        showRegionList
      />

      {!hasLiveHistory ? (
        <Card>
          <EmptyState
            icon="map-outline"
            title="Explore your mouth map"
            body="Your photos and confirmed observations will appear here as you scan."
            action={
              <Button
                label="Start scan"
                icon="scan-outline"
                variant="secondary"
                onPress={() => router.push("/onboarding")}
              />
            }
          />
        </Card>
      ) : null}

      <Card accent={regionPins.length ? "amber" : "teal"}>
        <SectionTitle
          title={detail?.label ?? "Choose a region"}
          subtitle={
            detail?.captureInstruction ??
            "Tap the map or choose a region below."
          }
          icon="location-outline"
        />
        {detail && selectedSummary ? (
          <View style={styles.regionFacts}>
            <FactRow
              icon={
                selectedSummary.acceptedCaptureCount
                  ? "checkmark-circle-outline"
                  : "ellipse-outline"
              }
              label="Coverage"
              value={
                selectedSummary.acceptedCaptureCount
                  ? `${selectedSummary.acceptedCaptureCount} accepted live capture${selectedSummary.acceptedCaptureCount === 1 ? "" : "s"}`
                  : "No accepted live capture by this date"
              }
            />
            <FactRow
              icon="pulse-outline"
              label="Analysis confidence"
              value={
                selectedSummary.averageAnalysisConfidence === null
                  ? "Unavailable"
                  : `${Math.round(selectedSummary.averageAnalysisConfidence * 100)}% average for completed analysis`
              }
            />
            <FactRow
              icon="calendar-outline"
              label="Latest shown"
              value={
                selectedSummary.latestCaptureAt
                  ? formatDate(selectedSummary.latestCaptureAt)
                  : "No saved date"
              }
            />
          </View>
        ) : null}

        {regionPins.length ? (
          <View style={styles.pinSection}>
            <Text
              accessibilityRole="header"
              style={[styles.pinSectionTitle, { color: theme.text }]}
            >
              Confirmed observation links
            </Text>
            {regionPins.map((pin) => {
              const latestCaptureId = pin.captureIds
                .slice()
                .sort((left, right) =>
                  (capturesById.get(left)?.capturedAt ?? "").localeCompare(
                    capturesById.get(right)?.capturedAt ?? "",
                  ),
                )
                .at(-1);
              return (
                <Pressable
                  key={pin.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${statusLabel(pin.status)} observation. First noted ${formatDate(pin.firstObservedAt)}. ${pin.captureIds.length} linked observations.`}
                  disabled={!latestCaptureId}
                  onPress={() => {
                    if (!latestCaptureId) return;
                    router.push({
                      pathname: "/result/[captureId]",
                      params: { captureId: latestCaptureId },
                    });
                  }}
                  style={({ pressed }) => [
                    styles.pinCard,
                    {
                      backgroundColor: theme.background,
                      borderColor: theme.border,
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  <View
                    style={[styles.pinMarker, { backgroundColor: theme.pin }]}
                  >
                    <Ionicons name="location" size={17} color={theme.navy} />
                  </View>
                  <View style={styles.pinCopy}>
                    <Text style={[styles.pinTitle, { color: theme.text }]}>
                      {statusLabel(pin.status)}
                    </Text>
                    <Text
                      style={[styles.pinMeta, { color: theme.secondaryText }]}
                    >
                      First noted {formatDate(pin.firstObservedAt)} ·{" "}
                      {pin.captureIds.length} linked observation
                      {pin.captureIds.length === 1 ? "" : "s"}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={19}
                    color={theme.primary}
                  />
                </Pressable>
              );
            })}
          </View>
        ) : detail ? (
          <Text style={[styles.noPins, { color: theme.secondaryText }]}>
            No user-confirmed observation link is mapped to this region at the
            selected date.
          </Text>
        ) : null}

        {detail && activeSessionId ? (
          <Button
            label="Capture this region"
            icon="camera-outline"
            variant="secondary"
            onPress={() =>
              router.push({
                pathname: "/capture/[region]",
                params: { region: detail.id },
              })
            }
          />
        ) : null}
        {detail && !activeSessionId ? (
          <Button
            label="Start a structured scan"
            icon="scan-outline"
            variant="secondary"
            onPress={() => router.push("/(tabs)/scan")}
          />
        ) : null}
        {regionPins.length ? (
          <Button
            label="Open full visual timeline"
            icon="analytics-outline"
            variant="ghost"
            onPress={() => router.push("/(tabs)/timeline")}
          />
        ) : null}
      </Card>

      <Text style={[styles.footnote, { color: theme.secondaryText }]}>
        Scan-status colors show capture history, confirmed links, retakes, and
        recorded visual change. Confidence shading shows model certainty about
        completed image analysis. Neither layer shows disease risk, and the map
        does not replace an examination.
      </Text>
    </Screen>
  );
}

function ReplayButton({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.replayButton,
        { borderColor: theme.border },
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={20} color={theme.primary} />
    </Pressable>
  );
}

function FactRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const theme = useAppTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={styles.factRow}
    >
      <Ionicons name={icon} size={19} color={theme.primary} />
      <View style={styles.factCopy}>
        <Text style={[styles.factLabel, { color: theme.secondaryText }]}>
          {label}
        </Text>
        <Text style={[styles.factValue, { color: theme.text }]}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { fontSize: 13, lineHeight: 20 },
  replayPanel: { borderWidth: 1, borderRadius: 16, padding: 15, gap: 12 },
  replayHeading: { flexDirection: "row", alignItems: "center", gap: 12 },
  replayHeadingCopy: { flex: 1, gap: 2 },
  replayTitle: { fontWeight: "800" },
  replayDate: { fontSize: 12, lineHeight: 17 },
  replayCount: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  replayCountText: {
    fontSize: 11,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  replayControls: { flexDirection: "row", justifyContent: "center", gap: 8 },
  replayButton: {
    width: 48,
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  replayPrimary: {
    minWidth: 116,
    height: 48,
    borderRadius: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  replayPrimaryText: { fontSize: 13, fontWeight: "800" },
  replayTrack: { flexDirection: "row", gap: 5 },
  replayTick: { flex: 1, height: 4, borderRadius: 2 },
  reducedMotionNote: { fontSize: 11, lineHeight: 16 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.36 },
  regionFacts: { gap: 10 },
  factRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  factCopy: { flex: 1, gap: 1 },
  factLabel: { fontSize: 11, fontWeight: "700" },
  factValue: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  pinSection: { gap: 8 },
  pinSectionTitle: { fontSize: 14, fontWeight: "800" },
  pinCard: {
    minHeight: 62,
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pinMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  pinCopy: { flex: 1, gap: 2 },
  pinTitle: { fontSize: 13, fontWeight: "800" },
  pinMeta: { fontSize: 11, lineHeight: 16 },
  noPins: { fontSize: 12, lineHeight: 18 },
  footnote: { fontSize: 11, lineHeight: 17 },
});
