import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const baseUrl = process.env.OWOR_TEST_URL || "https://one-wave-one-route-cbt.pages.dev";
const profileDir = mkdtempSync(join(tmpdir(), "owor-logout-verify-"));
const port = 9238;
const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--no-first-run", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "about:blank"], { stdio: "ignore" });
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function waitForJson(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { const response = await fetch(url); if (response.ok) return response.json(); } catch { /* Chrome is starting. */ }
    await delay(250);
  }
  throw new Error("Chrome debugging endpoint unavailable");
}

let socket;
let nextId = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolveSend, rejectSend) => {
    const id = ++nextId;
    pending.set(id, { resolve: resolveSend, reject: rejectSend });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

try {
  const tabs = await waitForJson(`http://127.0.0.1:${port}/json`);
  const tab = tabs.find((candidate) => candidate.type === "page");
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => { socket.addEventListener("open", resolveOpen, { once: true }); socket.addEventListener("error", rejectOpen, { once: true }); });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message)); else waiter.resolve(message.result);
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `sessionStorage.setItem('__oworLoads', String(Number(sessionStorage.getItem('__oworLoads') || 0) + 1));` });
  await send("Page.navigate", { url: `${baseUrl}/` });
  await delay(5_000);
  const evaluated = await send("Runtime.evaluate", { expression: `JSON.stringify({url: location.href, loads: Number(sessionStorage.getItem('__oworLoads') || 0), login: document.body.innerText.includes('Masuk ke WMS workspace')})`, returnByValue: true });
  const result = JSON.parse(evaluated.result?.value || "{}");
  const ok = result.url === `${baseUrl}/login/` && result.login && result.loads <= 2;
  console.log(JSON.stringify({ ok, url: result.url, documentLoads: result.loads, loginVisible: result.login }));
  if (!ok) process.exitCode = 1;
} finally {
  try { socket?.close(); } catch { /* Target may already be closed. */ }
  chrome.kill();
  await Promise.race([new Promise((resolveExit) => chrome.once("exit", resolveExit)), delay(2_000)]);
  const resolvedProfile = resolve(profileDir);
  if (resolvedProfile.startsWith(`${resolve(tmpdir())}\\`) && resolvedProfile.includes("owor-logout-verify-")) {
    try { rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* OS temp only. */ }
  }
}
