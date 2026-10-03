import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeScript } from "@/components/theme-script";
import { Nav } from "./nav";

// shadcn espera la tipografía en `--font-sans` / `--font-mono`: así los
// componentes del registry heredan la fuente sin tocarles una clase.
const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "smart money",
  description: "Finanzas personales en ARS y USD, por sobres",
};

// El color de la barra del navegador sigue al tema; sin esto el notch del
// teléfono queda blanco sobre una app oscura.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `suppressHydrationWarning` es obligatorio: el script del tema le pone la
    // clase `dark` al <html> antes de hidratar, así que el markup del servidor
    // y el del cliente difieren a propósito.
    <html
      lang="es-AR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Nav />
        {children}
      </body>
    </html>
  );
}
