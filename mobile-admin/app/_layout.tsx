import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/auth";
import { colors } from "@/theme";

function AuthGate() {
  const { loading, user, challengeToken } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const route = segments[0];
    const inLogin = route === "login";
    const inMfa = route === "mfa";
    if (!user && challengeToken && !inMfa) router.replace("/mfa");
    else if (!user && !challengeToken && !inLogin) router.replace("/login");
    else if (user && (inLogin || inMfa || !route)) router.replace("/(tabs)");
  }, [challengeToken, loading, router, segments, user]);

  if (loading) {
    return <View style={styles.loading}><ActivityIndicator size="large" color={colors.accent} /></View>;
  }

  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: colors.surface }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.background } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="mfa" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="resources/[kind]" options={{ headerShown: false }} />
      <Stack.Screen name="sessions" options={{ title: "Device sessions" }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <AuthGate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
});
