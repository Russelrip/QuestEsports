"use client";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";

export const supportComposerSchema = z.object({ subject: z.string().trim().min(1, "Subject is required.").max(160, "Subject must be 160 characters or fewer."), body: z.string().trim().min(1, "Message is required.").max(2000, "Message must be 2,000 characters or fewer.") });
type Values = z.infer<typeof supportComposerSchema>;
export default function SupportComposer({ subject = "", compact = false, busy = false, error, onSubmit }: { subject?: string; compact?: boolean; busy?: boolean; error?: string | null; onSubmit: (values: Values) => void | boolean | Promise<void | boolean> }) {
  const form = useForm<Values>({ resolver: zodResolver(supportComposerSchema), defaultValues: { subject, body: "" } });
  const subjectError = form.formState.errors.subject?.message;
  const bodyError = form.formState.errors.body?.message;
  const submit = async (values: Values) => { const completed = await onSubmit(values); if (completed === true) form.reset({ subject, body: "" }); };
  return <form onSubmit={form.handleSubmit(submit)} className="grid gap-4" noValidate><FormField label="Subject" htmlFor="supportSubject" error={subjectError} errorId="supportSubject-error" required={!compact}><Input id="supportSubject" aria-invalid={Boolean(subjectError)} aria-describedby={subjectError ? "supportSubject-error" : undefined} disabled={compact || busy} placeholder="What can we help with?" {...form.register("subject")} /></FormField><FormField label="Message" htmlFor="supportBody" error={bodyError} errorId="supportBody-error" required><Textarea id="supportBody" aria-invalid={Boolean(bodyError)} aria-describedby={bodyError ? "supportBody-error" : undefined} rows={compact ? 4 : 7} maxLength={2000} placeholder="Tell us what happened and how we can help." {...form.register("body")} /><p className="text-right text-[11px] text-slate-500">Up to 2,000 characters</p></FormField>{error ? <p role="alert" className="rounded-xl border border-red-300/20 bg-red-400/10 px-3 py-2 text-sm text-red-100">{error}</p> : null}<Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send message"}</Button></form>;
}
