import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/supabase/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mapa",
  description: "Veja como o seu app Next.js + Supabase funciona por dentro.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="pt-BR">
      <body>
        <header className="top">
          <Link href="/" className="brand">
            Mapa
          </Link>
          <nav>
            {user ? (
              <>
                <Link href="/gravacoes">Gravações</Link>
                <Link href="/projetos">Projetos</Link>
                <span className="hide-mobile">{user.email}</span>
                <form action="/sair" method="post">
                  <button className="secondary" type="submit">
                    Sair
                  </button>
                </form>
              </>
            ) : (
              <Link href="/entrar">Entrar</Link>
            )}
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
