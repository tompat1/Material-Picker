import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export function createFileAccountStore(filePath) {
  let queue = Promise.resolve();
  const update = (mutator) => {
    const run = queue.then(async () => {
      const data = await readStore(filePath);
      const result = await mutator(data);
      await writeStore(filePath, data);
      return result;
    });
    queue = run.then(() => {}, () => {});
    return run;
  };

  return {
    async putState(id, expiresAt) {
      await update((data) => {
        data.states = data.states.filter((item) => item.id !== id);
        data.states.push({ id, expiresAt });
      });
    },
    async takeState(id) {
      return update((data) => {
        const state = data.states.find((item) => item.id === id);
        data.states = data.states.filter((item) => item.id !== id);
        return Boolean(state && Date.parse(state.expiresAt) > Date.now());
      });
    },
    async upsertGoogleUser(profile, tokenSet) {
      return update((data) => {
        const googleSub = String(profile.sub || "");
        if (!googleSub) throw new Error("Google did not return an account id.");
        const email = String(profile.email || "").trim().toLowerCase();
        let user = data.users.find((item) => item.googleSub === googleSub);
        if (!user && email) {
          user = data.users.find((item) => item.email === email);
          if (user) user.googleSub = googleSub;
        }
        if (!user) {
          user = {
            id: crypto.randomUUID(),
            googleSub,
            email,
            name: profile.name || "",
            picture: profile.picture || "",
            createdAt: new Date().toISOString(),
          };
          data.users.push(user);
        } else {
          user.email = email || user.email;
          user.name = profile.name || user.name;
          user.picture = profile.picture || user.picture;
        }
        const current = data.tokens.find((item) => item.userId === user.id);
        const next = {
          userId: user.id,
          refreshToken: tokenSet.refreshToken || current?.refreshToken || "",
          accessToken: tokenSet.accessToken || "",
          accessExpiresAt: tokenSet.accessExpiresAt || "",
        };
        data.tokens = data.tokens.filter((item) => item.userId !== user.id);
        data.tokens.push(next);
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          picture: user.picture,
          youtubeConnected: Boolean(next.refreshToken),
        };
      });
    },
    async passwordUserByEmail(email) {
      return update((data) => {
        const user = data.users.find((item) => item.email === email && item.passwordHash);
        if (!user) return null;
        const token = data.tokens.find((item) => item.userId === user.id);
        return {
          id: user.id,
          email: user.email || "",
          name: user.name || "",
          picture: user.picture || "",
          youtubeConnected: Boolean(token?.refreshToken),
          passwordHash: user.passwordHash,
        };
      });
    },
    async createPasswordUser({ email, name, passwordHash }) {
      return update((data) => {
        if (data.users.some((item) => item.email === email)) {
          const error = new Error("An account with that email already exists.");
          error.status = 409;
          throw error;
        }
        const user = {
          id: crypto.randomUUID(),
          googleSub: "",
          email,
          name,
          picture: "",
          passwordHash,
          createdAt: new Date().toISOString(),
        };
        data.users.push(user);
        return { id: user.id, email, name, picture: "", youtubeConnected: false };
      });
    },
    async createSession(userId) {
      return update((data) => {
        const id = crypto.randomUUID();
        data.sessions.push({ id, userId, expiresAt: new Date(Date.now() + SESSION_MS).toISOString() });
        return id;
      });
    },
    async userForSession(sessionId) {
      return update((data) => {
        const session = data.sessions.find((item) => item.id === sessionId);
        if (!session || Date.parse(session.expiresAt) <= Date.now()) return null;
        const user = data.users.find((item) => item.id === session.userId);
        if (!user) return null;
        const token = data.tokens.find((item) => item.userId === user.id);
        return {
          id: user.id,
          email: user.email || "",
          name: user.name || "",
          picture: user.picture || "",
          youtubeConnected: Boolean(token?.refreshToken),
        };
      });
    },
    async deleteSession(sessionId) {
      await update((data) => {
        data.sessions = data.sessions.filter((item) => item.id !== sessionId);
      });
    },
    async tokensForUser(userId) {
      return update((data) => data.tokens.find((item) => item.userId === userId) || null);
    },
    async saveTokens(userId, tokenSet) {
      await update((data) => {
        const current = data.tokens.find((item) => item.userId === userId);
        data.tokens = data.tokens.filter((item) => item.userId !== userId);
        data.tokens.push({
          userId,
          refreshToken: tokenSet.refreshToken || current?.refreshToken || "",
          accessToken: tokenSet.accessToken || "",
          accessExpiresAt: tokenSet.accessExpiresAt || "",
          subscriptions: current?.subscriptions || null,
        });
      });
    },
    async saveSubscriptions(userId, subscriptions) {
      await update((data) => {
        const current = data.tokens.find((item) => item.userId === userId) || { userId };
        data.tokens = data.tokens.filter((item) => item.userId !== userId);
        data.tokens.push({ ...current, subscriptions });
      });
    },
    async subscriptionsForUser(userId) {
      return update((data) => data.tokens.find((item) => item.userId === userId)?.subscriptions || null);
    },
  };
}

async function readStore(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { users: [], sessions: [], states: [], tokens: [] };
  }
}

async function writeStore(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data));
}
