import { criarClienteServidor } from "@/lib/supabase-server";

function arredondar(valor: number) {
  return Math.round(valor * 100) / 100;
}

export async function GET(request: Request) {
  const moeda = new URL(request.url).searchParams.get("moeda") ?? "BRL";
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc("calcular_total");
  console.log("total calculado no servidor", data);
  return Response.json({ moeda, total: arredondar(Number(data ?? 0)), erro: error?.message });
}
