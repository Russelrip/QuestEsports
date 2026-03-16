import Image from "next/image";
import Link from "next/link";
import { socialLinks } from "@/lib/site";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-meta">
          <p>&copy; 2026 Quest Esports. All rights reserved.</p>
          <Link href="/contact" className="footer-link">
            Contact Us
          </Link>
        </div>
        <div className="social-links">
          {socialLinks.map(({ href, label, icon }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" key={label}>
              <Image src={icon} alt={label} width={20} height={20} />
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
