import "./globals.css";
import Footer from "@/components/Footer";
import Navbar from "@/components/Navbar";

export const metadata = {
  title: "Quest Esports",
  description: "Quest Esports website",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {/* Keep global navigation and footer around every page rendered by the App Router. */}
        <Navbar />
        {children}
        <Footer />
      </body>
    </html>
  );
}
