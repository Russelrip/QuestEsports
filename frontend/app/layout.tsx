import "./globals.css";
import type { Viewport } from "next";
import { AuthProvider } from "@/components/auth/AuthProvider";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
import { ToastProvider } from "@/components/ui/toast-provider";
import { designTokenCssVariables } from "@/lib/design-tokens";
import { siteMetadata } from "@/lib/site";

export const metadata = siteMetadata;
export const viewport: Viewport = {
  themeColor: "#0b1020",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="page-shell">
        <style>{designTokenCssVariables}</style>
        <AuthProvider>
          <Navbar />
          <main>{children}</main>
          <Footer />
          <ToastProvider />
        </AuthProvider>
      </body>
    </html>
  );
}
