// Last safety pass before a recording is written (CLAUDE.md §9.2: masking is never off). The
// recorders already mask and cut at capture time; this pass makes sure nothing slipped through
// (a recorder bug, an old browser tab running an older recorder) and that every value fits the
// AppMap schema (`parameter.value` ≤ 100 characters).
import { clipValue, maskSummary } from "./mask.js";
import type { Event, Parameter } from "./types.js";

const HEADER_MAX = 200;

function sweepParameter(p: Parameter | null | undefined): void {
  if (!p || typeof p.value !== "string") return;
  p.value = clipValue(maskSummary(p.name, p.value));
}

function sweepHeaders(headers: Record<string, string> | null | undefined): void {
  if (!headers) return;
  for (const [name, value] of Object.entries(headers)) {
    if (/^(authorization|cookie|set-cookie|apikey|x-api-key)$/i.test(name)) delete headers[name];
    else headers[name] = maskSummary(undefined, value).slice(0, HEADER_MAX);
  }
}

export function sweepEvents(events: Event[]): void {
  for (const event of events) {
    if (event.event === "call") {
      event.parameters?.forEach(sweepParameter);
      event.message?.forEach(sweepParameter);
      sweepParameter(event.receiver);
      sweepHeaders(event.http_client_request?.headers);
      sweepHeaders(event.http_server_request?.headers);
      for (const filter of event.supabase?.filters ?? []) filter.value = clipValue(maskSummary(filter.column, filter.value));
    } else {
      sweepParameter(event.return_value);
      sweepParameter(event.http_client_response?.return_value);
      sweepParameter(event.http_server_response?.return_value);
      sweepHeaders(event.http_client_response?.headers);
      sweepHeaders(event.http_server_response?.headers);
      for (const exception of event.exceptions ?? []) exception.message = clipValue(maskSummary(undefined, exception.message ?? ""));
      if (event.error) event.error.message = clipValue(maskSummary(undefined, event.error.message));
    }
  }
}
