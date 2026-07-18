import Image from "next/image";
import { Card } from "@/components/ui/card";
import {
  contactLinks,
  whatsappCommunityLink,
  whatsappContacts,
} from "@/lib/site";

export default function ContactInfo() {
  return (
    <Card className="p-6 sm:p-8">
      <p className="text-xs uppercase tracking-[0.28em] text-purple-200/80">Direct Channels</p>
      <h2 className="mt-3 text-3xl text-white">Contact information</h2>

      <div className="mt-8 grid gap-6">
        {contactLinks.map((group) => (
          <div key={group.title} className="grid gap-3">
            <h3 className="text-lg font-semibold text-white">{group.title}</h3>
            {group.items.map((item) => (
              <a
                key={item.label}
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-2xl border border-white/8 bg-white/4 px-4 py-3 text-sm text-slate-300 transition hover:bg-white/8 hover:text-white"
              >
                <Image src={item.icon} alt={item.label} width={18} height={18} />
                <span>{item.label}</span>
              </a>
            ))}
          </div>
        ))}

        <div className="grid gap-3">
          <h3 className="text-lg font-semibold text-white">WhatsApp</h3>
          <a
            href={whatsappCommunityLink.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-2xl border border-emerald-300/20 bg-emerald-400/8 px-4 py-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/14"
          >
            <Image src="/images/whatsapp.png" alt="" width={18} height={18} />
            <span>{whatsappCommunityLink.label}</span>
          </a>
          {whatsappContacts.map((contact) => (
            <a
              key={contact.label}
              href={contact.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex cursor-pointer items-center gap-3 rounded-2xl border border-emerald-300/15 bg-white/4 px-4 py-3 text-sm text-slate-300 transition hover:border-emerald-300/35 hover:bg-emerald-400/10 hover:text-emerald-100"
            >
              <Image src="/images/whatsapp.png" alt="" width={18} height={18} />
              {contact.label}
            </a>
          ))}
        </div>
      </div>
    </Card>
  );
}
