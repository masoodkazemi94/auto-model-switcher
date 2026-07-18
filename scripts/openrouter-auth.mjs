#!/usr/bin/env node
import { createServer } from "node:http";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";

const destination = process.argv[2];
if (!destination) {
  console.error("Usage: openrouter-auth.mjs <secrets-file>");
  process.exit(2);
}

const base64Url = (buffer) => buffer.toString("base64url");
const verifier = base64Url(randomBytes(48));
const challenge = base64Url(createHash("sha256").update(verifier).digest());

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [url], { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

function runCurl(arguments_, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn("curl", arguments_, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(`curl failed (${code}): ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
    child.stdin.end(input);
  });
}

async function storeKey(key) {
  if (typeof key !== "string" || !key.startsWith("sk-or-")) {
    throw new Error("OpenRouter returned an invalid key");
  }
  const curlConfig = [
    'url = "https://openrouter.ai/api/v1/key"',
    `header = "Authorization: Bearer ${key.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
    "fail",
    "silent",
    "show-error",
  ].join("\n");
  await runCurl(["--config", "-"], curlConfig);

  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const escaped = key.replaceAll("'", "'\\''");
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, `OPENROUTER_API_KEY='${escaped}'\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, destination);
}

let settled = false;
let timeout;
const result = new Promise((resolve, reject) => {
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname !== "/callback") {
      response.writeHead(404).end("Not found");
      return;
    }
    const code = requestUrl.searchParams.get("code");
    const oauthError = requestUrl.searchParams.get("error");
    if (!code || oauthError) {
      response.writeHead(400, { "Content-Type": "text/plain" });
      response.end(`Authorization failed: ${oauthError ?? "missing code"}`);
      clearTimeout(timeout);
      settled = true;
      reject(new Error(oauthError ?? "OpenRouter returned no authorization code"));
      server.close();
      return;
    }

    try {
      const exchange = await runCurl(
        [
          "-fsS",
          "--connect-timeout", "15",
          "--max-time", "60",
          "-H", "Content-Type: application/json",
          "--data-binary", "@-",
          "https://openrouter.ai/api/v1/auth/keys",
        ],
        JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
      );
      const payload = JSON.parse(exchange);
      await storeKey(payload.key);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<h1>Auto Model Switcher connected</h1><p>You may close this tab.</p>");
      settled = true;
      resolve();
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(`Authorization failed: ${error.message}`);
      settled = true;
      reject(error);
    } finally {
      clearTimeout(timeout);
      server.close();
    }
  });

  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const callback = `http://127.0.0.1:${address.port}/callback`;
    const authorization = new URL("https://openrouter.ai/auth");
    authorization.searchParams.set("callback_url", callback);
    authorization.searchParams.set("code_challenge", challenge);
    authorization.searchParams.set("code_challenge_method", "S256");
    console.log("Authorize Auto Model Switcher in your browser:");
    console.log(authorization.toString());
    openBrowser(authorization.toString());
  });

  server.on("error", reject);
  timeout = setTimeout(() => {
    if (!settled) {
      settled = true;
      reject(new Error("Authorization timed out after 5 minutes"));
    }
    server.close();
  }, 300_000);
});

result.then(() => {
  console.log(`OpenRouter key stored securely in ${destination}`);
}).catch((error) => {
  console.error(`[auto-model-switcher] ${error.message}`);
  process.exitCode = 1;
});
