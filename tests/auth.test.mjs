import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryAccountStore, googleAuthUrl, handleAuthRequest, parseYouTubeSubscriptions } from "../auth.mjs";

test("google sign-in asks for offline YouTube read access", () => {
  const url = new URL(googleAuthUrl({
    clientId: "client",
    redirectUri: "http://localhost:4173/api/auth/google/callback",
    state: "state-1",
  }));
  assert.equal(url.origin, "https://accounts.google.com");
  assert.match(url.searchParams.get("scope"), /youtube\.readonly/);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("state"), "state-1");
});

test("subscription payloads keep channel id and title", () => {
  const channels = parseYouTubeSubscriptions({
    items: [
      { snippet: { title: "Studio North", resourceId: { channelId: "UC123" }, thumbnails: { default: { url: "https://img.example/a.jpg" } } } },
      { snippet: { title: "", resourceId: { channelId: "UC000" } } },
    ],
  });
  assert.equal(channels.length, 1);
  assert.equal(channels[0].id, "UC123");
  assert.equal(channels[0].title, "Studio North");
});

test("email accounts can be created and signed in without Google", async () => {
  const store = createMemoryAccountStore();
  const register = await handleAuthRequest(new Request("http://localhost:4173/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Ada", email: "ada@example.com", password: "long-enough" }),
  }), { store });
  assert.equal(register.status, 200);
  const session = register.headers.getSetCookie().find((item) => item.startsWith("picker_session="));
  const sessionId = decodeURIComponent(session.split(";")[0].slice("picker_session=".length));
  const me = await handleAuthRequest(new Request("http://localhost:4173/api/auth/me", {
    headers: { cookie: `picker_session=${sessionId}` },
  }), { store });
  assert.equal((await me.json()).user.email, "ada@example.com");
  const again = await handleAuthRequest(new Request("http://localhost:4173/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.com", password: "wrong-password" }),
  }), { store });
  assert.equal(again.status, 401);
});

test("google callback creates a session and marks YouTube connected", async () => {
  const store = createMemoryAccountStore();
  const start = await handleAuthRequest(new Request("http://localhost:4173/api/auth/google/start"), {
    store,
    clientId: "client",
    clientSecret: "secret",
    fetchImpl: async () => {
      throw new Error("start should not fetch");
    },
  });
  assert.equal(start.status, 302);
  const stateCookie = start.headers.getSetCookie().find((item) => item.startsWith("picker_oauth_state="));
  const state = decodeURIComponent(stateCookie.split(";")[0].slice("picker_oauth_state=".length));
  const callback = await handleAuthRequest(
    new Request(`http://localhost:4173/api/auth/google/callback?code=abc&state=${state}`, {
      headers: { cookie: `picker_oauth_state=${state}` },
    }),
    {
      store,
      clientId: "client",
      clientSecret: "secret",
      fetchImpl: async (url) => {
        if (String(url).includes("oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }));
        }
        if (String(url).includes("userinfo")) {
          return new Response(JSON.stringify({ sub: "google-1", email: "ada@example.com", name: "Ada" }));
        }
        throw new Error(`Unexpected fetch ${url}`);
      },
    },
  );
  assert.equal(callback.status, 302);
  const session = callback.headers.getSetCookie().find((item) => item.startsWith("picker_session="));
  const sessionId = decodeURIComponent(session.split(";")[0].slice("picker_session=".length));
  const me = await handleAuthRequest(new Request("http://localhost:4173/api/auth/me", {
    headers: { cookie: `picker_session=${sessionId}` },
  }), { store, clientId: "client", clientSecret: "secret" });
  const body = await me.json();
  assert.equal(body.user.email, "ada@example.com");
  assert.equal(body.user.youtubeConnected, true);
});
