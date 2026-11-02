import assert from "node:assert/strict";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the Poké Binder experience and metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Poké Binder \| Pokémon Card Tracker<\/title>/i);
  assert.match(html, /Poké Binder/);
  assert.match(html, /Trainer’s National Pokédex/);
  assert.match(html, /Available printings/);
  assert.match(html, /Checking cloud save/);
  assert.match(html, /Mega Evolutions, regional forms, paired cards and every named version grouped under its base Pokémon/);
  assert.match(html, /og\.png/);
  assert.doesNotMatch(html, /codex-preview|Starter Project|Your site is taking shape/i);
});
