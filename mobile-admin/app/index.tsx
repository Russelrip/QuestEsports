import { Redirect } from "expo-router";
import { useAuth } from "@/auth";

export default function Index() {
  const { user, challengeToken } = useAuth();
  if (user) return <Redirect href="/(tabs)" />;
  if (challengeToken) return <Redirect href="/mfa" />;
  return <Redirect href="/login" />;
}
