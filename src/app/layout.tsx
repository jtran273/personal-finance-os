import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledger - Personal Finance Copilot",
  description: "A calm personal finance dashboard prototype for the Personal Finance OS MVP."
};

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#f7f7f4",
  viewportFit: "cover",
  width: "device-width"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
