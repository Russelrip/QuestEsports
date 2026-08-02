import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { colors } from "@/theme";

const icons: Record<string, keyof typeof Ionicons.glyphMap> = {
  index: "grid-outline",
  registrations: "people-outline",
  payments: "card-outline",
  orders: "bag-handle-outline",
  more: "menu-outline",
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 68, paddingTop: 7, paddingBottom: 8 },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
        tabBarIcon: ({ color, size }) => <Ionicons name={icons[route.name] || "ellipse-outline"} color={color} size={size} />,
      })}
    >
      <Tabs.Screen name="index" options={{ title: "Dashboard" }} />
      <Tabs.Screen name="registrations" options={{ title: "Registrations" }} />
      <Tabs.Screen name="payments" options={{ title: "Payments" }} />
      <Tabs.Screen name="orders" options={{ title: "Orders" }} />
      <Tabs.Screen name="more" options={{ title: "More" }} />
    </Tabs>
  );
}
