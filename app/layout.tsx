import type { Metadata } from "next";
import "./globals.css";
import { ConvexClientProvider } from "@/lib/convex";

export const metadata: Metadata = {
  title: "LifeOR2 - Life & Finance Arrangements",
  description: "Comprehensive life and finance data model system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <ConvexClientProvider>{children}</ConvexClientProvider>
      </body>
    </html>
  );
}
