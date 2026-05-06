import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ledger - Personal Finance Copilot",
  description: "A calm personal finance dashboard prototype for the Personal Finance OS MVP."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
