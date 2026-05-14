import type { Metadata } from "next";
import { Roboto, Roboto_Mono } from "next/font/google";
import "./globals.css";
import { TopNav } from "@/components/TopNav";
import { BrandMark } from "@/components/BrandMark";

const roboto = Roboto({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "PPM Dashboard",
  description: "Property project management dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${roboto.variable} ${robotoMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background">
        <header className="flex items-center gap-6 border-b-2 border-[color:var(--brand-blue)] bg-card px-4 py-3 shadow-sm">
          <BrandMark />
          <TopNav />
        </header>
        <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
      </body>
    </html>
  );
}
