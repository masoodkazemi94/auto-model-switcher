import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const serverScript = process.argv[2];
if (!serverScript) throw new Error("Pass the path to FreeRouter dist/src/server.js");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function waitForHealth(url, child, output) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`FreeRouter exited with ${child.exitCode}: ${output.join("")}`);
    }
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("FreeRouter did not become healthy");
}

let receivedBody;
const receivedModels = [];
const upstream = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  receivedModels.push(receivedBody.model);
  if (receivedBody.model === "vendor/failing-model:free") {
    response.writeHead(503, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: { message: "free endpoint saturated" } }));
    return;
  }
  if (receivedBody.model === "vendor/account-limited:free") {
    response.writeHead(429, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      error: { message: "Rate limit exceeded: free-models-per-day" },
    }));
    return;
  }
  response.writeHead(200, { "Content-Type": "text/event-stream" });
  response.write(`data: ${JSON.stringify({
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          id: "call_1",
          type: "function",
          function: { name: "read_file", arguments: '{"path":"README.md"}' },
        }],
      },
      finish_reason: "tool_calls",
    }],
  })}\n\n`);
  response.end("data: [DONE]\n\n");
});

const upstreamPort = await listen(upstream);
const routerPort = await freePort();
const directory = await mkdtemp(join(tmpdir(), "ams-freerouter-integration-"));
const mapping = {
  primary: "openrouter/vendor/code-model:free",
  fallback: [],
};
const configPath = join(directory, "config.json");
await writeFile(configPath, JSON.stringify({
  port: routerPort,
  host: "127.0.0.1",
  providers: {
    openrouter: {
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      api: "openai",
      auth: { type: "env", key: "OPENROUTER_API_KEY" },
    },
  },
  tiers: { SIMPLE: mapping, MEDIUM: mapping, COMPLEX: mapping, REASONING: mapping },
  auth: { default: "environment" },
}));

const child = spawn(process.execPath, [serverScript], {
  env: {
    ...process.env,
    FREEROUTER_CONFIG: configPath,
    OPENROUTER_API_KEY: "test-key",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const childOutput = [];
child.stdout.on("data", (chunk) => childOutput.push(chunk.toString()));
child.stderr.on("data", (chunk) => childOutput.push(chunk.toString()));

try {
  const endpoint = `http://127.0.0.1:${routerPort}`;
  await waitForHealth(endpoint, child, childOutput);
  const upstreamHealth = await fetch(`${endpoint}/upstream-health`);
  assert.equal(upstreamHealth.status, 200, await upstreamHealth.text());
  const automaticResponse = await fetch(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "automatic",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    }),
  });
  assert.equal(automaticResponse.status, 200);
  await automaticResponse.text();
  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "tier/reasoning",
      messages: [{ role: "user", content: "Read the README" }],
      stream: true,
      tools: [{
        type: "function",
        function: {
          name: "read_file",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      }],
      tool_choice: "auto",
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-clawrouter-tier"), "REASONING");
  assert.match(await response.text(), /read_file/);
  assert.equal(receivedBody.model, "vendor/code-model:free");
  assert.equal(receivedBody.tools[0].function.name, "read_file");
  assert.equal(receivedBody.tool_choice, "auto");

  const directResponse = await fetch(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openrouter/vendor/failing-model:free",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    }),
  });
  const directBody = await directResponse.text();
  assert.equal(directResponse.status, 200, directBody);
  assert.equal(directResponse.headers.get("x-clawrouter-model"), "openrouter/vendor/code-model:free");
  assert.notEqual(directResponse.headers.get("x-clawrouter-tier"), "EXPLICIT");
  assert.match(directBody, /read_file/);
  assert.deepEqual(receivedModels.slice(-2), [
    "vendor/failing-model:free",
    "vendor/code-model:free",
  ]);

  const requestsBeforeLimit = receivedModels.length;
  const limitedResponse = await fetch(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "openrouter/vendor/account-limited:free",
      messages: [{ role: "user", content: "Hello" }],
      stream: true,
    }),
  });
  assert.equal(limitedResponse.status, 429);
  assert.match(await limitedResponse.text(), /free-models-per-day/);
  assert.deepEqual(receivedModels.slice(requestsBeforeLimit), ["vendor/account-limited:free"]);
  console.log("FreeRouter routing, tools, and direct-model fallback integration passed");
} finally {
  child.kill("SIGTERM");
  await close(upstream);
}
