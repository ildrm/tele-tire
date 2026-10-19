import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "TeleTier — Telegram Paid Membership & Subscription Manager",
  description:
    "Manage Telegram Stars memberships, private community access, and renewals in one workspace.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
