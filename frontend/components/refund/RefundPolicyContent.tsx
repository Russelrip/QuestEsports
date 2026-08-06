import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Section } from "@/components/ui/section";

const sections = [
  { title: "Customized merchandise", text: "Quest E-sports shirts and other personalized products become non-refundable and non-exchangeable once production has begun. This does not limit the remedies available when an item is supplied incorrectly or arrives damaged or defective." },
  { title: "Wrong, damaged, or defective items", text: "Contact us promptly after delivery with your order number and clear photographs if the wrong item was supplied or an item arrived damaged or defective. After review, Quest E-sports will arrange an appropriate replacement or refund where required." },
  { title: "Tournament registration fees", text: "A successfully paid tournament fee is non-refundable after registration is confirmed, including when a participant withdraws, misses a match, or is disqualified. If Quest E-sports cancels the event without a replacement date, affected paid entries will receive instructions about the applicable refund process." },
  { title: "Entrance tickets", text: "Entrance-ticket refund eligibility follows the terms shown for the relevant event and applicable law. A scanned, cancelled, replaced, or otherwise invalidated QR code cannot be reused. If Quest E-sports cancels a ticketed event without a replacement date, affected buyers will receive instructions about the applicable refund process." },
  { title: "Payment processing", text: "Approved refunds are returned through the original payment method where supported. Bank and payment-provider processing times are outside Quest E-sports' control." },
];

export default function RefundPolicyContent() {
  return <Section className="pt-6"><div className="grid gap-6"><Card className="p-6 sm:p-8"><p className="text-xs uppercase tracking-[0.28em] text-purple-200/80">Last Updated</p><h2 className="mt-3 text-3xl text-white">August 6, 2026</h2><p className="mt-4 text-sm leading-7 text-slate-300">This policy covers customized merchandise, paid tournament registration, and entrance tickets on questesports.lk.</p></Card>{sections.map((section) => <Card key={section.title} className="p-6 sm:p-8"><h3 className="text-2xl text-white">{section.title}</h3><p className="mt-4 text-sm leading-7 text-slate-300">{section.text}</p></Card>)}<Card className="p-6 sm:p-8"><h3 className="text-2xl text-white">Contact us</h3><p className="mt-4 text-sm leading-7 text-slate-300">Send order or payment questions to <a className="text-purple-200" href="mailto:questesports.lk@gmail.com">questesports.lk@gmail.com</a> or use the <Link className="text-purple-200" href="/contact">contact page</Link>.</p></Card></div></Section>;
}
