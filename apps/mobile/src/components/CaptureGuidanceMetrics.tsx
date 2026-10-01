import { StyleSheet, Text, View } from "react-native";

import {
  captureGuidanceSummary,
  compareCaptureGuidance,
  signedDegrees,
  type CaptureGuidanceSnapshot,
} from "@/components/captureGuidance";
import { useAppTheme } from "@/theme";

interface CaptureGuidanceMetricsProps {
  snapshot: CaptureGuidanceSnapshot;
  exposureScore?: number | null;
  baselineSnapshot?: CaptureGuidanceSnapshot | null;
  baselineExposureScore?: number | null;
  baselineMillimetersPerPixel?: number | null;
  currentMillimetersPerPixel?: number | null;
  tone?: "camera" | "surface";
}

const sourceLabel = (source: CaptureGuidanceSnapshot["source"]) => {
  if (source === "sweep_start") return "Sweep-start readings";
  if (source === "imported_photo") return "Imported photo";
  return "Live device readings";
};

export function CaptureGuidanceMetrics({
  snapshot,
  exposureScore = null,
  baselineSnapshot,
  baselineExposureScore = null,
  baselineMillimetersPerPixel = null,
  currentMillimetersPerPixel = null,
  tone = "surface",
}: CaptureGuidanceMetricsProps) {
  const theme = useAppTheme();
  const onCamera = tone === "camera";
  const foreground = onCamera ? theme.onCamera : theme.text;
  const muted = onCamera ? "rgba(255,255,255,0.78)" : theme.secondaryText;
  const tile = onCamera ? "rgba(7,26,33,0.76)" : theme.background;
  const lighting =
    exposureScore === null
      ? "After capture"
      : `${Math.round(Math.max(0, Math.min(1, exposureScore)) * 100)}%`;
  const allRows = [
    {
      label: "Stability",
      value:
        snapshot.stabilityPercent === null
          ? "Unavailable"
          : `${snapshot.stabilityPercent}%`,
    },
    { label: "Device tilt", value: signedDegrees(snapshot.tiltDegrees) },
    {
      label: "Device rotation",
      value: signedDegrees(snapshot.rotationDegrees),
    },
    { label: "Exposure score", value: lighting },
    {
      label: "Distance proxy",
      value: `${snapshot.targetWidthPercent}% guide width`,
    },
  ];
  const rows = onCamera ? allRows.slice(0, 2) : allRows;
  const replayComparison =
    baselineSnapshot === undefined
      ? null
      : compareCaptureGuidance({
          baselineSnapshot,
          currentSnapshot: snapshot,
          baselineExposureScore,
          currentExposureScore: exposureScore,
          baselineMillimetersPerPixel,
          currentMillimetersPerPixel,
        });
  const replayRows = replayComparison
    ? [
        { label: "Angle match", value: replayComparison.angleSimilarity },
        {
          label: "Rotation match",
          value: replayComparison.rotationSimilarity,
        },
        {
          label: "Lighting match",
          value: replayComparison.lightingSimilarity,
        },
        {
          label: "Calibrated scale",
          value: replayComparison.calibratedScaleSimilarity,
        },
      ]
    : [];

  return (
    <View
      accessible
      accessibilityLabel={
        onCamera
          ? rows.map((row) => `${row.label}: ${row.value}`).join(". ")
          : `${sourceLabel(snapshot.source)}. ${captureGuidanceSummary(snapshot, exposureScore)}`
      }
      style={styles.container}
    >
      <Text style={[styles.source, { color: muted }]}>
        {sourceLabel(snapshot.source)}
      </Text>
      <View style={styles.grid}>
        {rows.map((row) => (
          <View
            key={row.label}
            style={[styles.metric, { backgroundColor: tile }]}
          >
            <Text style={[styles.label, { color: muted }]}>{row.label}</Text>
            <Text style={[styles.value, { color: foreground }]}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>
      {!onCamera ? (
        <Text style={[styles.note, { color: muted }]}>
          Distance proxy means the target outline size on screen. It is not a
          measured camera-to-tissue distance. Physical units appear only after a
          marker calibration passes.
        </Text>
      ) : null}
      {replayComparison ? (
        <View
          style={[
            styles.replay,
            {
              borderColor: onCamera ? "rgba(255,255,255,0.24)" : theme.border,
            },
          ]}
        >
          <View style={styles.replayHeading}>
            <Text style={[styles.replayTitle, { color: foreground }]}>
              Follow-up capture match
            </Text>
            <Text style={[styles.replayOverall, { color: foreground }]}>
              {replayComparison.overallSimilarity === null
                ? "Unavailable"
                : `${Math.round(replayComparison.overallSimilarity * 100)}% available-factor match`}
            </Text>
          </View>
          <View style={styles.grid}>
            {replayRows.map((row) => (
              <View
                key={row.label}
                style={[styles.metric, { backgroundColor: tile }]}
              >
                <Text style={[styles.label, { color: muted }]}>
                  {row.label}
                </Text>
                <Text style={[styles.value, { color: foreground }]}>
                  {row.value === null
                    ? "Unavailable"
                    : `${Math.round(row.value * 100)}%`}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[styles.note, { color: muted }]}>
            These scores compare capture conditions, not tissue identity or
            health. Calibrated scale is a framing-distance proxy and needs a
            valid marker reading in both captures.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", gap: 6 },
  source: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metric: {
    minWidth: 96,
    flexGrow: 1,
    flexBasis: "45%",
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 9,
  },
  label: { fontSize: 11, lineHeight: 16, fontWeight: "600" },
  value: {
    marginTop: 1,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  note: { fontSize: 9, lineHeight: 13 },
  replay: {
    marginTop: 4,
    paddingTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  replayHeading: { gap: 1 },
  replayTitle: { fontSize: 12, lineHeight: 16, fontWeight: "900" },
  replayOverall: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
