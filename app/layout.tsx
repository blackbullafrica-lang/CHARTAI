import type { Metadata, Viewport } from "next";
import "../src/style.css";

export const metadata: Metadata = {
  title: "Zeagles Community — Chart AI",
  description:
    "Real-time crypto charting, market analysis, and demo trading for the Zeagles Community.",
};

export const viewport: Viewport = { themeColor: "#050807" };

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
