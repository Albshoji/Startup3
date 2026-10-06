import { entrar, criarConta } from "./actions";

export default async function Entrar({ searchParams }: { searchParams: Promise<{ erro?: string; depois?: string }> }) {
  const { erro, depois } = await searchParams;
  return (
    <div className="card" style={{ maxWidth: 420, margin: "0 auto" }}>
      <h1>Entrar no Mapa</h1>
      {erro && <p className="alert error">{erro}</p>}
      <form>
        <input type="hidden" name="depois" value={depois ?? "/gravacoes"} />
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="email" required />
        <label htmlFor="senha">Senha</label>
        <input id="senha" name="senha" type="password" autoComplete="current-password" required minLength={6} />
        <div className="row">
          <button id="entrar" formAction={entrar}>
            Entrar
          </button>
          <button id="criar-conta" className="secondary" formAction={criarConta}>
            Criar conta
          </button>
        </div>
      </form>
    </div>
  );
}
