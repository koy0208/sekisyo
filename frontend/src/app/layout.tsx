import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppSidebar, MobileNav } from "@/components/sidebar/app-sidebar";
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
  title: "Sekisyo Dashboard",
  description: "Personal health and budget dashboard",
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
        <div className="flex min-h-screen">
          <AppSidebar />
          {/* pb はモバイル下部タブバーの高さ分。min-w-0 でチャートの横はみ出しを防ぐ */}
          <main className="min-w-0 flex-1 pb-16 md:pb-0">{children}</main>
        </div>
        <MobileNav />
      </body>
    </html>
  );
}
