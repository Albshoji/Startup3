"use client";

import { useState } from "react";
import { somar } from "@/lib/precos";

export default function LoopButton() {
  const [resultado, setResultado] = useState<number | null>(null);

  function rodarLoop() {
    let total = 0;
    for (let i = 0; i < 10000; i++) total = somar(total, i);
    setResultado(total);
  }

  return (
    <section>
      <button id="loop" onClick={rodarLoop}>
        Loop pesado
      </button>
      <span id="loop-resultado">{resultado}</span>
    </section>
  );
}
