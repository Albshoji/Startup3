import { redirect } from "next/navigation";
import { normalizeUserCode } from "@/lib/cli-auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { currentUser } from "@/lib/supabase/server";
import { autorizar } from "./actions";

export default async function Dispositivo({ searchParams }: { searchParams: Promise<{ codigo?: string; erro?: string; ok?: string }> }) {
  const { codigo, erro, ok } = await searchParams;
  const user = await currentUser();
  if (!user) redirect(`/entrar?depois=${encodeURIComponent(`/dispositivo${codigo ? `?codigo=${codigo}` : ""}`)}`);

  if (ok) {
    return (
      <div className="card" style={{ maxWidth: 480, margin: "0 auto" }}>
        <h1>Computador conectado</h1>
        <p className="alert ok">Pronto. Pode voltar ao terminal: o comando `mapa` já está conectado à sua conta.</p>
      </div>
    );
  }

  const code = codigo ? normalizeUserCode(codigo) : "";
  let clientName: string | null = null;
  if (code) {
    const { data } = await supabaseAdmin().from("cli_device_codes").select("client_name").eq("user_code", code).is("approved_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    clientName = data?.client_name ?? null;
  }

  return (
    <div className="card" style={{ maxWidth: 480, margin: "0 auto" }}>
      <h1>Conectar o comando mapa</h1>
      <p>
        Confira se o código abaixo é o mesmo que aparece no seu terminal. Ao autorizar, o comando <code>mapa</code>
        {clientName ? (
          <>
            {" "}
            no computador <strong>{clientName}</strong>
          </>
        ) : null}{" "}
        poderá enviar gravações para a conta <strong>{user.email}</strong>.
      </p>
      {erro && <p className="alert error">Código não encontrado ou expirado. Rode <code>npx mapa login</code> de novo.</p>}
      <form action={autorizar}>
        <label htmlFor="codigo">Código</label>
        <input id="codigo" name="codigo" className="code-big" defaultValue={code} placeholder="XXXX-XXXX" required autoComplete="off" />
        <div className="row">
          <button id="autorizar" type="submit">
            Autorizar este computador
          </button>
        </div>
      </form>
    </div>
  );
}
