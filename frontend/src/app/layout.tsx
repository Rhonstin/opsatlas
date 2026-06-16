import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'opsatlas',
    template: '%s · opsatlas',
  },
  description: 'Multi-cloud infrastructure dashboard',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('theme');var c=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';document.documentElement.classList.add(c)})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
