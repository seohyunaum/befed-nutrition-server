import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "./app.mjs";

async function withServer(options, run) {
  const server = createApp(options).listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
function geminiResponse(data) {
  return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(data) }] } }] });
}
function photo(type = "image/jpeg", size = 4) {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(size)], { type }), "meal.jpg");
  return form;
}
test("forwards the image with a server-only key and preserves zero macros", async () => {
  await withServer({ apiKey: "test-secret", fetchImpl: async (url, options) => {
    assert.match(url, /gemini-3\.1-flash-lite:generateContent$/);
    assert.equal(options.headers["x-goog-api-key"], "test-secret");
    const request = JSON.parse(options.body);
    const image = request.contents[0].parts[1].inlineData;
    assert.equal(image.mimeType, "image/jpeg");
    assert.equal(Buffer.from(image.data, "base64").length, 4);
    assert.equal(request.generationConfig.responseMimeType, "application/json");
    return geminiResponse({ recognizable: true, reason: "none", calories: 123.5, protein_g: 0 });
  } }, async (url) => {
    const response = await fetch(`${url}/nutrition`, { method: "POST", body: photo() });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { calories: 123.5, protein: 0 });
  });
});
test("rejects unsupported and oversized images before contacting Gemini", async () => {
  await withServer({ apiKey: "test", fetchImpl: () => { throw new Error("Must not call provider"); } }, async (url) => {
    for (const [body, status] of [[photo("image/heic"), 400], [photo("image/jpeg", 5 * 1024 * 1024 + 1), 413]]) {
      const response = await fetch(`${url}/nutrition`, { method: "POST", body });
      assert.equal(response.status, status);
    }
  });
});
test("missing key returns actionable setup error", async () => {
  await withServer({}, async (url) => {
    const response = await fetch(`${url}/nutrition`, { method: "POST", body: photo() });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /server\/\.env.local/);
  });
});
test("rejects incomplete and invalid nutrition instead of guessing", async () => {
  for (const data of [{ recognizable: true, reason: "none", calories: 10 }, { recognizable: true, reason: "none", calories: -1, protein_g: 2 }, { recognizable: true, reason: "none", calories: "10", protein_g: 2 }, null]) {
    await withServer({ apiKey: "test", fetchImpl: async () => geminiResponse(data) }, async (url) => {
      const response = await fetch(`${url}/nutrition`, { method: "POST", body: photo() });
      assert.equal(response.status, 502);
    });
  }
});
test("quota and unrecognized-food errors remain actionable", async () => {
  for (const status of [402, 422, 429]) {
    await withServer({ apiKey: "test", fetchImpl: async () => new Response("", { status }) }, async (url) => {
      const response = await fetch(`${url}/nutrition`, { method: "POST", body: photo() });
      assert.equal(response.status, status);
      assert.equal(typeof (await response.json()).error, "string");
    });
  }
});

test("unrecognizable photos do not populate nutrition", async () => {
  await withServer({ apiKey: "test", fetchImpl: async () => geminiResponse({ recognizable: false, reason: "no_food_or_beverage", calories: null, protein_g: null }) }, async (url) => {
    const response = await fetch(`${url}/nutrition`, { method: "POST", body: photo() });
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /does not appear to contain food or a beverage/);
  });
});
test("blocked, truncated and malformed model output is rejected", async () => {
  for (const envelope of [{ promptFeedback: { blockReason: "SAFETY" } }, { candidates: [{ finishReason: "MAX_TOKENS" }] }, { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "invalid JSON" }] } }] }]) {
    await withServer({ apiKey: "test", fetchImpl: async () => Response.json(envelope) }, async (url) => {
      const response = await fetch(`${url}/nutrition`, { method: "POST", body: photo() });
      assert.ok([422, 502].includes(response.status));
    });
  }
});

test("unclear photos show a distinct message", async () => {
  await withServer({ apiKey: "test", fetchImpl: async () => geminiResponse({ recognizable: false, reason: "unclear_photo", calories: null, protein_g: null }) }, async (url) => {
    const response = await fetch(`${url}/nutrition`, { method: "POST", body: photo() });
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /too unclear/);
  });
});
