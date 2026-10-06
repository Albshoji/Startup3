export enum Moeda {
  BRL = "BRL",
  USD = "USD",
}

export function formatarPreco(valor: number, moeda: Moeda = Moeda.BRL): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda }).format(valor);
}

export class Carrinho {
  private itens: number[] = [];

  adicionar(preco: number) {
    this.itens.push(preco);
    return this.total();
  }

  total(): number {
    return this.itens.reduce((soma, preco) => soma + preco, 0);
  }
}

export const somar = (a: number, b: number) => a + b;
