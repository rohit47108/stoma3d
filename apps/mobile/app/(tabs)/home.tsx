import { useCallback, useRef, useState } from "react";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { MOUTH_REGION_DETAILS } from "@stoma3d/contracts";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Screen } from "@/components/Screen";
import { Button, SectionTitle } from "@/components/Ui";
import { detailedScanProgress } from "@/lib/scanLogic";
import { nextScanCapture, resumableSession } from "@/lib/usabilityFlow";
import { useStoma3DStore } from "@/store/useStoma3DStore";
import { useAppTheme } from "@/theme";

export default function HomeRoute() {
  const theme = useAppTheme();
  const sessions = useStoma3DStore((state) => state.sessions);
  const captures = useStoma3DStore((state) => state.captures);
  const analyses = useStoma3DStore((state) => state.analyses);
  const activeSessionId = useStoma3DStore((state) => state.activeSessionId);
  const setActiveSession = useStoma3DStore((state) => state.setActiveSession);
  const [menuOpen, setMenuOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      openingRef.current = false;
      setOpening(false);
    }, []),
  );
  const unfinished = resumableSession(sessions, captures, activeSessionId);
  const progress = unfinished
    ? detailedScanProgress(captures, unfinished.id, unfinished.protocol)
    : null;
  const recent = captures
    .filter(
      (capture) =>
        !capture.samplePlaceholder &&
        analyses[capture.id]?.status === "complete",
    )
    .at(-1);
  const recentRegion = MOUTH_REGION_DETAILS.find(
    (region) => region.id === recent?.region,
  );
  const begin = () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    if (!unfinished) {
      router.push("/onboarding");
    } else {
      setActiveSession(unfinished.id);
      const next = nextScanCapture(unfinished, captures);
      if (next) router.push({ pathname: "/capture/[region]", params: next });
      else router.push("/(tabs)/scan");
    }
  };
  return (
    <Screen
      title="Stoma3D"
      action={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={menuOpen ? "Close menu" : "Open menu"}
          accessibilityState={{ expanded: menuOpen }}
          onPress={() => setMenuOpen((value) => !value)}
          style={[styles.menuButton, { borderColor: theme.border }]}
        >
          <Ionicons
            name={menuOpen ? "close" : "menu-outline"}
            size={25}
            color={theme.text}
          />
        </Pressable>
      }
    >
      {menuOpen ? (
        <View
          style={[
            styles.menu,
            { borderColor: theme.border, backgroundColor: theme.surface },
          ]}
        >
          <Button
            label="Settings"
            icon="options-outline"
            variant="ghost"
            onPress={() => router.push("/(tabs)/settings")}
          />
          <Button
            label="Help and learning"
            icon="book-outline"
            variant="ghost"
            onPress={() => router.push("/(tabs)/learn")}
          />
          <Button
            label="Account and sync"
            icon="cloud-outline"
            variant="ghost"
            onPress={() => router.push("/account")}
          />
        </View>
      ) : null}
      <View style={styles.welcome}>
        <Text
          style={[
            styles.headline,
            { color: theme.text, fontSize: 28 * theme.fontScale },
          ]}
        >
          A closer look at your mouth.
        </Text>
        <Text
          style={[
            styles.body,
            { color: theme.secondaryText, fontSize: 16 * theme.fontScale },
          ]}
        >
          Take clear photos, explore your observations, and keep track of
          changes.
        </Text>
      </View>
      <View
        style={[
          styles.scan,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <View style={styles.scanHeading}>
          <Ionicons name="scan-outline" size={28} color={theme.primary} />
          <View style={styles.scanCopy}>
            <Text style={[styles.scanTitle, { color: theme.text }]}>
              {unfinished ? "Your scan is waiting" : "Your first scan"}
            </Text>
            <Text style={[styles.body, { color: theme.secondaryText }]}>
              {progress
                ? `${progress.completeRegions} of 8 regions saved`
                : "Eight regions. One photo at a time."}
            </Text>
          </View>
        </View>
        {progress ? (
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityValue={{
              min: 0,
              max: 8,
              now: progress.completeRegions,
            }}
            accessibilityLabel="Scan progress"
            style={[styles.track, { backgroundColor: theme.line }]}
          >
            <View
              style={[
                styles.fill,
                {
                  backgroundColor: theme.primary,
                  width: `${(progress.completeRegions / 8) * 100}%`,
                },
              ]}
            />
          </View>
        ) : null}
        <Button
          label={unfinished ? "Continue scan" : "Start scan"}
          icon="arrow-forward"
          disabled={opening}
          onPress={begin}
        />
        <Text style={[styles.note, { color: theme.secondaryText }]}>
          Saved on this device. No account needed.
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Explore the 3D mouth map"
        onPress={() => router.push("/(tabs)/map")}
        style={({ pressed }) => [
          styles.linkRow,
          { borderBottomColor: theme.border },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="cube-outline" size={25} color={theme.primary} />
        <View style={styles.scanCopy}>
          <Text style={[styles.linkTitle, { color: theme.text }]}>
            Explore the 3D map
          </Text>
          <Text style={[styles.body, { color: theme.secondaryText }]}>
            See the eight mouth regions.
          </Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={21}
          color={theme.secondaryText}
        />
      </Pressable>
      {recent ? (
        <View style={styles.recent}>
          <SectionTitle title="Recent result" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${recentRegion?.label ?? "recent"} result`}
            onPress={() =>
              router.push({
                pathname: "/result/[captureId]",
                params: { captureId: recent.id },
              })
            }
            style={({ pressed }) => [
              styles.linkRow,
              { borderBottomColor: theme.border },
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.scanCopy}>
              <Text style={[styles.linkTitle, { color: theme.text }]}>
                {recentRegion?.label ?? "Mouth observation"}
              </Text>
              <Text style={[styles.body, { color: theme.secondaryText }]}>
                {new Date(recent.capturedAt).toLocaleDateString()}
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={21}
              color={theme.secondaryText}
            />
          </Pressable>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  menuButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 14,
  },
  menu: { padding: 12, gap: 8, borderWidth: 1, borderRadius: 16 },
  welcome: { gap: 12, paddingTop: 12, paddingBottom: 8 },
  headline: {
    lineHeight: 35,
    fontWeight: "700",
    maxWidth: 320,
    letterSpacing: -0.6,
  },
  body: { fontSize: 14, lineHeight: 22 },
  scan: { padding: 20, gap: 18, borderRadius: 16, borderWidth: 1 },
  scanHeading: { flexDirection: "row", alignItems: "center", gap: 14 },
  scanCopy: { flex: 1, gap: 4 },
  scanTitle: { fontSize: 19, fontWeight: "700" },
  note: { fontSize: 12, textAlign: "center", lineHeight: 18 },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: "100%" },
  linkRow: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  linkTitle: { fontSize: 16, fontWeight: "700" },
  recent: { gap: 8, paddingTop: 12 },
  pressed: { opacity: 0.75 },
});
