"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToastStore } from "@/hooks/useToastStore";
import { adminRequest } from "@/lib/admin";

type ExpenseTarget = {
  type: "tournament" | "event";
  id: string;
  title: string;
  status: string;
  date: string | null;
  currency: string;
};

type Expense = {
  id: string;
  targetType: ExpenseTarget["type"];
  targetId: string;
  description: string;
  category: string;
  vendor: string | null;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "cancelled";
  expenseDate: string;
  notes: string | null;
  createdBy: { id: string; name: string } | null;
};

type ExpenseSummary = {
  currency: string;
  total: number;
  paid: number;
  pending: number;
  cancelled: number;
};

const categories = [
  "venue",
  "prize_pool",
  "staff",
  "equipment",
  "marketing",
  "travel",
  "catering",
  "production",
  "fees",
  "other",
] as const;

const formatLabel = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const todayInSriLanka = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
};

const emptyForm = (currency = "LKR") => ({
  description: "",
  category: "other",
  vendor: "",
  amount: "",
  currency,
  status: "pending" as Expense["status"],
  expenseDate: todayInSriLanka(),
  notes: "",
});

const formatMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-LK", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);

export default function AdminExpensesManager() {
  const [targets, setTargets] = useState<ExpenseTarget[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());
  const showToast = useToastStore((state) => state.showToast);

  const selectedTarget = useMemo(
    () => targets.find((target) => `${target.type}:${target.id}` === selectedKey) || null,
    [selectedKey, targets],
  );

  useEffect(() => {
    let active = true;
    adminRequest<{ targets: ExpenseTarget[] }>("/api/admin/expense-targets")
      .then((data) => {
        if (!active) return;
        setTargets(data.targets);
        const params = new URLSearchParams(window.location.search);
        const requested = `${params.get("targetType") || ""}:${params.get("targetId") || ""}`;
        const initial = data.targets.find((target) => `${target.type}:${target.id}` === requested) || data.targets[0];
        if (initial) {
          setSelectedKey(`${initial.type}:${initial.id}`);
          setForm(emptyForm(initial.currency));
        } else {
          setLoading(false);
        }
      })
      .catch((error) => {
        if (!active) return;
        setLoading(false);
        showToast({ tone: "error", title: "Unable to load events", description: error instanceof Error ? error.message : "Request failed." });
      });
    return () => { active = false; };
  }, [showToast]);

  const loadExpenses = useCallback(async () => {
    if (!selectedTarget) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ targetType: selectedTarget.type, targetId: selectedTarget.id });
      const data = await adminRequest<{ expenses: Expense[]; summary: ExpenseSummary[] }>(`/api/admin/expenses?${query}`);
      setExpenses(data.expenses);
      setSummary(data.summary);
    } catch (error) {
      showToast({ tone: "error", title: "Unable to load expenses", description: error instanceof Error ? error.message : "Request failed." });
    } finally {
      setLoading(false);
    }
  }, [selectedTarget, showToast]);

  useEffect(() => { void loadExpenses(); }, [loadExpenses]);

  const resetForm = (currency = selectedTarget?.currency || "LKR") => {
    setEditingId(null);
    setForm(emptyForm(currency));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTarget) return;
    setSaving(true);
    try {
      await adminRequest(editingId ? `/api/admin/expenses/${editingId}` : "/api/admin/expenses", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, targetType: selectedTarget.type, targetId: selectedTarget.id }),
      });
      showToast({ tone: "success", title: editingId ? "Expense updated" : "Expense added" });
      resetForm();
      await loadExpenses();
    } catch (error) {
      showToast({ tone: "error", title: "Unable to save expense", description: error instanceof Error ? error.message : "Request failed." });
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (expense: Expense) => {
    setEditingId(expense.id);
    setForm({
      description: expense.description,
      category: expense.category,
      vendor: expense.vendor || "",
      amount: String(expense.amount),
      currency: expense.currency,
      status: expense.status,
      expenseDate: expense.expenseDate,
      notes: expense.notes || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const quickStatus = async (expense: Expense, status: Expense["status"]) => {
    if (!selectedTarget) return;
    try {
      await adminRequest(`/api/admin/expenses/${expense.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...expense, status, targetType: selectedTarget.type, targetId: selectedTarget.id }),
      });
      await loadExpenses();
    } catch (error) {
      showToast({ tone: "error", title: "Unable to update expense", description: error instanceof Error ? error.message : "Request failed." });
    }
  };

  const remove = async (expense: Expense) => {
    if (!window.confirm(`Delete “${expense.description}”?`)) return;
    try {
      await adminRequest(`/api/admin/expenses/${expense.id}`, { method: "DELETE" });
      if (editingId === expense.id) resetForm();
      showToast({ tone: "success", title: "Expense deleted" });
      await loadExpenses();
    } catch (error) {
      showToast({ tone: "error", title: "Unable to delete expense", description: error instanceof Error ? error.message : "Request failed." });
    }
  };

  return (
    <AdminShell title="Expenses" description="Keep a quick running cost list for every tournament and ticketed event, on desktop or mobile.">
      <Card className="p-5 sm:p-7">
        <label className="grid gap-2 text-sm text-slate-300">
          Tournament or event
          <Select value={selectedKey} onChange={(event) => {
            const next = targets.find((target) => `${target.type}:${target.id}` === event.target.value);
            setSelectedKey(event.target.value);
            resetForm(next?.currency || "LKR");
          }}>
            {targets.filter((target) => target.type === "tournament").length ? <optgroup label="Tournaments">
              {targets.filter((target) => target.type === "tournament").map((target) => <option key={`${target.type}:${target.id}`} value={`${target.type}:${target.id}`}>{target.title}</option>)}
            </optgroup> : null}
            {targets.filter((target) => target.type === "event").length ? <optgroup label="Ticketed events">
              {targets.filter((target) => target.type === "event").map((target) => <option key={`${target.type}:${target.id}`} value={`${target.type}:${target.id}`}>{target.title}</option>)}
            </optgroup> : null}
          </Select>
        </label>
      </Card>

      {!selectedTarget ? <EmptyState description="Create a tournament or ticketed event before adding expenses." /> : <>
        <div className="grid gap-4 sm:grid-cols-3">
          {(summary.length ? summary : [{ currency: selectedTarget.currency, total: 0, paid: 0, pending: 0, cancelled: 0 }]).map((item) => <Card key={item.currency} className="p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Tracked total · {item.currency}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{formatMoney(item.total, item.currency)}</p>
            <p className="mt-2 text-sm text-slate-400">Paid {formatMoney(item.paid, item.currency)} · Pending {formatMoney(item.pending, item.currency)}</p>
          </Card>)}
        </div>

        <Card className="p-5 sm:p-7">
          <form onSubmit={submit} className="grid gap-4">
            <div><h3 className="text-xl text-white">{editingId ? "Edit expense" : "Add a quick expense"}</h3><p className="mt-1 text-sm text-slate-400">For {selectedTarget.title}</p></div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <label className="grid gap-2 text-sm text-slate-300 xl:col-span-2">Description<Input required maxLength={160} placeholder="Venue deposit" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
              <label className="grid gap-2 text-sm text-slate-300">Category<Select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{categories.map((category) => <option key={category} value={category}>{formatLabel(category)}</option>)}</Select></label>
              <label className="grid gap-2 text-sm text-slate-300">Vendor<Input maxLength={120} placeholder="Optional" value={form.vendor} onChange={(event) => setForm({ ...form, vendor: event.target.value })} /></label>
              <label className="grid gap-2 text-sm text-slate-300">Amount<Input required type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
              <label className="grid gap-2 text-sm text-slate-300">Currency<Input required maxLength={3} value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} /></label>
              <label className="grid gap-2 text-sm text-slate-300">Status<Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Expense["status"] })}><option value="pending">Pending</option><option value="paid">Paid</option><option value="cancelled">Cancelled</option></Select></label>
              <label className="grid gap-2 text-sm text-slate-300">Date<Input required type="date" value={form.expenseDate} onChange={(event) => setForm({ ...form, expenseDate: event.target.value })} /></label>
            </div>
            <label className="grid gap-2 text-sm text-slate-300">Notes<Textarea maxLength={1000} className="min-h-24" placeholder="Optional receipt, payment, or planning notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
            <div className="flex flex-wrap gap-3"><Button type="submit" disabled={saving}>{saving ? "Saving…" : editingId ? "Save changes" : "Add expense"}</Button>{editingId ? <Button type="button" variant="ghost" onClick={() => resetForm()}>Cancel</Button> : null}</div>
          </form>
        </Card>

        <Card className="p-5 sm:p-7">
          <div className="mb-5"><h3 className="text-xl text-white">Expense list</h3><p className="mt-1 text-sm text-slate-400">{expenses.length} item{expenses.length === 1 ? "" : "s"} for {selectedTarget.title}</p></div>
          {loading ? <p className="py-8 text-center text-slate-400">Loading expenses…</p> : expenses.length === 0 ? <EmptyState description="No expenses yet. Add the first cost above." /> : <div className="grid gap-3">
            {expenses.map((expense) => <div key={expense.id} className="grid gap-4 rounded-2xl border border-white/8 bg-black/20 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
              <div><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-white">{expense.description}</p><span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-300">{formatLabel(expense.category)}</span><span className={`rounded-full px-2.5 py-1 text-[11px] ${expense.status === "paid" ? "bg-emerald-400/15 text-emerald-200" : expense.status === "cancelled" ? "bg-slate-500/15 text-slate-400" : "bg-amber-400/15 text-amber-200"}`}>{formatLabel(expense.status)}</span></div><p className="mt-2 text-xl text-white">{formatMoney(expense.amount, expense.currency)}</p><p className="mt-1 text-xs text-slate-500">{expense.expenseDate}{expense.vendor ? ` · ${expense.vendor}` : ""}{expense.createdBy ? ` · Added by ${expense.createdBy.name}` : ""}</p>{expense.notes ? <p className="mt-2 text-sm text-slate-400">{expense.notes}</p> : null}</div>
              <div className="flex flex-wrap gap-2 lg:justify-end">{expense.status === "pending" ? <Button type="button" size="sm" variant="secondary" onClick={() => void quickStatus(expense, "paid")}>Mark paid</Button> : null}<Button type="button" size="sm" variant="secondary" onClick={() => startEdit(expense)}>Edit</Button><Button type="button" size="sm" variant="danger" onClick={() => void remove(expense)}>Delete</Button></div>
            </div>)}
          </div>}
        </Card>
      </>}
    </AdminShell>
  );
}
