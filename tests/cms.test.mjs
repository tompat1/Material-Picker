import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryAccountStore, handleAuthRequest } from "../auth.mjs";
import { ADMIN_EMAIL, createD1CmsStore, createMemoryCmsStore, handleCmsRequest, isAdminUser } from "../cms.mjs";

test("only the admin Google account can edit", () => {
  assert.equal(ADMIN_EMAIL, "tremdia@gmail.com");
  assert.equal(isAdminUser({ email: "Tremdia@gmail.com" }), true);
  assert.equal(isAdminUser({ email: "ada@example.com" }), false);
  assert.equal(isAdminUser(null), false);
});

test("the admin Google session is marked on the account payload", async () => {
  const store = createMemoryAccountStore();
  const start = await handleAuthRequest(new Request("http://localhost:4173/api/auth/google/start"), {
    store,
    clientId: "client",
    clientSecret: "secret",
  });
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
          return new Response(JSON.stringify({ sub: "google-thomas", email: "tremdia@gmail.com", name: "Thomas" }));
        }
        return new Response(JSON.stringify({ items: [] }));
      },
    },
  );
  const session = callback.headers.getSetCookie().find((item) => item.startsWith("picker_session="));
  const sessionId = decodeURIComponent(session.split(";")[0].slice("picker_session=".length));
  const me = await handleAuthRequest(new Request("http://localhost:4173/api/auth/me", {
    headers: { cookie: `picker_session=${sessionId}` },
  }), { store, clientId: "client", clientSecret: "secret" });
  assert.equal((await me.json()).user.admin, true);
});

test("shop text and images save for the admin and stay hidden from everyone else", async () => {
  const store = createMemoryCmsStore();
  const guest = await handleCmsRequest(new Request("http://localhost:4173/api/cms", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ copy: { "shop.title": "Taken" } }),
  }), { store, user: { email: "ada@example.com" } });
  assert.equal(guest.status, 403);

  const saved = await handleCmsRequest(new Request("http://localhost:4173/api/cms", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      copy: { "shop.title": "Wear this." },
      shop: { cap: { name: "Field cap", priceSek: 340, image: "/merch/cap.jpg" } },
    }),
  }), { store, user: { email: "tremdia@gmail.com" } });
  assert.equal(saved.status, 200);
  const body = await saved.json();
  assert.equal(body.copy["shop.title"], "Wear this.");
  assert.equal(body.shop.cap.name, "Field cap");
  assert.equal(body.shop.cap.priceSek, 340);

  const rejected = await handleCmsRequest(new Request("http://localhost:4173/api/cms", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ shop: { cap: { image: "https://evil.example/cap.jpg" } } }),
  }), { store, user: { email: "tremdia@gmail.com" } });
  assert.equal(rejected.status, 400);

  const bytes = new Uint8Array([1, 2, 3, 4]);
  const upload = await handleCmsRequest(new Request("http://localhost:4173/api/cms/media", {
    method: "POST",
    headers: { "content-type": "image/jpeg" },
    body: bytes,
  }), { store, user: { email: "tremdia@gmail.com" } });
  const uploaded = await upload.json();
  assert.match(uploaded.url, /^\/api\/cms\/media\//);
  const media = await handleCmsRequest(new Request(`http://localhost:4173${uploaded.url}`), { store });
  assert.equal(media.headers.get("content-type"), "image/jpeg");
  assert.equal((await media.arrayBuffer()).byteLength, 4);

  const replacement = await handleCmsRequest(new Request("http://localhost:4173/api/cms", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      shop: { cap: { image: uploaded.url, imageZoom: 1.75, imageX: 28, imageY: 64 } },
    }),
  }), { store, user: { email: "tremdia@gmail.com" } });
  assert.equal(replacement.status, 200);
  const savedReplacement = await replacement.json();
  assert.equal(savedReplacement.shop.cap.image, uploaded.url);
  assert.equal(savedReplacement.shop.cap.imageZoom, 1.75);
  assert.equal(savedReplacement.shop.cap.imageX, 28);
  assert.equal(savedReplacement.shop.cap.imageY, 64);
  const reloaded = await handleCmsRequest(new Request("http://localhost:4173/api/cms"), { store });
  const persisted = await reloaded.json();
  assert.equal(persisted.shop.cap.image, uploaded.url);
  assert.equal(persisted.shop.cap.imageZoom, 1.75);
  assert.equal(persisted.shop.cap.imageX, 28);
  assert.equal(persisted.shop.cap.imageY, 64);

  const invalidCrop = await handleCmsRequest(new Request("http://localhost:4173/api/cms", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ shop: { cap: { imageZoom: 4 } } }),
  }), { store, user: { email: "tremdia@gmail.com" } });
  assert.equal(invalidCrop.status, 400);
});

test("the D1 CMS adapter binds image bytes as an ArrayBuffer and restores returned blobs", async () => {
  let insertValues = null;
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          if (sql.startsWith("INSERT INTO cms_media")) insertValues = values;
          return {
            async run() {},
            async first() {
              return { mime: "image/png", bytes: [1, 2, 3, 4] };
            },
          };
        },
      };
    },
  };
  const store = createD1CmsStore(db);
  await store.putMedia("image-test", "image/png", new Uint8Array([1, 2, 3, 4]));
  assert.equal(insertValues[0], "image-test");
  assert.equal(insertValues[1], "image/png");
  assert.ok(insertValues[2] instanceof ArrayBuffer);
  assert.deepEqual(Array.from(new Uint8Array(insertValues[2])), [1, 2, 3, 4]);

  const media = await store.getMedia("image-test");
  assert.equal(media.mime, "image/png");
  assert.ok(media.bytes instanceof Uint8Array);
  assert.deepEqual(Array.from(media.bytes), [1, 2, 3, 4]);
});
