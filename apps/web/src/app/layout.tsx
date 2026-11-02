import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CS 101 · Demo course site',
  description: 'Demo course site for submitting code with a CodeLapse recording.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
