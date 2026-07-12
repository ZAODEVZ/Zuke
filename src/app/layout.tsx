import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthKitWrapper } from "@/components/AuthKitWrapper";
import { zukeConfig } from "@/zuke.config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: `${zukeConfig.name} - live audio for Farcaster communities`,
  description:
    "Zuke is the multi-provider live audio surface for Farcaster communities.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthKitWrapper>{children}</AuthKitWrapper>
      </body>
    </html>
  );
}
