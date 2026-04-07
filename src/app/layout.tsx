import type { Metadata } from "next";
import "chessground/assets/chessground.base.css";
import "chessground/assets/chessground.brown.css";
import "chessground/assets/chessground.cburnett.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dark Horse Chess",
  description: "MVP de xadrez online com Next.js, Chessground, chess.js e Socket.IO.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
