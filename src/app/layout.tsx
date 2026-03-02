import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import AppWalletProvider from '@/components/AppWalletProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AgentWall',
  description: 'The AI-driven dynamic pixel canvas on Solana.',
};

import { Toaster } from 'sonner';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AppWalletProvider>
          {children}
          <Toaster position="top-center" theme="dark" richColors />
        </AppWalletProvider>
      </body>
    </html>
  );
}
