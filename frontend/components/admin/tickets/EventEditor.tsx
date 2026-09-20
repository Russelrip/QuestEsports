"use client";

import { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type EventForm } from "./ticket-model";

export function EventEditor({
  form,
  setForm,
  error,
  saving,
  isEditing,
  eventSeries,
  onSubmit,
  onCancel,
}: {
  form: EventForm;
  setForm: React.Dispatch<React.SetStateAction<EventForm>>;
  error: string;
  saving: boolean;
  isEditing: boolean;
  eventSeries: Array<{ id: string; title: string }>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const field = <K extends keyof EventForm>(key: K) => ({
    value: form[key],
    onChange: (
      input: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => setForm((current) => ({ ...current, [key]: input.target.value })),
  });
  const togglePaymentMethod = (method: EventForm["paymentMethods"][number]) =>
    setForm((current) => ({
      ...current,
      paymentMethods: current.paymentMethods.includes(method)
        ? current.paymentMethods.filter((candidate) => candidate !== method)
        : [...current.paymentMethods, method],
    }));
  return (
    <Card className="p-6 sm:p-8">
      <h3 className="text-3xl text-white">
        {isEditing ? "Edit entrance fee" : "Add entrance fee"}
      </h3>
      <p className="mt-2 text-sm text-slate-400">
        Attach an entrance fee to a LAN event. It will appear only on that
        event&apos;s public page. Bundle pricing is automatic.
      </p>
      <form className="mt-7 grid gap-5" onSubmit={onSubmit}>
        <FormField
          label="LAN event"
          hint="Only the selected event page will display this entrance fee."
          required
        >
          <Select required {...field("seriesId")}>
            <option value="">Choose an event series</option>
            {eventSeries.map((series) => (
              <option key={series.id} value={series.id}>
                {series.title}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Event title" required>
            <Input required {...field("title")} />
          </FormField>
          <FormField label="URL slug" required>
            <Input required {...field("slug")} />
          </FormField>
        </div>
        <FormField label="Description" required>
          <Textarea required {...field("description")} />
        </FormField>
        <FormField label="Venue" required>
          <Input required {...field("venue")} />
        </FormField>
        <div className="grid gap-5 sm:grid-cols-3">
          <FormField label="Event date and time" required>
            <Input type="datetime-local" required {...field("startsAt")} />
          </FormField>
          <FormField label="Sales open" required>
            <Input type="datetime-local" required {...field("salesStartAt")} />
          </FormField>
          <FormField label="Sales close" required>
            <Input type="datetime-local" required {...field("salesEndAt")} />
          </FormField>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <FormField label="Capacity" required>
            <Input type="number" min="1" required {...field("capacity")} />
          </FormField>
          <FormField label="Maximum per order" required>
            <Input
              type="number"
              min="1"
              max="100"
              required
              {...field("maxTicketsPerOrder")}
            />
          </FormField>
          <FormField label="Currency" required>
            <Input maxLength={3} required {...field("currency")} />
          </FormField>
          <FormField label="Status" required>
            <Select {...field("status")}>
              {[
                "draft",
                "on_sale",
                "sales_paused",
                "sales_closed",
                "completed",
                "cancelled",
              ].map((value) => (
                <option key={value} value={value}>
                  {value.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Single ticket price" required>
            <Input
              type="number"
              min="0"
              step="0.01"
              required
              {...field("singlePrice")}
            />
          </FormField>
          <FormField
            label="Pair price"
            hint="For example, 800 means each pair costs 800 total."
            required
          >
            <Input
              type="number"
              min="0"
              step="0.01"
              required
              {...field("pairPrice")}
            />
          </FormField>
        </div>
        <FormField
          label="Accepted payment methods"
          hint="Choose one or more methods available to entrance-pass buyers."
          required
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["payhere", "PayHere online"],
              ["bank_transfer", "Manual bank transfer"],
              ["cash", "Cash at entrance"],
            ].map(([value, label]) => {
              const method = value as EventForm["paymentMethods"][number];
              return (
                <label key={method} className="flex items-center gap-3 border border-white/10 p-4 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={form.paymentMethods.includes(method)}
                    onChange={() => togglePaymentMethod(method)}
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </FormField>
        {form.paymentMethods.includes("bank_transfer") ? (
          <div className="grid gap-5 border border-white/10 bg-black/15 p-5 sm:grid-cols-2">
            <FormField label="Bank name" required>
              <Input required {...field("bankName")} />
            </FormField>
            <FormField label="Branch">
              <Input {...field("bankBranch")} />
            </FormField>
            <FormField label="Account name" required>
              <Input required {...field("bankAccountName")} />
            </FormField>
            <FormField label="Account number" required>
              <Input required {...field("bankAccountNumber")} />
            </FormField>
            <FormField label="Admin review time (minutes)" required>
              <Input type="number" min="1" max="10080" required {...field("bankTransferReviewMinutes")} />
            </FormField>
          </div>
        ) : null}
        {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save entrance fee"}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
