import type { Metadata, Viewport } from "next";
import "./globals.css";

// Get the base URL - use environment variable or default
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}` 
  : 'https://quiz-alpha-flame.vercel.app';

// Farcaster Mini App embed JSON
const miniAppEmbed = {
  version: "1",
  imageUrl: `${baseUrl}/og-image.png`,
  button: {
    title: "Play Quiz",
    action: {
      type: "launch_miniapp",
      url: baseUrl,
      name: "Farcaster Quiz",
      splashImageUrl: `${baseUrl}/icon.png`,
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
  metadataBase: new URL(baseUrl),
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
  openGraph: {
    title: "Farcaster Quiz",
    description: "Real-time multiplayer quiz game",
    url: baseUrl,
    siteName: "Farcaster Quiz",
    images: [
      {
        url: `${baseUrl}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "Farcaster Quiz",
        type: "image/png",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Farcaster Quiz",
    description: "Real-time multiplayer quiz game",
    images: [`${baseUrl}/og-image.png`],
  },
  other: {
    "fc:miniapp": JSON.stringify(miniAppEmbed),
    "fc:frame": JSON.stringify(frameEmbed),
    // Additional Farcaster-specific tags
    "fc:frame:image": `${baseUrl}/og-image.png`,
    "fc:frame:image:aspect_ratio": "1.91:1",
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
