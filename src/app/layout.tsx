import type { Metadata } from "next";
import { Nunito, Space_Mono, VT323 } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
});

const receipt = Space_Mono({ variable: "--f-receipt", subsets: ["latin"], weight: ["400", "700"] });
const cash = VT323({ variable: "--f-cash", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: "Cemat Cemot",
  description: "Jasa titip beli kopi, pickup di outlet. Fore, Kopi Kenangan, Cotti, Janji Jiwa, Tomoro.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="id"
      className={`${nunito.variable} ${receipt.variable} ${cash.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
