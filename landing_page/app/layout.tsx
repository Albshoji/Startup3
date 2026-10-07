import type { Metadata } from 'next';
import { Caveat, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import { SITE_DESCRIPTION, SITE_TITLE } from '@/lib/site';
import './globals.css';

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

const caveat = Caveat({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-hand',
  display: 'swap',
});

export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  // TODO: definir metadataBase com o domínio final e adicionar a imagem de OG
  // (app/opengraph-image.png, 1200×630) quando ela existir.
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${plexSans.variable} ${plexMono.variable} ${caveat.variable}`}>
      <body>{children}</body>
    </html>
  );
}
