import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const baseUrl = process.env.OWOR_TEST_URL || "https://one-wave-one-route-cbt.pages.dev";
const staffId = process.env.OWOR_TEST_STAFF_ID;
const password = process.env.OWOR_TEST_PASSWORD;
if (!staffId || !password) throw new Error("OWOR_TEST_STAFF_ID and OWOR_TEST_PASSWORD are required");

const profileDir = mkdtempSync(join(tmpdir(), "owor-live-verify-"));
const port = 9237;
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  `${baseUrl}/login/`,
], { stdio: "ignore" });

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

async function waitForJson(url, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chrome debugging endpoint may need another short startup interval.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
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
  if (!tab?.webSocketDebuggerUrl) throw new Error("Chrome page target not found");
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", resolveOpen, { once: true });
    socket.addEventListener("error", rejectOpen, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  await send("Runtime.enable");
  await delay(1_500);
  const loginExpression = `(() => {
    const username = document.querySelector('input[autocomplete="username"]');
    const password = document.querySelector('input[autocomplete="current-password"]');
    if (!username || !password) return 'FORM_NOT_FOUND';
    const setValue = (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setValue(username, ${JSON.stringify(staffId)});
    setValue(password, ${JSON.stringify(password)});
    return 'FILLED';
  })()`;
  const filled = await send("Runtime.evaluate", { expression: loginExpression, returnByValue: true });
  if (filled.result?.value !== "FILLED") throw new Error(String(filled.result?.value || "Login form unavailable"));
  await delay(250);
  await send("Runtime.evaluate", { expression: "document.querySelector('form').requestSubmit(); 'SUBMITTED'", returnByValue: true });

  let result;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(250);
    const evaluated = await send("Runtime.evaluate", {
      expression: `JSON.stringify({url: location.href, text: document.body.innerText.slice(0, 12000)})`,
      returnByValue: true,
    });
    result = JSON.parse(evaluated.result?.value || "{}");
    if (result.url === `${baseUrl}/` && result.text.includes("ONE WAVE") && result.text.includes("Assignment")) break;
  }
  const ok = result?.url === `${baseUrl}/` && result?.text?.includes("ONE WAVE") && result?.text?.includes("Assignment");
  const loginError = result?.text?.includes("Staff ID atau password salah") || false;
  let developerReady = false;
  let developerError = false;
  if (ok) {
    await send("Runtime.evaluate", {
      expression: `document.querySelector('[aria-label="Buka menu developer"]')?.click(); 'CLICKED'`,
      returnByValue: true,
    });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await delay(250);
      const evaluated = await send("Runtime.evaluate", {
        expression: "document.body.innerText.slice(0, 16000)",
        returnByValue: true,
      });
      const text = String(evaluated.result?.value || "");
      developerError = text.includes("Failed to send a request to the Edge Function");
      developerReady = text.includes("Developer control center") && text.includes("CONFIGURED") && text.includes("Connected") && !developerError;
      if (developerReady || developerError) break;
    }
  }
  console.log(JSON.stringify({ ok, url: result?.url, loginError, hasAssignment: result?.text?.includes("Assignment") || false, hasSupabaseLive: result?.text?.includes("Live Supabase snapshot") || false, developerReady, developerError }));
  if (!ok || !developerReady) process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {
    // The target may already be closed after a failed navigation.
  }
  chrome.kill();
  await Promise.race([
    new Promise((resolveExit) => chrome.once("exit", resolveExit)),
    delay(2_000),
  ]);
  const resolvedProfile = resolve(profileDir);
  const resolvedTemp = resolve(tmpdir());
  if (resolvedProfile.startsWith(`${resolvedTemp}\\`) && resolvedProfile.includes("owor-live-verify-")) {
    try { rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {
      // Windows may retain a short-lived Chrome lock; the directory is OS temp only.
    }
  }
}
