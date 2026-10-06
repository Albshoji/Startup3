"use client";

function quebrar(): never {
  throw new Error("erro proposital");
}

export default function ErrorButton() {
  return (
    <button id="erro" onClick={() => quebrar()}>
      Erro proposital
    </button>
  );
}
