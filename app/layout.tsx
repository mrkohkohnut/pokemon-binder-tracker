import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://pokemon-binder-tracker.mrkohkohnut.chatgpt.site"),
  title: "Poké Binder | Pokémon Card Tracker",
  description:
    "Catch every card with a full National Pokédex binder, expanded printing catalogue, and cloud-synced collection progress.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "Poké Binder",
    description: "Catch every card. Complete every pocket.",
    url: "/",
    siteName: "Poké Binder",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Poké Binder — Catch every card. Complete every pocket.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Poké Binder",
    description: "Catch every card. Complete every pocket.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
