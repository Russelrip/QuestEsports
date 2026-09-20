import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";

const sections = [
  {
    title: "Customized merchandise",
    text: "Quest E-sports shirts and other personalized products become non-refundable and non-exchangeable once production has begun. This does not limit the remedies available when an item is supplied incorrectly or arrives damaged or defective.",
  },
  {
    title: "Wrong, damaged, or defective items",
    text: "Contact us promptly after delivery with your order number and clear photographs if the wrong item was supplied or an item arrived damaged or defective. After review, Quest E-sports will arrange an appropriate replacement or refund where required.",
  },
  {
    title: "Tournament registration fees",
    text: "A successfully paid tournament fee is non-refundable after registration is confirmed, including when a participant withdraws, misses a match, or is disqualified. If Quest E-sports cancels the event without a replacement date, affected paid entries will receive instructions about the applicable refund process.",
  },
  {
    title: "Entrance tickets",
    text: "Entrance-ticket refund eligibility follows the terms shown for the relevant event and applicable law. A scanned, cancelled, replaced, or otherwise invalidated QR code cannot be reused. If Quest E-sports cancels a ticketed event without a replacement date, affected buyers will receive instructions about the applicable refund process.",
  },
  {
    title: "Cancelled, postponed, or rescheduled events",
    text: "If an event is postponed or rescheduled, paid registrations and tickets carry over to the replacement date unless the event terms say otherwise. A refund is offered where Quest E-sports cancels an event outright without a replacement date, or where applicable law requires one.",
  },
  {
    title: "Unverified and rejected payments",
    text: "A bank-transfer submission that is never verified, or that is rejected as expired, duplicated, altered, or unmatched, does not create a confirmed registration and so does not create a refundable payment to Quest E-sports. If money did leave your account for a rejected submission, contact us with the transfer reference so we can trace it.",
  },
  {
    title: "How to request a refund",
    text: "Send your request by email or through the contact page with your order or registration number, the payment reference, and any supporting photographs. We confirm receipt, review the request against this policy and the terms for the relevant event or product, and tell you the outcome. Keep the request to the account or email address that made the purchase so we can verify it.",
  },
  {
    title: "Payment processing",
    text: "Approved refunds are returned through the original payment method where supported. Bank and payment-provider processing times are outside Quest E-sports' control.",
  },
];

export default function RefundPolicyContent() {
  return (
    <Section className="pt-6">
      <div className="grid gap-6">
        <Card className="p-6 sm:p-8">
          <p className="text-xs uppercase tracking-[0.28em] text-purple-200/80">Last Updated</p>
          <h2 className="mt-3 text-3xl text-white">September 20, 2026</h2>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            This policy covers customized merchandise, paid tournament registration, and entrance tickets on
            questesports.lk. It sits alongside the{" "}
            <Link href="/terms-of-service" className="text-purple-200 transition hover:text-purple-100">
              Terms of Service
            </Link>{" "}
            and the terms published for each individual event or product.
          </p>
        </Card>

        {sections.map((section) => (
          <Card key={section.title} className="p-6 sm:p-8">
            <h3 className="text-2xl text-white">{section.title}</h3>
            <p className="mt-4 text-sm leading-7 text-slate-300">{section.text}</p>
          </Card>
        ))}

        <Card className="p-6 sm:p-8">
          <h3 className="text-2xl text-white">Contact us</h3>
          <p className="mt-4 text-sm leading-7 text-slate-300">
            Send order or payment questions to{" "}
            <a href="mailto:questesports.lk@gmail.com" className="text-purple-200 transition hover:text-purple-100">
              questesports.lk@gmail.com
            </a>{" "}
            or use the{" "}
            <Link href="/contact" className="text-purple-200 transition hover:text-purple-100">
              contact page
            </Link>
            .
          </p>
        </Card>
      </div>
    </Section>
  );
}
