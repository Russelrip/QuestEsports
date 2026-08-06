"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";

export default function TicketQrCode({
  payload,
  label,
}: {
  payload: string;
  label: string;
}) {
  const [source, setSource] = useState("");
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 640,
      color: { dark: "#090313", light: "#ffffff" },
    }).then((value) => {
      if (active) setSource(value);
    });
    return () => {
      active = false;
    };
  }, [payload]);
  if (!source)
    return (
      <div
        className="aspect-square w-full animate-pulse bg-white/10"
        aria-label="Generating QR code"
      />
    );
  return (
    <Image
      src={source}
      alt={`QR code for ${label}`}
      width={640}
      height={640}
      unoptimized
      className="aspect-square w-full bg-white"
    />
  );
}
