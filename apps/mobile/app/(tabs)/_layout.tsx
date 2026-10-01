import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, useWindowDimensions } from "react-native";

import { useAppTheme } from "@/theme";

const icons = {
  home: ["home-outline", "home"] as const,
  scan: ["scan-outline", "scan"] as const,
  map: ["cube-outline", "cube"] as const,
  timeline: ["time-outline", "time"] as const,
  learn: ["book-outline", "book"] as const,
  settings: ["options-outline", "options"] as const,
};

export default function TabsLayout() {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const usesNavigationRail = width >= 768;

  return (
    <Tabs
      initialRouteName="home"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarHideOnKeyboard: true,
        tabBarPosition: usesNavigationRail ? "left" : "bottom",
        tabBarVariant: usesNavigationRail ? "material" : "uikit",
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.secondaryText,
        tabBarStyle: usesNavigationRail
          ? {
              backgroundColor: theme.surface,
              borderRightColor: theme.border,
              borderRightWidth: StyleSheet.hairlineWidth,
              borderTopWidth: 0,
              paddingTop: 18,
              width: 96,
            }
          : {
              backgroundColor: theme.surface,
              borderTopColor: theme.border,
              paddingTop: 6,
            },
        tabBarItemStyle: usesNavigationRail
          ? { minHeight: 72, marginVertical: 4 }
          : undefined,
        tabBarLabelStyle: { fontWeight: "700", fontSize: 11 },
        tabBarIcon: ({ focused, color, size }) => {
          const pair = icons[route.name as keyof typeof icons] ?? icons.scan;
          return (
            <Ionicons
              name={focused ? pair[1] : pair[0]}
              color={color}
              size={size}
            />
          );
        },
      })}
    >
      <Tabs.Screen name="home" options={{ title: "Home" }} />
      <Tabs.Screen name="scan" options={{ title: "Scan" }} />
      <Tabs.Screen name="map" options={{ title: "3D Map" }} />
      <Tabs.Screen name="timeline" options={{ title: "History" }} />
      <Tabs.Screen name="learn" options={{ title: "Learn", href: null }} />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", href: null }}
      />
    </Tabs>
  );
}
