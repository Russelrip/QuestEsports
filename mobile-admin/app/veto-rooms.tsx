import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { apiRequest, jsonBody } from "@/api";
import { Button, Card, Field, PageHeader, Screen, StatusBadge } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";
import type { TournamentSummary, VetoCatalog, VetoRoom } from "@/types";

type MatchOption = { id: string; identifier: string; participants: Array<{ displayName: string }> };

const formats = ["bo1", "bo3", "bo5", "custom"] as const;
const humanize = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function VetoRoomsScreen() {
  const router = useRouter();
  const [rooms, setRooms] = useState<VetoRoom[]>([]);
  const [catalog, setCatalog] = useState<VetoCatalog | null>(null);
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [matches, setMatches] = useState<MatchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ format: "bo3" as VetoRoom["format"], templateId: "", mapPoolId: "", rulePresetId: "", tournamentId: "", matchId: "", team1: "Team One", team2: "Team Two", title: "", controlMode: "captain_or_link", teamOrderMethod: "toss", tossMethod: "digital", turnSeconds: "60" });

  const load = useCallback(async () => {
    try {
      const [roomResponse, catalogResponse, tournamentResponse] = await Promise.all([
        apiRequest<{ success: boolean; data: VetoRoom[] }>("/api/v1/admin/veto-rooms"),
        apiRequest<{ success: boolean; data: VetoCatalog }>("/api/v1/admin/veto/catalog"),
        apiRequest<{ success: boolean; tournaments: TournamentSummary[] }>("/api/admin/tournaments?pageSize=100"),
      ]);
      setRooms(roomResponse.data || []);
      setCatalog(catalogResponse.data);
      setTournaments(tournamentResponse.tournaments || []);
      setForm((current) => ({ ...current, mapPoolId: current.mapPoolId || catalogResponse.data.pools[0]?.id || "", rulePresetId: current.rulePresetId || catalogResponse.data.presets.find((entry) => entry.format === current.format)?.id || "" }));
    } catch (error) { Alert.alert("Unable to load veto rooms", error instanceof Error ? error.message : "Request failed."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!form.tournamentId) { setMatches([]); return; }
    apiRequest<{ success: boolean; data: MatchOption[] }>(`/api/v1/admin/tournaments/${form.tournamentId}/matches`).then((response) => setMatches(response.data || [])).catch(() => setMatches([]));
  }, [form.tournamentId]);

  const presets = useMemo(() => catalog?.presets.filter((entry) => entry.format === form.format || entry.format === "custom") || [], [catalog, form.format]);
  const templates = useMemo(() => catalog?.templates.filter((entry) => entry.format === form.format) || [], [catalog, form.format]);

  const chooseFormat = (format: VetoRoom["format"]) => {
    const preset = catalog?.presets.find((entry) => entry.format === format);
    setForm((current) => ({ ...current, format, templateId: "", rulePresetId: preset?.id || "" }));
    setStep(2);
  };

  const chooseTemplate = (id: string) => {
    const template = catalog?.templates.find((entry) => entry.id === id);
    if (!template) return;
    const settings = template.settings;
    setForm((current) => ({ ...current, templateId: id, mapPoolId: template.mapPoolId, rulePresetId: template.rulePresetId, controlMode: String(settings.controlMode || current.controlMode), teamOrderMethod: String(settings.teamOrderMethod || current.teamOrderMethod), tossMethod: String(settings.tossMethod || current.tossMethod), turnSeconds: settings.turnSeconds === null ? "" : String(settings.turnSeconds || current.turnSeconds) }));
  };

  const create = async () => {
    setBusy(true);
    try {
      const response = await apiRequest<{ success: boolean; data: { room: VetoRoom } }>("/api/v1/admin/veto-rooms", { method: "POST", ...jsonBody({ ...form, tournamentId: form.tournamentId || null, matchId: form.matchId || null, turnSeconds: form.turnSeconds ? Number(form.turnSeconds) : null, tossCallerSlot: 2, viewerEnabled: true, publishResult: true, participants: form.matchId ? undefined : [{ displayName: form.team1, seed: 1, accentColor: "#22d3ee" }, { displayName: form.team2, seed: 2, accentColor: "#fb7185" }] }) });
      setCreating(false); setStep(1); await load();
      router.push({ pathname: "/veto-room/[id]", params: { id: response.data.room.id } });
    } catch (error) { Alert.alert("Unable to create room", error instanceof Error ? error.message : "Request failed."); }
    finally { setBusy(false); }
  };

  const saveTemplate = async () => {
    setBusy(true);
    try {
      await apiRequest("/api/v1/admin/veto/templates", { method: "POST", ...jsonBody({
        name: form.title.trim() || `${form.format.toUpperCase()} LAN setup`,
        format: form.format,
        tournamentId: form.tournamentId || null,
        mapPoolId: form.mapPoolId,
        rulePresetId: form.rulePresetId,
        settings: { controlMode: form.controlMode, teamOrderMethod: form.teamOrderMethod, tossMethod: form.tossMethod, tossCallerSlot: 2, turnSeconds: form.turnSeconds ? Number(form.turnSeconds) : null, viewerEnabled: true, publishResult: true },
      }) });
      Alert.alert("Template saved", "This setup is ready to reuse in future match rooms.");
      await load();
    } catch (error) { Alert.alert("Unable to save template", error instanceof Error ? error.message : "Request failed."); }
    finally { setBusy(false); }
  };

  if (loading) return <Screen><View style={styles.center}><ActivityIndicator size="large" color={colors.accent} /></View></Screen>;

  return <Screen>
    <PageHeader title="Veto rooms" subtitle="LAN map veto control" />
    <ScrollView contentContainerStyle={styles.content}>
      <Button label={creating ? "Close creator" : "New veto room"} icon={creating ? "close-outline" : "add-outline"} onPress={() => { setCreating((value) => !value); setStep(1); }} />
      {creating ? <Card>
        <Text style={styles.eyebrow}>STEP {step} OF 5</Text>
        <Text style={styles.heading}>{["Choose format", "Use a template", "Pool and rules", "Teams and settings", "Review"][step - 1]}</Text>
        {step === 1 ? <View style={styles.grid}>{formats.map((format) => <Pressable key={format} onPress={() => chooseFormat(format)} style={[styles.option, form.format === format && styles.optionActive]}><Text style={styles.optionTitle}>{format.toUpperCase()}</Text><Text style={styles.meta}>{format === "custom" ? "Custom" : `Best of ${format.slice(2)}`}</Text></Pressable>)}</View> : null}
        {step === 2 ? <View style={styles.stack}><Pressable onPress={() => setForm({ ...form, templateId: "" })} style={[styles.option, !form.templateId && styles.optionActive]}><Text style={styles.optionTitle}>Format defaults</Text></Pressable>{templates.map((template) => <Pressable key={template.id} onPress={() => chooseTemplate(template.id)} style={[styles.option, form.templateId === template.id && styles.optionActive]}><Text style={styles.optionTitle}>{template.name}</Text></Pressable>)}</View> : null}
        {step === 3 ? <View style={styles.stack}><Text style={styles.label}>Map pool</Text>{catalog?.pools.map((pool) => <Pressable key={pool.id} onPress={() => setForm({ ...form, mapPoolId: pool.id })} style={[styles.option, form.mapPoolId === pool.id && styles.optionActive]}><Text style={styles.optionTitle}>{pool.name}</Text><Text style={styles.meta}>{pool.maps.length} maps · v{pool.version}</Text></Pressable>)}<Text style={styles.label}>Rule preset</Text>{presets.map((preset) => <Pressable key={preset.id} onPress={() => setForm({ ...form, rulePresetId: preset.id })} style={[styles.option, form.rulePresetId === preset.id && styles.optionActive]}><Text style={styles.optionTitle}>{preset.name}</Text><Text style={styles.meta}>{preset.steps.length} steps</Text></Pressable>)}</View> : null}
        {step === 4 ? <View style={styles.stack}><Field value={form.title} onChangeText={(title) => setForm({ ...form, title })} placeholder="Room title (optional)" /><Field value={form.turnSeconds} onChangeText={(turnSeconds) => setForm({ ...form, turnSeconds })} keyboardType="number-pad" placeholder="Turn timer seconds" /><Text style={styles.label}>Tournament (optional)</Text><Pressable onPress={() => setForm({ ...form, tournamentId: "", matchId: "" })} style={[styles.option, !form.tournamentId && styles.optionActive]}><Text style={styles.optionTitle}>Standalone room</Text></Pressable>{tournaments.map((tournament) => <Pressable key={tournament.id} onPress={() => setForm({ ...form, tournamentId: tournament.id, matchId: "" })} style={[styles.option, form.tournamentId === tournament.id && styles.optionActive]}><Text style={styles.optionTitle}>{tournament.title}</Text></Pressable>)}{form.tournamentId && matches.length ? <><Text style={styles.label}>Import existing match</Text><Pressable onPress={() => setForm({ ...form, matchId: "" })} style={[styles.option, !form.matchId && styles.optionActive]}><Text style={styles.optionTitle}>Enter teams manually</Text></Pressable>{matches.map((match) => <Pressable key={match.id} onPress={() => setForm({ ...form, matchId: match.id })} style={[styles.option, form.matchId === match.id && styles.optionActive]}><Text style={styles.optionTitle}>{match.identifier || match.id.slice(0, 8)}</Text><Text style={styles.meta}>{match.participants.map((entry) => entry.displayName).join(" vs ")}</Text></Pressable>)}</> : null}{!form.matchId ? <><Field value={form.team1} onChangeText={(team1) => setForm({ ...form, team1 })} placeholder="Team 1" /><Field value={form.team2} onChangeText={(team2) => setForm({ ...form, team2 })} placeholder="Team 2" /></> : null}</View> : null}
        {step === 5 ? <View style={styles.summary}><Text style={styles.optionTitle}>{form.team1} vs {form.team2}</Text><Text style={styles.meta}>{form.format.toUpperCase()} · {catalog?.pools.find((entry) => entry.id === form.mapPoolId)?.name}</Text><Text style={styles.meta}>{catalog?.presets.find((entry) => entry.id === form.rulePresetId)?.name} · Digital toss · {form.turnSeconds || "No"}s timer</Text></View> : null}
        {step > 1 ? <View style={styles.row}><Button label="Back" tone="secondary" onPress={() => setStep((value) => Math.max(1, value - 1))} /><Button label={step === 5 ? "Create room" : "Continue"} loading={busy} onPress={() => step === 5 ? void create() : setStep((value) => Math.min(5, value + 1))} />{step === 5 ? <Button label="Save template" tone="secondary" loading={busy} onPress={() => void saveTemplate()} /> : null}</View> : null}
      </Card> : null}

      <View style={styles.stack}>{rooms.map((room) => <Card key={room.id} onPress={() => router.push({ pathname: "/veto-room/[id]", params: { id: room.id } })}><View style={styles.cardTop}><View style={styles.grow}><Text style={styles.optionTitle}>{room.title}</Text><Text style={styles.meta}>{room.format.toUpperCase()} · Room {room.code}</Text></View><StatusBadge value={room.status} /></View></Card>)}{rooms.length === 0 ? <Text style={styles.empty}>No veto rooms yet.</Text> : null}</View>
    </ScrollView>
  </Screen>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" }, content: { padding: spacing.md, paddingTop: spacing.sm, paddingBottom: 100, gap: spacing.md },
  eyebrow: { color: colors.accent, fontSize: 10, fontWeight: "900", letterSpacing: 2 }, heading: { color: colors.text, fontSize: 24, fontWeight: "900", marginTop: 5, marginBottom: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, stack: { gap: spacing.sm }, option: { flexGrow: 1, minWidth: 135, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, borderRadius: radius.md, padding: spacing.md }, optionActive: { borderColor: colors.accent, backgroundColor: "#8b5cf620" },
  optionTitle: { color: colors.text, fontSize: 16, fontWeight: "900" }, meta: { color: colors.muted, fontSize: 12, marginTop: 4 }, label: { color: colors.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.sm },
  summary: { borderWidth: 1, borderColor: colors.border, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.background }, row: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }, cardTop: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }, grow: { flex: 1 }, empty: { color: colors.muted, textAlign: "center", padding: spacing.xl },
});
