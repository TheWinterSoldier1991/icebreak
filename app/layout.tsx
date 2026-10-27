import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

export const metadata: Metadata = {
  title: "IceBreak — a steadier way to budget",
  description:
    "A calm, flexible budget for student life. Split every deposit, track your goals, and know what is safe to spend.",
  applicationName: "IceBreak",
};

export const viewport: Viewport = {
  themeColor: "#f4f7f4",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
