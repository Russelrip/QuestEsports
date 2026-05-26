import Image from "next/image";
import Link from "next/link";
import { Container } from "@/components/ui/container";
import { socialLinks } from "@/lib/site";

export default function Footer() {
  return (
    <footer className="border-t border-white/8 bg-black/35">
      <Container className="py-10">
        <div className="grid gap-8 rounded-[32px] border border-white/8 bg-[linear-gradient(180deg,rgba(12,12,20,0.84),rgba(7,7,14,0.96))] p-6 sm:p-8 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-3">
            <p className="font-display text-lg tracking-[0.22em] text-white">QUEST ESPORTS</p>
            <div className="flex flex-wrap gap-3 text-sm text-slate-300">
              <Link href="/contact" className="hover:text-white">
                Contact
              </Link>
              <Link href="/terms-of-service" className="hover:text-white">
                Terms of Service
              </Link>
              <Link href="/privacy-policy" className="hover:text-white">
                Privacy Policy
              </Link>
              <Link href="/rulebook" className="hover:text-white">
                Rulebook
              </Link>
              <Link href="/tournaments" className="hover:text-white">
                Tournaments
              </Link>
            </div>
          </div>

          <div className="flex flex-col items-start gap-6 lg:items-end">
            <div className="social-links">
              {socialLinks.map(({ href, label, icon }) => (
                <a href={href} target="_blank" rel="noopener noreferrer" key={label} aria-label={label}>
                  <Image src={icon} alt={label} width={18} height={18} />
                </a>
              ))}
            </div>
            <p className="mt-1 text-sm text-slate-500">&copy; 2026 Quest Esports. All rights reserved.</p>
          </div>
        </div>
      </Container>
    </footer>
  );
}
