import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sectorlens — NSE Share Price Tracker",
  description: "Explore NSE sectors and compare official historical closing prices.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
