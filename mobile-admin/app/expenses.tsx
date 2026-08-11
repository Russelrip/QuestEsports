import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { apiRequest, jsonBody } from "@/api";
import { Button, Card, EmptyState, ErrorNotice, Field, FilterPills, PageHeader, Screen, StatusBadge } from "@/components/ui";
import { colors, formatMoney, humanize, radius, spacing } from "@/theme";

type ExpenseTarget = {
  type: "tournament" | "event";
  id: string;
  title: string;
  status: string;
  currency: string;
};

type Expense = {
  id: string;
  description: string;
  category: string;
  vendor: string | null;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "cancelled";
  expenseDate: string;
  notes: string | null;
};

type ExpenseSummary = {
  currency: string;
  total: number;
  paid: number;
  pending: number;
};

const categories = ["venue", "prize_pool", "staff", "equipment", "marketing", "travel", "catering", "production", "fees", "other"];
const categoryOptions = categories.map((value) => ({ label: humanize(value), value }));
const statusOptions = ["pending", "paid", "cancelled"].map((value) => ({ label: humanize(value), value }));
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo" }).format(new Date());
const newForm = (currency = "LKR") => ({ description: "", category: "other", vendor: "", amount: "", currency, status: "pending", expenseDate: today(), notes: "" });

export default function ExpensesScreen() {
  const [targets, setTargets] = useState<ExpenseTarget[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [items, setItems] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary[]>([]);
  const [form, setForm] = useState(newForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selected = useMemo(() => targets.find((target) => `${target.type}:${target.id}` === selectedKey) || null, [selectedKey, targets]);

  const loadTargets = useCallback(async () => {
    try {
      const response = await apiRequest<{ success: boolean; targets: ExpenseTarget[] }>("/api/admin/expense-targets");
      setTargets(response.targets);
      if (!selectedKey && response.targets[0]) {
        const first = response.targets[0];
        setSelectedKey(`${first.type}:${first.id}`);
        setForm(newForm(first.currency));
      }
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load tournaments and events.");
      setLoading(false);
    }
  }, [selectedKey]);

  const loadExpenses = useCallback(async () => {
    if (!selected) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ targetType: selected.type, targetId: selected.id });
      const response = await apiRequest<{ success: boolean; expenses: Expense[]; summary: ExpenseSummary[] }>(`/api/admin/expenses?${params}`);
      setItems(response.expenses);
      setSummary(response.summary);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load expenses.");
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => { void loadTargets(); }, [loadTargets]);
  useEffect(() => { void loadExpenses(); }, [loadExpenses]);

  const reset = (currency = selected?.currency || "LKR") => {
    setEditingId(null);
    setForm(newForm(currency));
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await apiRequest(editingId ? `/api/admin/expenses/${editingId}` : "/api/admin/expenses", {
        method: editingId ? "PATCH" : "POST",
        ...jsonBody({ ...form, targetType: selected.type, targetId: selected.id }),
      });
      reset();
      await loadExpenses();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save expense.");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item: Expense) => {
    setEditingId(item.id);
    setForm({ description: item.description, category: item.category, vendor: item.vendor || "", amount: String(item.amount), currency: item.currency, status: item.status, expenseDate: item.expenseDate, notes: item.notes || "" });
  };

  const updateStatus = async (item: Expense) => {
    if (!selected) return;
    try {
      await apiRequest(`/api/admin/expenses/${item.id}`, {
        method: "PATCH",
        ...jsonBody({ ...item, status: "paid", targetType: selected.type, targetId: selected.id }),
      });
      await loadExpenses();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update expense.");
    }
  };

  const remove = (item: Expense) => Alert.alert("Delete expense", `Delete “${item.description}”?`, [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: () => void (async () => {
      try {
        await apiRequest(`/api/admin/expenses/${item.id}`, { method: "DELETE" });
        if (editingId === item.id) reset();
        await loadExpenses();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to delete expense.");
      }
    })() },
  ]);

  return (
    <Screen scroll>
      <PageHeader title="Expenses" subtitle="Quick tournament and event cost tracking" />
      {error ? <ErrorNotice message={error} retry={() => void (targets.length ? loadExpenses() : loadTargets())} /> : null}

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Tournament or event</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.targetList}>
          {targets.map((target) => {
            const key = `${target.type}:${target.id}`;
            const active = key === selectedKey;
            return <Pressable key={key} onPress={() => { setSelectedKey(key); reset(target.currency); }} style={[styles.target, active && styles.targetActive]}>
              <Text style={[styles.targetType, active && styles.targetActiveText]}>{target.type === "tournament" ? "TOURNAMENT" : "EVENT"}</Text>
              <Text numberOfLines={1} style={[styles.targetTitle, active && styles.targetActiveText]}>{target.title}</Text>
            </Pressable>;
          })}
        </ScrollView>
      </View>

      {!selected && !loading ? <EmptyState title="No events yet" message="Create a tournament or ticketed event before tracking costs." /> : null}
      {selected ? <>
        <View style={styles.summaryRow}>
          {(summary.length ? summary : [{ currency: selected.currency, total: 0, paid: 0, pending: 0 }]).map((value) => <Card key={value.currency}>
            <Text style={styles.summaryLabel}>TRACKED · {value.currency}</Text>
            <Text style={styles.summaryTotal}>{formatMoney(value.total, value.currency)}</Text>
            <Text style={styles.summaryMeta}>Paid {formatMoney(value.paid, value.currency)}</Text>
            <Text style={styles.summaryMeta}>Pending {formatMoney(value.pending, value.currency)}</Text>
          </Card>)}
        </View>

        <Card>
          <Text style={styles.cardTitle}>{editingId ? "Edit expense" : "Add expense"}</Text>
          <Text style={styles.cardSubtitle}>{selected.title}</Text>
          <Field label="Description" value={form.description} onChangeText={(description) => setForm({ ...form, description })} placeholder="Venue deposit" maxLength={160} />
          <Text style={styles.fieldLabel}>CATEGORY</Text>
          <FilterPills values={categoryOptions} selected={form.category} onSelect={(category) => setForm({ ...form, category })} />
          <Field label="Vendor (optional)" value={form.vendor} onChangeText={(vendor) => setForm({ ...form, vendor })} maxLength={120} />
          <View style={styles.twoColumns}>
            <View style={styles.flex}><Field label="Amount" value={form.amount} onChangeText={(amount) => setForm({ ...form, amount })} keyboardType="decimal-pad" placeholder="0.00" /></View>
            <View style={styles.currency}><Field label="Currency" value={form.currency} onChangeText={(currency) => setForm({ ...form, currency: currency.toUpperCase() })} autoCapitalize="characters" maxLength={3} /></View>
          </View>
          <Field label="Date (YYYY-MM-DD)" value={form.expenseDate} onChangeText={(expenseDate) => setForm({ ...form, expenseDate })} keyboardType="numbers-and-punctuation" maxLength={10} />
          <Text style={styles.fieldLabel}>STATUS</Text>
          <FilterPills values={statusOptions} selected={form.status} onSelect={(status) => setForm({ ...form, status })} />
          <Field label="Notes (optional)" value={form.notes} onChangeText={(notes) => setForm({ ...form, notes })} multiline maxLength={1000} />
          <Button label={editingId ? "Save changes" : "Add expense"} icon="add-circle-outline" loading={saving} disabled={!form.description.trim() || !form.amount.trim()} onPress={() => void save()} />
          {editingId ? <Button label="Cancel editing" tone="ghost" onPress={() => reset()} /> : null}
        </Card>

        <View style={styles.listHeader}><Text style={styles.cardTitle}>Expense list</Text><Text style={styles.cardSubtitle}>{items.length} items</Text></View>
        {!loading && !items.length ? <EmptyState title="No expenses" message="Add the first event cost above." /> : null}
        {items.map((item) => <Card key={item.id}>
          <View style={styles.itemTop}><View style={styles.flex}><Text style={styles.itemTitle}>{item.description}</Text><Text style={styles.cardSubtitle}>{humanize(item.category)} · {item.expenseDate}{item.vendor ? ` · ${item.vendor}` : ""}</Text></View><StatusBadge value={item.status} /></View>
          <Text style={styles.itemAmount}>{formatMoney(item.amount, item.currency)}</Text>
          {item.notes ? <Text style={styles.notes}>{item.notes}</Text> : null}
          <View style={styles.actions}>{item.status === "pending" ? <View style={styles.flex}><Button label="Mark paid" tone="secondary" onPress={() => void updateStatus(item)} /></View> : null}<View style={styles.flex}><Button label="Edit" tone="secondary" onPress={() => startEdit(item)} /></View><View style={styles.flex}><Button label="Delete" tone="danger" onPress={() => remove(item)} /></View></View>
        </Card>)}
      </> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.xs },
  sectionLabel: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  targetList: { gap: spacing.sm, paddingVertical: spacing.xs },
  target: { width: 190, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md },
  targetActive: { borderColor: colors.accent, backgroundColor: colors.accentStrong },
  targetType: { color: colors.accent, fontSize: 10, fontWeight: "900", letterSpacing: 1 },
  targetTitle: { color: colors.text, fontWeight: "800", marginTop: 3 },
  targetActiveText: { color: colors.white },
  summaryRow: { gap: spacing.sm },
  summaryLabel: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  summaryTotal: { color: colors.text, fontWeight: "900", fontSize: 24 },
  summaryMeta: { color: colors.muted, fontSize: 12 },
  cardTitle: { color: colors.text, fontSize: 18, fontWeight: "900" },
  cardSubtitle: { color: colors.muted, fontSize: 12 },
  fieldLabel: { color: colors.muted, fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  twoColumns: { flexDirection: "row", gap: spacing.sm },
  flex: { flex: 1 },
  currency: { width: 105 },
  listHeader: { marginTop: spacing.sm },
  itemTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  itemTitle: { color: colors.text, fontWeight: "800", fontSize: 16 },
  itemAmount: { color: colors.text, fontWeight: "900", fontSize: 21 },
  notes: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: "row", gap: spacing.sm },
});
