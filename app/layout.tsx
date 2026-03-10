import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Leitmotif — Adaptive Audio for the Visually Impaired',
  description: 'AI-powered adaptive audio system that generates real-time background music to help visually impaired users perceive their surroundings.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
