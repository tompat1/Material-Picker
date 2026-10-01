import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const ADMIN_EMAIL = "tremdia@gmail.com";

const SHOP_IDS = new Set([
  "hoodie-black",
  "hoodie-white",
  "sweat-black",
  "sweat-white",
  "tee-black",
  "tee-white",
  "cap",
  "beanie",
  "tote-black",
  "tote-white",
  "case",
  "print",
  "stickers",
]);

const SHOP_FIELDS = {
  name: 80,
  description: 400,
  badge: 32,
  stock: 48,
};

const IMAGE_PATH = /^\/(?:merch\/[a-z0-9.-]+\.(?:jpe?g|png|webp)|api\/cms\/media\/[a-z0-9-]{8,80})$/;

export function isAdminUser(user) {
  return String(user?.email || "").trim().toLowerCase() === ADMIN_EMAIL;
}

export function emptyContent() {
  return { copy: {}, shop: {} };
}

export function mergeContent(current, patch) {
  const next = {
    copy: { ...current.copy },
    shop: Object.fromEntries(Object.entries(current.shop).map(([id, fields]) => [id, { ...fields }])),
  };
  if (patch?.copy && typeof patch.copy === "object") {
    for (const [key, value] of Object.entries(patch.copy)) {
      if (!/^[a-z][a-z0-9.-]{0,40}$/.test(key)) throw badRequest("That text field is not editable.");
      if (value == null || value === "") {
        delete next.copy[key];
        continue;
      }
      const text = String(value).replace(/\s+/g, " ").trim();
      if (!text || text.length > 400) throw badRequest("Keep each line under 400 characters.");
      next.copy[key] = text;
    }
  }
  if (patch?.shop && typeof patch.shop === "object") {
    for (const [id, fields] of Object.entries(patch.shop)) {
      if (!SHOP_IDS.has(id) || !fields || typeof fields !== "object") throw badRequest("That shop piece is not in the catalog.");
      const item = { ...(next.shop[id] || {}) };
      for (const [field, limit] of Object.entries(SHOP_FIELDS)) {
        if (!(field in fields)) continue;
        if (fields[field] == null || fields[field] === "") {
          delete item[field];
          continue;
        }
        const text = String(fields[field]).replace(/\s+/g, " ").trim();
        if (!text || text.length > limit) throw badRequest(`Keep ${field} under ${limit} characters.`);
        item[field] = text;
      }
      if ("priceSek" in fields) item.priceSek = money(fields.priceSek, 100000);
      if ("priceEur" in fields) item.priceEur = money(fields.priceEur, 10000);
      if ("image" in fields) {
        const image = String(fields.image || "");
        if (!image) delete item.image;
        else if (!IMAGE_PATH.test(image)) throw badRequest("Shop images must be a catalog photo or an uploaded image.");
        else item.image = image;
      }
      if (Object.keys(item).length) next.shop[id] = item;
      else delete next.shop[id];
    }
  }
  return next;
}

export function createMemoryCmsStore() {
  let doc = emptyContent();
  const media = new Map();
  return {
    async read() {
      return structuredClone(doc);
    },
    async write(next) {
      doc = structuredClone(next);
    },
    async putMedia(id, mime, bytes) {
      media.set(id, { mime, bytes });
    },
    async getMedia(id) {
      return media.get(id) || null;
    },
  };
}

export function createFileCmsStore(directory) {
  const filePath = path.join(directory, "cms.json");
  const mediaDir = path.join(directory, "cms-media");
  let queue = Promise.resolve();
  const update = (mutator) => {
    const run = queue.then(async () => {
      const current = await readFileContent(filePath);
      const result = await mutator(current);
      await mkdir(directory, { recursive: true });
      await writeFile(filePath, JSON.stringify(current));
      return result;
    });
    queue = run.then(() => {}, () => {});
    return run;
  };
  return {
    async read() {
      return readFileContent(filePath);
    },
    async write(next) {
      await update((current) => {
        current.copy = next.copy;
        current.shop = next.shop;
      });
    },
    async putMedia(id, mime, bytes) {
      await mkdir(mediaDir, { recursive: true });
      const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
      await writeFile(path.join(mediaDir, `${id}.${ext}`), bytes);
      await writeFile(path.join(mediaDir, `${id}.mime`), mime);
    },
    async getMedia(id) {
      if (!/^[a-z0-9-]{8,80}$/.test(id)) return null;
      for (const ext of ["jpg", "png", "webp"]) {
        try {
          const bytes = await readFile(path.join(mediaDir, `${id}.${ext}`));
          const mime = await readFile(path.join(mediaDir, `${id}.mime`), "utf8").catch(() => "");
          return { mime: mime || (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg"), bytes };
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
      return null;
    },
  };
}

export function createD1CmsStore(db) {
  return {
    async read() {
      try {
        const row = await db.prepare("SELECT body FROM cms_documents WHERE id = 'site'").first();
        return parseContent(row?.body);
      } catch {
        return emptyContent();
      }
    },
    async write(next) {
      await db.prepare("INSERT INTO cms_documents (id, body) VALUES ('site', ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body")
        .bind(JSON.stringify(next))
        .run();
    },
    async putMedia(id, mime, bytes) {
      await db.prepare("INSERT INTO cms_media (id, mime, bytes) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes")
        .bind(id, mime, bytes)
        .run();
    },
    async getMedia(id) {
      const row = await db.prepare("SELECT mime, bytes FROM cms_media WHERE id = ?").bind(id).first();
      if (!row?.bytes) return null;
      return { mime: row.mime || "image/jpeg", bytes: row.bytes };
    },
  };
}

export async function handleCmsRequest(request, { store, user } = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/cms")) return null;
  if (!store) return json(503, { error: "Content storage is not connected." });
  const mediaId = url.pathname.match(/^\/api\/cms\/media\/([a-z0-9-]{8,80})$/)?.[1];
  if (request.method === "GET" && mediaId) {
    const media = await store.getMedia(mediaId);
    if (!media) return json(404, { error: "That image is gone." });
    return new Response(media.bytes, {
      headers: { "content-type": media.mime, "cache-control": "public, max-age=3600" },
    });
  }
  if (request.method === "GET" && url.pathname === "/api/cms") {
    return json(200, await store.read());
  }
  if (!isAdminUser(user)) return json(403, { error: "Only the admin Google account can edit the site." });
  try {
    if (request.method === "PUT" && url.pathname === "/api/cms") {
      const patch = await request.json().catch(() => null);
      if (!patch || typeof patch !== "object") return json(400, { error: "Send the text or shop fields to save." });
      const next = mergeContent(await store.read(), patch);
      await store.write(next);
      return json(200, next);
    }
    if (request.method === "POST" && url.pathname === "/api/cms/media") {
      const mime = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!/^image\/(jpeg|png|webp)$/.test(mime)) return json(400, { error: "Use a JPEG, PNG, or WebP image." });
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > 1_500_000) return json(400, { error: "Keep the image under 1.5 MB." });
      const id = crypto.randomUUID();
      await store.putMedia(id, mime, bytes);
      return json(200, { url: `/api/cms/media/${id}` });
    }
  } catch (error) {
    return json(error.status || 500, { error: error.message || "The edit could not be saved." });
  }
  return json(404, { error: "Unknown content route." });
}

function money(value, max) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 0 || amount > max) throw badRequest("Use a whole price.");
  return amount;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function parseContent(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return emptyContent();
    return {
      copy: parsed.copy && typeof parsed.copy === "object" ? parsed.copy : {},
      shop: parsed.shop && typeof parsed.shop === "object" ? parsed.shop : {},
    };
  } catch {
    return emptyContent();
  }
}

async function readFileContent(filePath) {
  try {
    return parseContent(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return emptyContent();
  }
}

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
