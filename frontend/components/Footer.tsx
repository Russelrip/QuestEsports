import Image from "next/image";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { socialLinks, whatsappContacts } from "@/lib/site";

const mainMenuLinks = [
  { href: "/", label: "Home" },
  { href: "/tournaments", label: "Tournaments" },
  { href: "/match-videos", label: "Match Videos" },
  { href: "/gallery", label: "Gallery" },
] as const;

const usefulLinks = [
  { href: "/members", label: "Members" },
  { href: "/join", label: "Join Quest" },
  { href: "/shop", label: "Shop" },
  { href: "/terms-of-service", label: "Terms of Service" },
  { href: "/privacy-policy", label: "Privacy Policy" },
] as const;

function FooterLinkList({
  links,
}: {
  links: readonly { href: string; label: string }[];
}) {
  return (
    <nav className="mt-5 grid">
      {links.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="border-b border-white/8 py-2.5 text-xs uppercase tracking-[0.12em] text-slate-400 transition hover:text-white"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export default function Footer() {
  return (
    <footer className="mobile-content-auto mt-10 border-t border-white/10 bg-[#0a0a10]">
      <Container className="py-10 sm:py-12">
        <div className="grid gap-10 lg:grid-cols-[1.35fr_0.8fr_0.8fr_1fr] lg:gap-12">
          <div>
            <Link href="/" className="inline-flex flex-col items-center gap-2" aria-label="Quest home">
              <Image
                src="/images/logo.png"
                alt=""
                width={72}
                height={72}
                className="h-16 w-16"
              />
              <span className="pl-[0.24em] font-display text-sm tracking-[0.24em] text-white">
                QUEST
              </span>
            </Link>
            <p className="mt-6 max-w-sm text-sm leading-7 text-slate-400">
              Quest E-sports brings together competitive players, teams, organizers, and
              gaming communities across Sri Lanka through tournaments, media, and events.
            </p>
          </div>

          <div>
            <h2 className="border-l-2 border-cyan-300 pl-3 text-xs font-semibold uppercase tracking-[0.16em] text-white">
              Main Menu
            </h2>
            <FooterLinkList links={mainMenuLinks} />
          </div>

          <div>
            <h2 className="border-l-2 border-cyan-300 pl-3 text-xs font-semibold uppercase tracking-[0.16em] text-white">
              Useful Links
            </h2>
            <FooterLinkList links={usefulLinks} />
          </div>

          <div>
            <h2 className="border-l-2 border-cyan-300 pl-3 text-xs font-semibold uppercase tracking-[0.16em] text-white">
              Contact
            </h2>
            <div className="mt-5 grid gap-3 text-sm text-slate-400">
              <a
                href="mailto:questesports.lk@gmail.com"
                className="border-b border-white/8 pb-3 transition hover:text-white"
              >
                questesports.lk@gmail.com
              </a>
              {whatsappContacts.map((contact) => (
                <a
                  key={contact.href}
                  href={contact.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border-b border-white/8 pb-3 transition hover:text-white"
                >
                  {contact.label}
                </a>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              {socialLinks.map(({ href, label, icon }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  key={label}
                  aria-label={label}
                  title={label}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 transition hover:border-white/25 hover:bg-white/10"
                >
                  <Image src={icon} alt="" width={16} height={16} />
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-white/8 pt-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; 2026 Quest E-sports. All rights reserved.</p>
          <p>Competitive gaming, community, and events.</p>
        </div>
      </Container>
    </footer>
  );
}
