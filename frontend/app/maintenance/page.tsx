import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { readSiteMaintenanceConfig } from "@/lib/maintenance";
import styles from "./maintenance.module.css";

export const metadata: Metadata = {
  title: "Scheduled Maintenance | Quest E-sports",
  description: "Quest E-sports is temporarily unavailable for scheduled maintenance.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const describeRetry = (seconds: number) => {
  if (seconds < 60) return `Please check again in about ${seconds} seconds.`;
  const minutes = Math.ceil(seconds / 60);
  return `Please check again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
};

export default function MaintenancePage() {
  const maintenance = readSiteMaintenanceConfig();
  if (!maintenance.enabled) redirect("/");

  return (
    <main className={styles.page}>
      <div className={styles.glow} aria-hidden="true" />
      <section className={styles.card} aria-labelledby="maintenance-title">
        <Image
          className={styles.logo}
          src="/images/logo.png"
          alt="Quest E-sports"
          width={156}
          height={156}
          priority
        />
        <p className={styles.eyebrow}>Scheduled maintenance</p>
        <h1 id="maintenance-title">We’ll be right back</h1>
        <p className={styles.message}>{maintenance.message}</p>
        <div className={styles.status}>
          <span className={styles.pulse} aria-hidden="true" />
          <span>Our team is working on it</span>
        </div>
        <p className={styles.retry}>{describeRetry(maintenance.retryAfterSeconds)}</p>
      </section>
    </main>
  );
}
