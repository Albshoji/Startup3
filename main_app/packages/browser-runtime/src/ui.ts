// Floating Start/Stop button (CLAUDE.md §4 item 6). Shown only in development with MAPA=1 (this
// module is part of the recorder, which only exists then). Isolated from the app's CSS in a Shadow
// DOM; marked `data-mapa-ui` so clicks on it are never recorded as user actions.
import type { RecordingLimits, StopReason } from "@mapa/format";

export interface CollectorStatus {
  enabled?: boolean;
  saving?: boolean;
  elapsed_seconds?: number;
  remaining_seconds?: number;
  event_count?: number;
  bytes?: number;
  limits?: RecordingLimits;
  last?: { stopped_by: StopReason; event_count: number; directory: string; stopped_at: string };
}

export interface UiActions {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface Ui {
  update(status: CollectorStatus | null): void;
}

const STOP_MESSAGES: Record<StopReason, string> = {
  user: "Gravação salva",
  "time-limit": "Parou sozinha: chegou ao tempo máximo. O que foi gravado foi salvo",
  "event-limit": "Parou sozinha: chegou ao número máximo de eventos. O que foi gravado foi salvo",
  "size-limit": "Parou sozinha: chegou ao tamanho máximo. O que foi gravado foi salvo",
  shutdown: "Gravação salva (o Mapa foi fechado)",
};

const STYLE = `
:host { all: initial; }
.box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
  font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; color: #f4f4f5; }
.pill { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 12px; border-radius: 999px; background: #18181b; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
.dot { width: 10px; height: 10px; border-radius: 50%; background: #71717a; flex: none; }
.rec .dot { background: #ef4444; animation: pulse 1.2s ease-in-out infinite; }
.off .dot { background: #f59e0b; }
@keyframes pulse { 50% { opacity: .35; } }
.label { white-space: nowrap; }
.meter { width: 64px; height: 6px; border-radius: 3px; background: #3f3f46; overflow: hidden; }
.meter > i { display: block; height: 100%; width: 0; background: #22c55e; }
.meter.high > i { background: #f59e0b; }
button { all: unset; cursor: pointer; padding: 4px 10px; border-radius: 999px; background: #f4f4f5; color: #18181b; font-weight: 600; }
button:hover { background: #fff; }
button:disabled { opacity: .5; cursor: default; }
.rec button { background: #ef4444; color: #fff; }
.note { max-width: 320px; padding: 8px 12px; border-radius: 10px; background: #18181b; box-shadow: 0 4px 16px rgba(0,0,0,.25); }
.note[hidden] { display: none; }
`;

export function mountUi(actions: UiActions): Ui {
  const host = document.createElement("div");
  host.setAttribute("data-mapa-ui", "");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${STYLE}</style>
    <div class="box">
      <div class="note" hidden></div>
      <div class="pill" title="Mapa: grava o que acontece no app enquanto você usa">
        <span class="dot"></span><span class="label">Mapa</span>
        <span class="meter" hidden title="Quanto do limite de tamanho já foi usado"><i></i></span>
        <button type="button">Gravar</button>
      </div>
    </div>`;
  const pill = root.querySelector<HTMLElement>(".pill")!;
  const label = root.querySelector<HTMLElement>(".label")!;
  const meter = root.querySelector<HTMLElement>(".meter")!;
  const bar = meter.querySelector<HTMLElement>("i")!;
  const button = root.querySelector<HTMLButtonElement>("button")!;
  const note = root.querySelector<HTMLElement>(".note")!;

  let status: CollectorStatus | null = null;
  let receivedAt = 0;
  /** A recording ended (seen here or started from here): announce the next saved file. */
  let expectingStop = false;
  let lastSeenStop: string | undefined;
  let busy = false;
  let noteTimer: ReturnType<typeof setTimeout> | undefined;

  const showNote = (text: string, ms = 8000) => {
    note.textContent = text;
    note.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => (note.hidden = true), ms);
  };

  button.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    try {
      if (status?.enabled) await actions.stop();
      else await actions.start();
    } catch {
      showNote("Não consegui falar com o Mapa. Ele ainda está rodando no terminal (npx mapa dev)?");
    } finally {
      busy = false;
      button.disabled = false;
    }
  });

  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.max(0, Math.floor(seconds % 60))).padStart(2, "0")}`;

  function render() {
    pill.classList.toggle("rec", !!status?.enabled);
    pill.classList.toggle("off", status === null);
    if (status === null) {
      label.textContent = "Mapa desligado";
      meter.hidden = true;
      button.hidden = true;
      return;
    }
    button.hidden = false;
    if (!status.enabled) {
      label.textContent = status.saving ? "Salvando…" : "Mapa";
      meter.hidden = true;
      button.textContent = "Gravar";
      return;
    }
    const passed = (Date.now() - receivedAt) / 1000;
    const remaining = Math.max(0, (status.remaining_seconds ?? 0) - passed);
    label.textContent = `Gravando · resta ${clock(remaining)}`;
    // Size used: the larger of events and megabytes against their limits.
    const limits = status.limits;
    const used = limits ? Math.max((status.event_count ?? 0) / limits.maxEvents, (status.bytes ?? 0) / (limits.maxMegabytes * 1_000_000)) : 0;
    meter.hidden = false;
    meter.classList.toggle("high", used > 0.75);
    meter.title = `Limite de tamanho: ${Math.round(used * 100)}% usado`;
    bar.style.width = `${Math.min(100, Math.round(used * 100))}%`;
    button.textContent = "Parar";
  }

  setInterval(render, 1000);

  const mount = () => {
    if (!host.isConnected) document.body.appendChild(host);
  };
  // After the page finished loading, so React's hydration never sees this element.
  if (document.readyState === "complete") mount();
  else window.addEventListener("load", mount, { once: true });

  return {
    update(next) {
      if (status?.enabled && !next?.enabled) expectingStop = true;
      status = next;
      receivedAt = Date.now();
      const stop = next?.last;
      if (stop && stop.stopped_at !== lastSeenStop) {
        if (lastSeenStop !== undefined || expectingStop) {
          showNote(`${STOP_MESSAGES[stop.stopped_by]} (${stop.event_count} eventos). Está em ${stop.directory.replace(/^.*?(\.mapa\/)/, "$1")}`);
          expectingStop = false;
        }
        lastSeenStop = stop.stopped_at;
      }
      render();
    },
  };
}
