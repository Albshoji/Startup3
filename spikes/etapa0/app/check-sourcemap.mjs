// SPIKE — does the browser error stack still map to the original file:line through our loader?
import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage();
let stack = null;
page.on("pageerror", (e) => (stack = e.stack));
const frames = [];
page.on("response", async (r) => {
  if (r.url().includes("__nextjs_original-stack-frames")) {
    try { frames.push(await r.json()); } catch {}
  }
});
await page.goto("http://localhost:3100", { waitUntil: "networkidle" });
await page.click("#erro");
await new Promise((r) => setTimeout(r, 3000));
console.log("raw stack:", stack?.split("\n").slice(0, 4).join("\n"));
for (const f of frames.flat()) {
  const v = f.value ?? f;
  const of = v.originalStackFrame;
  if (of) console.log("original:", of.file, of.line1 ?? of.lineNumber, of.methodName);
}
await browser.close();
