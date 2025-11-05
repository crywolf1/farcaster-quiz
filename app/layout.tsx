import type { Metadata, Viewport } from "next";
import "./globals.css";

// Farcaster Mini App embed JSON
const miniAppEmbed = {
  version: "1",
  imageUrl: "https://quiz-alpha-flame.vercel.app/og-image.png",
  button: {
    title: "Play Quiz",
    action: {
      type: "launch_miniapp",
      url: "https://quiz-alpha-flame.vercel.app",
      name: "Farcaster Quiz",
      splashImageUrl: "https://quiz-alpha-flame.vercel.app/icon.png",
      splashBackgroundColor: "#000000",
    },
  },
};

// For backward compatibility
const frameEmbed = {
  ...miniAppEmbed,
  button: {
    ...miniAppEmbed.button,
    action: {
      ...miniAppEmbed.button.action,
      type: "launch_frame",
    },
  },
};

export const metadata: Metadata = {
  title: "Farcaster Quiz",
  description: "Real-time multiplayer quiz game for Farcaster",
  manifest: "/manifest.json",
  metadataBase: new URL("https://quiz-alpha-flame.vercel.app"),
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
  openGraph: {
    title: "Farcaster Quiz",
    description: "Real-time multiplayer quiz game",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Farcaster Quiz",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Farcaster Quiz",
    description: "Real-time multiplayer quiz game",
    images: ["/og-image.png"],
  },
  other: {
    "fc:miniapp": JSON.stringify(miniAppEmbed),
    "fc:frame": JSON.stringify(frameEmbed),
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#8a4fff" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
