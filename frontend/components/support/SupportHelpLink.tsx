"use client";

import Link from "next/link";
import { useSupportState } from "./SupportProvider";

export default function SupportHelpLink({ subject, context = "" }: { subject: string; context?: string }) {
  const support = useSupportState();
  return <Link href="/support/new" className="inline-flex min-h-11 items-center text-sm font-semibold text-cyan-200 underline" onClick={() => {
    // Public context only. Existing drafts always win; no private data in the URL.
    if (support?.signedIn && !support.drafts.get("new")?.body && !support.drafts.get("new")?.subject) {
      support.drafts.set("new", { subject: subject.slice(0, 160), body: context ? `${context}\n\n` : "" });
    }
  }}>Need help? Contact support</Link>;
}
