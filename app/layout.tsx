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
      <body className="min-h-screen antialiased">
        <div
          role="status"
          className="sticky top-0 z-50 border-b border-amber-500 bg-amber-500 px-4 py-2 text-center text-sm font-semibold tracking-wide text-black"
        >
          SIMULATION MODE — NOT FOR OPERATIONAL USE
        </div>
        {children}
      </body>
    </html>
  );
}
