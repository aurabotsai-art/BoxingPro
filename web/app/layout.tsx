import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "BoxingPro",
  description:
    "AI boxing coach — camera only. Live punch analysis, spoken drills, and honest metrics. Your video never leaves your phone.",
  manifest: "/manifest.json",
  icons: { icon: "/icon.svg" },
  metadataBase: new URL("https://boxing-pro.vercel.app"),
  openGraph: {
    title: "BoxingPro — AI boxing coach, camera only",
    description:
      "Real-time punch speed, guard coaching, callable drills and film study from nothing but your phone camera. Video never leaves the device.",
    url: "https://boxing-pro.vercel.app",
    siteName: "BoxingPro",
    type: "website",
    images: [{ url: "/icon-512.png", width: 512, height: 512 }],
  },
  twitter: {
    card: "summary",
    title: "BoxingPro — AI boxing coach, camera only",
    description: "Real-time punch analysis and spoken drills from your phone camera. No video ever leaves the device.",
    images: ["/icon-512.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#111111",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#111",
          color: "#eee",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
