import { useEffect } from "react";
import { router } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { APP_NAME, APP_TAGLINE } from "@/constants";
import { Screen } from "@/components/Screen";
import { useStoma3DStore } from "@/store/useStoma3DStore";
import { useAppTheme } from "@/theme";

export default function IndexRoute() {
  const theme = useAppTheme();
  const hydrated = useStoma3DStore((state) => state.hydrated);
  useEffect(() => {
    if (!hydrated) return;
    router.replace("/(tabs)/home");
  }, [hydrated]);

  return (
    <Screen scroll={false} contentStyle={styles.screen}>
      <View style={[styles.mark, { backgroundColor: theme.primary }]}>
        <Text style={styles.markText}>S3D</Text>
      </View>
      <Text style={[styles.name, { color: theme.text }]}>{APP_NAME}</Text>
      <Text style={[styles.tagline, { color: theme.secondaryText }]}>
        {APP_TAGLINE}
      </Text>
      <ActivityIndicator color={theme.primary} size="small" />
      <Text style={[styles.loading, { color: theme.secondaryText }]}>
        Opening Stoma3D…
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { alignItems: "center", justifyContent: "center" },
  mark: {
    width: 82,
    height: 82,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
  },
  markText: {
    color: "#FFFFFF",
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -1,
  },
  name: { fontSize: 34, fontWeight: "900", marginTop: 8 },
  tagline: { fontSize: 15, marginBottom: 18 },
  loading: { fontSize: 12 },
});
