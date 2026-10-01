import { useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { type Href, router } from "expo-router";

import { Screen } from "@/components/Screen";
import {
  Button,
  Card,
  ChoiceChip,
  SectionTitle,
  ToggleRow,
} from "@/components/Ui";
import { bundledGuidanceStatus } from "@/lib/guidanceRules";
import { useStoma3DStore } from "@/store/useStoma3DStore";
import { useAppTheme } from "@/theme";
import { CONTRACT_VERSION } from "@stoma3d/contracts";
import { useCloudStore } from "@/cloud/useCloudStore";

export default function SettingsRoute() {
  const theme = useAppTheme();
  const settings = useStoma3DStore((state) => state.settings);
  const updateSettings = useStoma3DStore((state) => state.updateSettings);
  const deleteEverything = useStoma3DStore((state) => state.deleteEverything);
  const [deleting, setDeleting] = useState(false);
  const cloud = useCloudStore();
  const guidance = bundledGuidanceStatus();

  const confirmDeletion = () =>
    Alert.alert(
      "Delete all Stoma3D data?",
      "This removes the encrypted database, captures, reports, comparisons, and consent record, then rotates installation keys. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete all",
          style: "destructive",
          onPress: () => {
            setDeleting(true);
            void deleteEverything()
              .then(() => router.replace("/(tabs)/home"))
              .catch(() => {
                setDeleting(false);
                Alert.alert(
                  "Deletion incomplete",
                  "Stoma3D could not verify that every local file and key was removed. Your data has not been reported as deleted. Try again before sharing or uninstalling the app.",
                );
              });
          },
        },
      ],
    );

  return (
    <Screen
      title="Settings"
      action={
        <Button
          label="Done"
          variant="ghost"
          onPress={() => router.replace("/(tabs)/home")}
        />
      }
    >
      <Card accent={cloud.sessionStatus === "signed_in" ? "teal" : undefined}>
        <SectionTitle
          title={
            cloud.sessionStatus === "signed_in"
              ? "Account connected"
              : "Optional account"
          }
          subtitle={
            cloud.sessionStatus === "signed_in"
              ? !cloud.productConsent
                ? "Review cloud consent to enable sync and sharing."
                : cloud.lastSyncAt
                  ? `Last sync ${new Date(cloud.lastSyncAt).toLocaleString()}`
                  : "Ready to sync"
              : "Sync across devices, create secure QR links, and view access history."
          }
          icon={
            cloud.sessionStatus === "signed_in"
              ? "cloud-done-outline"
              : "person-circle-outline"
          }
        />
        <Button
          label={
            cloud.sessionStatus === "signed_in"
              ? "Manage account"
              : "Open account options"
          }
          variant="secondary"
          icon="arrow-forward-outline"
          onPress={() => router.push("/account" as Href)}
        />
      </Card>
      <Card>
        <SectionTitle
          title="Accessibility"
          subtitle="Make the app easier to read and use."
          icon="accessibility-outline"
        />
        <ToggleRow
          label="High contrast"
          value={settings.highContrast}
          onValueChange={(value) => updateSettings({ highContrast: value })}
        />
        <ToggleRow
          label="Larger key text"
          description="Adds extra size to shared headings, buttons, choices, and settings."
          value={settings.largeText}
          onValueChange={(value) => updateSettings({ largeText: value })}
        />
        <ToggleRow
          label="Reduce motion"
          description="Stops automatic map replay and comparison time-lapse. Manual controls remain available."
          value={settings.reducedMotion}
          onValueChange={(value) => updateSettings({ reducedMotion: value })}
        />
        <Text style={[styles.controlLabel, { color: theme.text }]}>
          Animation speed
        </Text>
        <View accessibilityRole="radiogroup" style={styles.choiceRow}>
          <ChoiceChip
            label="Slow (0.5x)"
            accessibilityRole="radio"
            selected={settings.animationSpeed === "slow"}
            onPress={() => updateSettings({ animationSpeed: "slow" })}
          />
          <ChoiceChip
            label="Standard (1x)"
            accessibilityRole="radio"
            selected={settings.animationSpeed === "standard"}
            onPress={() => updateSettings({ animationSpeed: "standard" })}
          />
        </View>
        <Text style={[styles.controlHint, { color: theme.secondaryText }]}>
          Applies to map history and comparison playback. If Reduce Motion is
          on, this choice is saved for later.
        </Text>
        <ToggleRow
          label="Haptic capture cues"
          value={settings.haptics}
          onValueChange={(value) => updateSettings({ haptics: value })}
        />
        <ToggleRow
          label="Read capture instructions"
          value={settings.voiceInstructions}
          onValueChange={(value) =>
            updateSettings({ voiceInstructions: value })
          }
        />
        <ToggleRow
          label="Caregiver-assisted mode"
          value={settings.caregiverMode}
          onValueChange={(value) => updateSettings({ caregiverMode: value })}
        />
        <ToggleRow
          label="Limited product analytics"
          description={
            cloud.sessionStatus === "signed_in"
              ? "Off by default. Approved app-use events are linked to your account for consent and deletion, kept for 30 days, and shown to admins only as grouped totals. Never includes images, symptoms, regions, results, record IDs, free text, advertising IDs, or precise event times."
              : "Sign in to choose this optional account setting. It stays off while you use Stoma3D locally."
          }
          value={settings.analyticsOptIn}
          disabled={cloud.sessionStatus !== "signed_in" || cloud.busy}
          onValueChange={(value) =>
            void cloud.setAnalyticsOptIn(value).catch(() => undefined)
          }
        />
      </Card>
      <Card accent="amber">
        <SectionTitle
          title="Review guidance is disabled"
          icon="alert-circle-outline"
        />
        <Text style={[styles.body, { color: theme.text }]}>
          {guidance.statusMessage}
        </Text>
        <Text style={[styles.body, { color: theme.secondaryText }]}>
          {guidance.message}
        </Text>
      </Card>
      <Card>
        <SectionTitle title="Transparency" icon="layers-outline" />
        <Button
          label="Open deployed model card"
          variant="secondary"
          icon="document-outline"
          onPress={() => router.push("/model-card")}
        />
        <Button
          label="View future roadmap"
          variant="ghost"
          icon="map-outline"
          onPress={() => router.push("/roadmap")}
        />
      </Card>
      <Card accent="coral">
        <SectionTitle
          title="Delete local data"
          subtitle="Deletes protected files and database, clears reports, and rotates both encryption keys."
          icon="trash-outline"
        />
        <Button
          label="Delete local data only"
          variant="danger"
          icon="trash"
          loading={deleting}
          onPress={confirmDeletion}
        />
      </Card>
      <Text style={[styles.version, { color: theme.secondaryText }]}>
        Stoma3D research app · contract {CONTRACT_VERSION} · accounts and
        analytics are optional
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 13, lineHeight: 20 },
  controlLabel: { fontSize: 14, lineHeight: 20, fontWeight: "800" },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  controlHint: { fontSize: 12, lineHeight: 18 },
  version: { fontSize: 11, textAlign: "center" },
});
