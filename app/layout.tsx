import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title:"Deriv AI Trader", description:"Plateforme autonome de trading IA et SMC pour les indices synthétiques Deriv.", icons:{icon:"/favicon.svg",shortcut:"/favicon.svg"} };
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="fr"><body>{children}</body></html>}
