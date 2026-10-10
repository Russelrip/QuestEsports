"use client";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { useEffect, useId, useState } from "react";
import { useSupportState } from "./SupportProvider";
import SupportAttachmentPicker from "./SupportAttachmentPicker";
import { isUntouchedBody, isUntouchedSubject, supportTopics, type SupportTopic } from "./supportTopics";

export const supportComposerSchema = z.object({ subject: z.string().trim().min(1, "Subject is required.").max(160, "Subject must be 160 characters or fewer."), body: z.string().trim().min(1, "Message is required.").max(2000, "Message must be 2,000 characters or fewer.") });
export type SupportComposerValues = z.infer<typeof supportComposerSchema> & { screenshots: File[] };
export default function SupportComposer({ subject = "", compact = false, busy = false, error, draftKey, onSubmit }: { subject?: string; compact?: boolean; busy?: boolean; error?: string | null; draftKey?: string; onSubmit: (values: SupportComposerValues) => void | boolean | Promise<void | boolean> }) {
  const support = useSupportState();
  const id = useId();
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [topicId, setTopicId] = useState<string | null>(null);
  const form = useForm<z.infer<typeof supportComposerSchema>>({ resolver: zodResolver(supportComposerSchema), defaultValues: (draftKey && support?.drafts.get(draftKey)) || { subject, body: "" } });
  const { subscribe, getValues } = form;
  useEffect(() => {
    const unsubscribe = subscribe({ formState: { values: true }, callback: ({ values }) => {
      if (draftKey && support) support.drafts.set(draftKey, { subject: values.subject || "", body: values.body || "" });
    } });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const values = getValues();
      if (values.body.trim() || (!compact && values.subject.trim())) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { unsubscribe(); window.removeEventListener("beforeunload", beforeUnload); };
  }, [subscribe, getValues, draftKey, support, compact]);
  // Fills only what the player has not written themselves, so switching topics
  // after typing never loses their words.
  const chooseTopic = (topic: SupportTopic) => {
    setTopicId(topic.id);
    const options = { shouldDirty: true } as const;
    if (isUntouchedSubject(form.getValues("subject"))) form.setValue("subject", topic.subject, options);
    if (isUntouchedBody(form.getValues("body"))) form.setValue("body", topic.template, options);
    document.getElementById(`${id}-${topic.subject ? "body" : "subject"}`)?.focus();
  };
  const subjectError = form.formState.errors.subject?.message;
  const bodyError = form.formState.errors.body?.message;
  const submit = async (values: z.infer<typeof supportComposerSchema>) => { if (busy) return; const completed = await onSubmit({ ...values, screenshots }); if (completed === true) { form.reset({ subject, body: "" }); setScreenshots([]); setTopicId(null); if (draftKey) support?.drafts.delete(draftKey); } };
  return <form onSubmit={form.handleSubmit(submit)} className="grid gap-4" noValidate>
    {!compact && <fieldset className="grid gap-3"><legend className="mb-3 text-sm font-semibold text-white">What do you need help with?</legend>
      <div className="grid gap-2 sm:grid-cols-2">{supportTopics.map((topic) => <button key={topic.id} type="button" aria-pressed={topicId === topic.id} disabled={busy} onClick={() => chooseTopic(topic)} className={`min-h-11 rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-60 ${topicId === topic.id ? "border-cyan-300/50 bg-cyan-300/10" : "border-white/10 bg-white/[.03] hover:border-white/20 hover:bg-white/[.06]"}`}><span className="block text-sm font-semibold text-white">{topic.label}</span><span className="mt-0.5 block text-xs leading-5 text-slate-400">{topic.hint}</span></button>)}</div>
      {topicId === "report" ? <p className="text-xs leading-5 text-slate-300">Screenshots or clips help most. Reports are only seen by Quest staff.</p> : null}
    </fieldset>}
    {!compact && <FormField label="Subject" htmlFor={`${id}-subject`} error={subjectError} errorId="supportSubject-error" required><Input id={`${id}-subject`} aria-invalid={Boolean(subjectError)} aria-describedby={subjectError ? "supportSubject-error" : undefined} disabled={busy} maxLength={160} placeholder="Briefly describe the issue" {...form.register("subject")} /></FormField>}
    <FormField label={compact ? "Reply" : "Message"} htmlFor={`${id}-body`} error={bodyError} errorId="supportBody-error" required>
      <Textarea id={`${id}-body`} aria-invalid={Boolean(bodyError)} aria-describedby={bodyError ? "supportBody-error" : `${id}-guidance`} disabled={busy} rows={compact ? 4 : 7} maxLength={2000} placeholder={compact ? "Write your reply…" : "What happened, and what did you expect?"} {...form.register("body")} />
      <p id={`${id}-guidance`} className="mt-2 text-xs leading-5 text-slate-300">{!compact && "Include a tournament, team, or order reference if useful. "}Do not include passwords, verification codes, or full card details. Up to 2,000 characters.</p>
    </FormField>
    <SupportAttachmentPicker files={screenshots} onChange={setScreenshots} disabled={busy} />
    {error ? <p role="alert" className="rounded-xl border border-red-300/20 bg-red-400/10 px-3 py-2 text-sm text-red-100">{error} Your text is still here. If the connection dropped, check the conversation before sending again.</p> : null}
    <div className="flex flex-wrap items-center justify-between gap-3">
      {draftKey && <button type="button" disabled={busy} className="min-h-11 text-sm text-slate-300 underline" onClick={() => { form.reset({ subject, body: "" }); setScreenshots([]); setTopicId(null); support?.drafts.delete(draftKey); }}>Clear draft</button>}
      <button type="submit" disabled={busy} className="ml-auto inline-flex min-h-11 items-center justify-center rounded-xl bg-cyan-300 px-5 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-200 disabled:cursor-not-allowed disabled:opacity-60">{busy ? "Sending…" : compact ? "Send reply" : "Send message"}</button>
    </div>
    {!compact && <p className="text-xs leading-5 text-slate-400">Replies stay in your private support inbox. Your draft is kept while you navigate this site, until you sign out or close this tab.</p>}
  </form>;
}
