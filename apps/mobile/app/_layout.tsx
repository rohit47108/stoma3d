import { useEffect, useState } from "react";
import { FaceDetectionProvider } from "@infinitered/react-native-mlkit-face-detection";
import * as Notifications from "expo-notifications";
import { router, Stack, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { DISCLAIMER } from "@/constants";
import { useCloudStore } from "@/cloud/useCloudStore";
import { routeRequiresConsent } from "@/lib/navigationPolicy";
import {
  configureLocalNotifications,
  reminderCaptureId,
} from "@/lib/notifications";
import {
  purgeStoma3DBackgroundTemporaryFiles,
  purgeStoma3DTemporaryFiles,
} from "@/lib/tempFiles";
import { useStoma3DStore } from "@/store/useStoma3DStore";
import { useAppTheme, useShouldReduceMotion } from "@/theme";

function RootLayoutContent() {
  const theme = useAppTheme();
  const hydrate = useStoma3DStore((state) => state.hydrate);
  const deleteEverything = useStoma3DStore((state) => state.deleteEverything);
  const reducedMotion = useShouldReduceMotion();
  const hydrated = useStoma3DStore((state) => state.hydrated);
  const storageError = useStoma3DStore((state) => state.storageError);
  const consentedAt = useStoma3DStore((state) => state.consentedAt);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const segments = useSegments();
  const bootstrapCloud = useCloudStore((state) => state.bootstrap);
  const cloudSessionStatus = useCloudStore((state) => state.sessionStatus);
  const syncCloud = useCloudStore((state) => state.syncNow);
  const consentBlocked =
    hydrated && !storageError && !consentedAt && routeRequiresConsent(segments);
  useEffect(() => {
    let active = true;
    void purgeStoma3DTemporaryFiles()
      .catch(() => {
        console.warn("[STOMA3D_TEMP_PURGE_FAILED]");
      })
      .finally(() => {
        if (active) void hydrate();
      });
    return () => {
      active = false;
    };
  }, [hydrate]);

  useEffect(() => {
    if (hydrated) void bootstrapCloud();
  }, [bootstrapCloud, hydrated]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        if (cloudSessionStatus === "signed_in") void syncCloud();
        return;
      }
      void purgeStoma3DBackgroundTemporaryFiles().catch(() => {
        console.warn("[STOMA3D_BACKGROUND_TEMP_PURGE_FAILED]");
      });
    });
    return () => subscription.remove();
  }, [cloudSessionStatus, syncCloud]);

  useEffect(() => {
    void configureLocalNotifications().catch(() => {
      console.warn("[STOMA3D_NOTIFICATION_SETUP_FAILED]");
    });
    const openReminder = (notification: Notifications.Notification) => {
      const captureId = reminderCaptureId(notification);
      if (
        !captureId ||
        !useStoma3DStore
          .getState()
          .captures.some((capture) => capture.id === captureId)
      ) {
        return;
      }
      router.push({
        pathname: "/result/[captureId]",
        params: { captureId },
      });
    };
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response?.notification) openReminder(response.notification);
      })
      .catch(() => undefined)
      .finally(() => {
        void Notifications.clearLastNotificationResponseAsync().catch(
          () => undefined,
        );
      });
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        openReminder(response.notification);
      },
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (consentBlocked) router.replace("/onboarding");
  }, [consentBlocked]);

  if (hydrated && storageError) {
    return (
      <SafeAreaView
        style={[styles.recovery, { backgroundColor: theme.background }]}
      >
        <StatusBar style={theme.statusBarStyle} />
        <ScrollView
          contentContainerStyle={styles.recoveryContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text
            style={[styles.recoveryDisclaimer, { color: theme.secondaryText }]}
          >
            {DISCLAIMER}
          </Text>
          <Text style={[styles.recoveryTitle, { color: theme.text }]}>
            Protected workspace unavailable
          </Text>
          <Text style={[styles.recoveryBody, { color: theme.secondaryText }]}>
            {storageError}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry protected workspace"
            disabled={resetBusy}
            onPress={() => {
              setResetError(null);
              void hydrate();
            }}
            style={({ pressed }) => [
              styles.recoveryButton,
              { backgroundColor: theme.primary },
              pressed && styles.recoveryButtonPressed,
            ]}
          >
            <Text style={styles.recoveryButtonText}>
              Retry protected workspace
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete local data and reset"
            accessibilityHint="Permanently removes all local Stoma3D observations and reports"
            disabled={resetBusy}
            onPress={() =>
              Alert.alert(
                "Reset all local Stoma3D data?",
                "This permanently deletes the protected database, images, reports, and encryption keys on this device. This cannot be undone.",
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete and reset",
                    style: "destructive",
                    onPress: () => {
                      setResetBusy(true);
                      setResetError(null);
                      void deleteEverything()
                        .catch((error: unknown) =>
                          setResetError(
                            error instanceof Error
                              ? error.message
                              : "The local reset did not finish.",
                          ),
                        )
                        .finally(() => setResetBusy(false));
                    },
                  },
                ],
              )
            }
            style={({ pressed }) => [
              styles.recoveryButton,
              styles.recoverySecondaryButton,
              { borderColor: theme.danger },
              pressed && styles.recoveryButtonPressed,
            ]}
          >
            <Text
              style={[styles.recoverySecondaryText, { color: theme.danger }]}
            >
              {resetBusy
                ? "Resetting local data..."
                : "Delete local data and reset"}
            </Text>
          </Pressable>
          {resetError ? (
            <Text
              accessibilityRole="alert"
              style={[styles.recoveryError, { color: theme.danger }]}
            >
              {resetError}
            </Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!hydrated || consentBlocked) {
    return (
      <View style={[styles.guard, { backgroundColor: theme.background }]}>
        <StatusBar style={theme.statusBarStyle} />
        <ActivityIndicator color={theme.primary} size="small" />
        <Text style={[styles.guardText, { color: theme.secondaryText }]}>
          {hydrated ? "Opening your scan…" : "Opening Stoma3D…"}
        </Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar style={theme.statusBarStyle} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: reducedMotion ? "none" : "slide_from_right",
          contentStyle: { backgroundColor: theme.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="capture/[region]" />
        <Stack.Screen name="result/[captureId]" />
        <Stack.Screen name="compare" />
        <Stack.Screen name="report" />
        <Stack.Screen name="learn/atlas" />
        <Stack.Screen name="learn/normal-variations" />
        <Stack.Screen name="learn/scan-practice" />
        <Stack.Screen name="learn/questions" />
        <Stack.Screen name="roadmap" />
        <Stack.Screen name="model-card" />
        <Stack.Screen name="account" />
        <Stack.Screen name="cloud-sync" />
        <Stack.Screen name="shares" />
        <Stack.Screen name="access-history" />
        <Stack.Screen name="jobs" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <FaceDetectionProvider
      options={{
        performanceMode: "accurate",
        landmarkMode: false,
        contourMode: false,
        classificationMode: false,
        minFaceSize: 0.1,
        isTrackingEnabled: false,
      }}
    >
      <RootLayoutContent />
    </FaceDetectionProvider>
  );
}

const styles = StyleSheet.create({
  guard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#102A43",
  },
  guardText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  guardDisclaimer: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  recovery: {
    flex: 1,
  },
  recoveryContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 28,
  },
  recoveryTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "800",
    textAlign: "center",
  },
  recoveryDisclaimer: {
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  recoveryBody: {
    maxWidth: 520,
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
  },
  recoveryButton: {
    minHeight: 48,
    minWidth: 240,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  recoverySecondaryButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
  },
  recoveryButtonPressed: { opacity: 0.82 },
  recoveryButtonText: { color: "#FFFFFF", fontWeight: "800" },
  recoverySecondaryText: { fontWeight: "800", textAlign: "center" },
  recoveryError: {
    maxWidth: 520,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    textAlign: "center",
  },
});
