/** Messages to the end user (Portuguese, CLAUDE.md §14), always prefixed so they stand out from Next's output. */
export function say(message: string): void {
  console.log(`[mapa] ${message}`);
}

export function warn(message: string): void {
  console.error(`[mapa] Atenção: ${message}`);
}
