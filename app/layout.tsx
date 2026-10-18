import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Parliamo! — Un po’ d’italiano, ogni giorno",
  description:
    "Lezioni brevi, piano flessibile e progressi sul dispositivo, basati sui materiali del corso.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "Parliamo! — Un po’ d’italiano, ogni giorno.",
    description:
      "36 brevi lezioni bilingui, ripassi e un piano flessibile per usare l’italiano ogni giorno.",
    type: "website",
    images: [
      {
        url: "/parliamo-social.png",
        width: 1731,
        height: 909,
        alt: "Parliamo — Un po’ d’italiano, ogni giorno.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Parliamo! — Un po’ d’italiano, ogni giorno.",
    description:
      "36 brevi lezioni bilingui, ripassi e un piano flessibile per usare l’italiano ogni giorno.",
    images: ["/parliamo-social.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
