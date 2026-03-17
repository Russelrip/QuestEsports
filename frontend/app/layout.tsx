import "./globals.css";
import type { Viewport } from "next";
import { AuthProvider } from "@/components/auth/AuthProvider";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";
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
      <body>
        <AuthProvider>
          <Navbar />
          {children}
          <Footer />
        </AuthProvider>
      </body>
    </html>
  );
}
