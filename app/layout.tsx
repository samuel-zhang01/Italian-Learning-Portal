import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Parliamo! — 56 giorni per un A1 solido",
  description: "Un piano italiano di otto settimane costruito su Nuovo Espresso 1 e sulle lezioni Imperial di Samuel.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "Parliamo! — 56 giorni. Italiano che resta.",
    description: "Piano quotidiano, 28 lesson hub, prove CEFR e progressi salvati per consolidare l’italiano A1.",
    type: "website",
    images: [{ url: "/parliamo-social.png", width: 1731, height: 909, alt: "Parliamo — 56 giorni. Italiano che resta." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Parliamo! — 56 giorni. Italiano che resta.",
    description: "Piano quotidiano, 28 lesson hub, prove CEFR e progressi salvati per consolidare l’italiano A1.",
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
