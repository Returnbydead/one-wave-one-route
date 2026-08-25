import type { Metadata } from "next";
import "./globals.css";

const title = "ONE WAVE ONE ROUTE · CBT";
const description =
  "Route-based SO assignment and manpower planning for CBT outbound operations.";

export const metadata: Metadata = { title, description };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
