import type { PropsWithChildren, ReactNode } from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "@/theme";

interface ScreenProps extends PropsWithChildren {
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}

export function Screen({
  title,
  eyebrow,
  action,
  scroll = true,
  contentStyle,
  children,
}: ScreenProps) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const isTabletWidth = width >= 768;
  const horizontalPadding = width >= 1200 ? 40 : isTabletWidth ? 32 : 20;
  const maxContentWidth = width >= 1200 ? 960 : isTabletWidth ? 840 : undefined;
  const content = (
    <View
      style={[
        styles.content,
        {
          paddingHorizontal: horizontalPadding,
          maxWidth: maxContentWidth,
        },
        contentStyle,
      ]}
    >
      {(title || action) && (
        <View style={styles.headingRow}>
          <View style={styles.headingCopy}>
            {eyebrow ? (
              <Text style={[styles.eyebrow, { color: theme.primary }]}>
                {eyebrow}
              </Text>
            ) : null}
            {title ? (
              <Text
                accessibilityRole="header"
                style={[
                  styles.title,
                  {
                    color: theme.text,
                    fontSize: (isTabletWidth ? 34 : 30) * theme.fontScale,
                  },
                ]}
              >
                {title}
              </Text>
            ) : null}
          </View>
          {action ? <View style={styles.headingAction}>{action}</View> : null}
        </View>
      )}
      {children}
    </View>
  );

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: theme.background }]}
      edges={["top", "bottom", "left", "right"]}
    >
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          automaticallyAdjustKeyboardInsets
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flexGrow: 1, width: "100%" },
  content: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
    paddingVertical: 20,
    gap: 16,
  },
  headingRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headingCopy: { flex: 1, minWidth: 210, gap: 3 },
  headingAction: { flexShrink: 0 },
  eyebrow: { fontSize: 12, fontWeight: "700", letterSpacing: 0.35 },
  title: { fontWeight: "800", letterSpacing: -0.8 },
});
