// Edge Function de TESTE do Mapa (cenário D): responde e escreve alguns console.log.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const { nome } = await req.json().catch(() => ({ nome: undefined }));
  console.log(`send-welcome: pedido recebido para ${nome ?? "(sem nome)"}`);
  console.log("send-welcome: montando mensagem de boas-vindas (simulado, nenhum e-mail é enviado)");

  const mensagem = `Bem-vindo, ${nome ?? "usuário"}!`;
  console.log(`send-welcome: pronto -> ${mensagem}`);

  return new Response(JSON.stringify({ ok: true, mensagem }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
