import { NextResponse, type NextRequest } from "next/server";

function marcarVisita(caminho: string) {
  return `visita:${caminho}`;
}

export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  response.headers.set("x-visita", marcarVisita(request.nextUrl.pathname));
  return response;
}

export const config = { matcher: ["/", "/api/:path*"] };
