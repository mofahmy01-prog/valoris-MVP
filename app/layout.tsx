import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Valoris — simulation",
  description:
    "Research prototype for firefighter safety monitoring. Simulation only, not for operational use.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      {/*
        The simulation banner lives inside each page rather than here, so the
        demo can render it as part of its own full-height layout without a
        second bar stacking on top.
      */}
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
