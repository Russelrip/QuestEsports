import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { apiRequest } from "@/api";
import { Button, ErrorNotice, StatusBadge } from "@/components/ui";
import { colors, formatDate, humanize, radius, spacing } from "@/theme";
import type { ApiEnvelope } from "@/types";
import { SafeAreaView } from "react-native-safe-area-context";

export type RecordAction = {
  label: string;
  tone?: "primary" | "secondary" | "danger" | "ghost";
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  confirm?: string;
  inputLabel?: string;
  buildBody?: (input: string) => unknown;
};

type Props<T extends { id: string }> = {
  visible: boolean;
  item: T | null;
  title: (item: T) => string;
  detailPath?: (item: T) => string;
  detailKey?: string;
  actions?: (item: T, detail: Record<string, unknown>) => RecordAction[];
  onClose: () => void;
  onChanged: () => void;
};

const isDateKey = (key: string) => /(?:At|Date|Until|expires)$/i.test(key);

function flattenRecord(value: Record<string, unknown>, prefix = "", depth = 0): Array<[string, string]> {
  if (depth > 2) return [];
  return Object.entries(value).flatMap(([key, entry]) => {
    if (["id", "success"].includes(key) || entry === null || entry === undefined || entry === "") return [];
    const label = prefix ? `${prefix} · ${humanize(key)}` : humanize(key);
    if (Array.isArray(entry)) {
      return [[label, entry.length ? entry.map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item))).join("\n") : "None"]];
    }
    if (typeof entry === "object") return flattenRecord(entry as Record<string, unknown>, label, depth + 1);
    if (typeof entry === "boolean") return [[label, entry ? "Yes" : "No"]];
    return [[label, isDateKey(key) ? formatDate(String(entry)) : String(entry)]];
  });
}

export function DetailModal<T extends { id: string }>({ visible, item, title, detailPath, detailKey, actions, onClose, onChanged }: Props<T>) {
  const [detail, setDetail] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<RecordAction | null>(null);
  const [input, setInput] = useState("");
  const detailRequest = useRef(0);

  useEffect(() => {
    if (!visible || !item) return;
    const currentRequest = ++detailRequest.current;
    setDetail(item as unknown as Record<string, unknown>);
    setError(null);
    if (!detailPath || !detailKey) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void apiRequest<ApiEnvelope>(detailPath(item))
      .then((data) => {
        const loaded = data[detailKey];
        if (currentRequest === detailRequest.current && loaded && typeof loaded === "object") {
          setDetail(loaded as Record<string, unknown>);
        }
      })
      .catch((caught) => {
        if (currentRequest === detailRequest.current) {
          setError(caught instanceof Error ? caught.message : "Unable to load details.");
        }
      })
      .finally(() => {
        if (currentRequest === detailRequest.current) setLoading(false);
      });
    return () => {
      detailRequest.current += 1;
    };
  }, [detailKey, detailPath, item, visible]);

  const rows = useMemo(() => flattenRecord(detail), [detail]);
  const availableActions = item && actions ? actions(item, detail) : [];

  const execute = async (action: RecordAction) => {
    if (action.inputLabel && pendingAction !== action) {
      setInput("");
      setPendingAction(action);
      return;
    }
    setBusy(action.label);
    setError(null);
    try {
      const body = action.buildBody ? action.buildBody(input) : action.body;
      await apiRequest<ApiEnvelope>(action.path, {
        method: action.method,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      setPendingAction(null);
      onChanged();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The action failed.");
    } finally {
      setBusy(null);
    }
  };

  const requestAction = (action: RecordAction) => {
    if (!action.confirm) {
      void execute(action);
      return;
    }
    Alert.alert(action.label, action.confirm, [
      { text: "Cancel", style: "cancel" },
      { text: action.label, style: action.tone === "danger" ? "destructive" : "default", onPress: () => void execute(action) },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modal} edges={["top", "bottom", "left", "right"]}>
        <View style={styles.modalHeader}>
          <View style={styles.modalTitleWrap}>
            <Text style={styles.modalEyebrow}>RECORD DETAILS</Text>
            <Text style={styles.modalTitle}>{item ? title(item) : "Details"}</Text>
          </View>
          <Button label="Close" tone="ghost" disabled={busy !== null} onPress={onClose} />
        </View>
        {error ? <ErrorNotice message={error} /> : null}
        {loading ? <ActivityIndicator color={colors.accent} style={styles.loader} /> : null}
        <ScrollView contentContainerStyle={styles.detailContent}>
          {rows.map(([label, value]) => (
            <View key={label} style={styles.row}>
              <Text style={styles.rowLabel}>{label}</Text>
              {/status/i.test(label) ? <StatusBadge value={value} /> : <Text selectable style={styles.rowValue}>{value}</Text>}
            </View>
          ))}
          {pendingAction ? (
            <View style={styles.actionInput}>
              <Text style={styles.rowLabel}>{pendingAction.inputLabel}</Text>
              <Text
                style={styles.inputPlaceholder}
                onPress={() => undefined}
              >
                Enter the requested note in the action dialog below.
              </Text>
              <ActionTextInput value={input} onChangeText={setInput} />
              <View style={styles.actionRow}>
                <Button label="Cancel" tone="secondary" disabled={busy !== null} onPress={() => setPendingAction(null)} />
                <Button label={pendingAction.label} tone={pendingAction.tone} loading={busy === pendingAction.label} disabled={busy !== null} onPress={() => void execute(pendingAction)} />
              </View>
            </View>
          ) : null}
        </ScrollView>
        {!pendingAction && availableActions.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actions}>
            {availableActions.map((action) => (
              <Button key={action.label} label={action.label} tone={action.tone} loading={busy === action.label} disabled={busy !== null} onPress={() => requestAction(action)} />
            ))}
          </ScrollView>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

function ActionTextInput({ value, onChangeText }: { value: string; onChangeText: (value: string) => void }) {
  return <TextInput value={value} onChangeText={onChangeText} multiline placeholder="Optional note or reason" placeholderTextColor={colors.muted} style={styles.input} />;
}

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: colors.background },
  modalHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalTitleWrap: { flex: 1 },
  modalEyebrow: { color: colors.accent, fontSize: 10, fontWeight: "800", letterSpacing: 1.5 },
  modalTitle: { color: colors.text, fontSize: 22, fontWeight: "800" },
  loader: { marginTop: spacing.lg },
  detailContent: { padding: spacing.md, gap: spacing.sm, paddingBottom: 120 },
  row: { padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: 5 },
  rowLabel: { color: colors.muted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6 },
  rowValue: { color: colors.text, fontSize: 15, lineHeight: 21 },
  actions: { gap: spacing.sm, padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  actionInput: { gap: spacing.sm, marginTop: spacing.sm, padding: spacing.md, backgroundColor: colors.surfaceRaised, borderRadius: radius.md },
  inputPlaceholder: { color: colors.muted, fontSize: 12 },
  input: { minHeight: 84, color: colors.text, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, textAlignVertical: "top" },
  actionRow: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
});
