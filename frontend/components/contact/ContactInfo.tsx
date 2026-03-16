const iconStyle = {
  width: "20px",
  height: "20px",
  objectFit: "contain" as const,
};

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  marginBottom: "10px",
};

export default function ContactInfo() {
  return (
    <div className="contact-info">
      <h2>Contact Information</h2>

      <div className="info-item">
        <h3>Social Media</h3>

        <p style={rowStyle}>
          <img src="/images/gmail.png" alt="Gmail" style={iconStyle} />
          <a href="mailto:questesportslk@gmail.com">questesportslk@gmail.com</a>
        </p>

        <p style={rowStyle}>
          <img src="/images/discord.png" alt="Discord" style={iconStyle} />
          <a
            href="https://discord.gg/cxkM7dk9CM"
            target="_blank"
            rel="noopener noreferrer"
          >
            Quest Esports Discord
          </a>
        </p>

        <p style={rowStyle}>
          <img src="/images/facebook.png" alt="Facebook" style={iconStyle} />
          <a
            href="https://www.facebook.com/share/1HNNM3e9ub/?mibextid=wwXIfr"
            target="_blank"
            rel="noopener noreferrer"
          >
            Quest E-Sports LK
          </a>
        </p>

        <p style={rowStyle}>
          <img src="/images/instagram.png" alt="Instagram" style={iconStyle} />
          <a
            href="https://www.instagram.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            @questesportslk
          </a>
        </p>

        <p style={rowStyle}>
          <img src="/images/tiktok.png" alt="TikTok" style={iconStyle} />
          <a
            href="https://www.tiktok.com/@senumii"
            target="_blank"
            rel="noopener noreferrer"
          >
            @senumii
          </a>
        </p>
      </div>

      <div className="info-item">
        <h3
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <img
            src="/images/whatsapp.png"
            alt="WhatsApp"
            style={{
              width: "22px",
              height: "22px",
              objectFit: "contain",
            }}
          />
          WhatsApp
        </h3>

        <p style={{ marginTop: "10px" }}>
          <a
            href="https://wa.me/94761195666"
            target="_blank"
            rel="noopener noreferrer"
          >
            076 119 5666
          </a>
        </p>
        <p>
          <a
            href="https://wa.me/94767186060"
            target="_blank"
            rel="noopener noreferrer"
          >
            076 718 6060
          </a>
        </p>
      </div>
    </div>
  );
}
