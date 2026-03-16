import Image from "next/image";
import Link from "next/link";

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
        {/* Social icons in the footer link out to the organization's public channels. */}
        <div className="social-links">
          <a
            href="https://api.whatsapp.com/send?phone=94761195666"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image src="/images/whatsapp.png" alt="WhatsApp" width={20} height={20} />
          </a>
          <a
            href="https://discord.gg/cxkM7dk9CM"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image src="/images/discord.png" alt="Discord" width={20} height={20} />
          </a>
          <a
            href="https://accounts.google.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image src="/images/gmail.png" alt="Gmail" width={20} height={20} />
          </a>
          <a
            href="https://www.facebook.com/share/1HNNM3e9ub/?mibextid=wwXIfr"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image src="/images/facebook.png" alt="Facebook" width={20} height={20} />
          </a>
          <a
            href="https://www.instagram.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image src="/images/instagram.png" alt="Instagram" width={20} height={20} />
          </a>
          <a
            href="https://www.tiktok.com/@senumii"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image src="/images/tiktok.png" alt="TikTok" width={20} height={20} />
          </a>
        </div>
      </div>
    </footer>
  );
}
