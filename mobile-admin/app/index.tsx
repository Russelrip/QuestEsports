import { Redirect } from "expo-router";
import { useAuth } from "@/auth";

export default function Index() {
  const { user } = useAuth();
  if (user) return <Redirect href="/(tabs)" />;
  return <Redirect href="/login" />;
}
