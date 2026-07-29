import "./globals.css";
import type { Viewport } from "next";
import { AuthProvider } from "@/components/auth/AuthProvider";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { ToastProvider } from "@/components/ui/toast-provider";
import { designTokenCssVariables } from "@/lib/design-tokens";
import { readSiteMaintenanceConfig } from "@/lib/maintenance";
import { siteMetadata } from "@/lib/site";
import Telemetry from "@/components/Telemetry";

export const metadata = siteMetadata;
// A per-request CSP nonce is generated in proxy.ts, so pages must render per request.
export const dynamic = "force-dynamic";
export const viewport: Viewport = {
  themeColor: "#0b1020",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const maintenance = readSiteMaintenanceConfig();

  if (maintenance.enabled) {
    return (
      <html lang="en">
        <body className="page-shell">
          <style>{designTokenCssVariables}</style>
          {children}
        </body>
      </html>
    );
  }

  return (
    <html lang="en">
      <body className="page-shell">
        <style>{designTokenCssVariables}</style>
        <AuthProvider>
          <Navbar />
          <main>{children}</main>
          <Footer />
          <ToastProvider />
          <Telemetry />
        </AuthProvider>
      </body>
    </html>
  );
}
