import Image from "next/image";
import { contactLinks, whatsappContacts } from "@/lib/site";

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

      {contactLinks.map((group) => (
        <div className="info-item" key={group.title}>
          <h3>{group.title}</h3>

          {group.items.map((item) => (
            <p style={rowStyle} key={item.label}>
              <Image
                src={item.icon}
                alt={item.label}
                width={20}
                height={20}
                style={iconStyle}
              />
              <a href={item.href} target="_blank" rel="noopener noreferrer">
                {item.label}
              </a>
            </p>
          ))}
        </div>
      ))}

      <div className="info-item">
        <h3
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <Image
            src="/images/whatsapp.png"
            alt="WhatsApp"
            width={22}
            height={22}
            style={{
              width: "22px",
              height: "22px",
              objectFit: "contain",
            }}
          />
          WhatsApp
        </h3>

        {whatsappContacts.map((contact, index) => (
          <p key={contact.label} style={index === 0 ? { marginTop: "10px" } : undefined}>
            <a href={contact.href} target="_blank" rel="noopener noreferrer">
              {contact.label}
            </a>
          </p>
        ))}
      </div>
    </div>
  );
}
