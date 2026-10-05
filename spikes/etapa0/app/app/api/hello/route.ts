import { criarClienteServidor } from "@/lib/supabase-server";

function dobrar(n: number) {
  return n * 2;
}

export async function GET(request: Request) {
  const n = Number(new URL(request.url).searchParams.get("n") ?? 1);
  const supabase = await criarClienteServidor();
  const { data } = await supabase.rpc("calcular_total");
  return Response.json({ valor: dobrar(n), total: data });
}
