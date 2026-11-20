import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Absensi Admin",
  description: "Dashboard kehadiran, revisi, lembur, WFH, dan payroll",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <head>
        <link
          rel="preload"
          href="/fonts/plus-jakarta-sans-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/inter-latin.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
