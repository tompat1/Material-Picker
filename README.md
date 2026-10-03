# Material Picker

A local-first video material workspace for collecting videos from a page URL, saving authorized media to disk, watching offline in a built-in player, and managing transcripts, translations, and proofread text.

## Run

Install dependencies and start the included server:

```sh
npm install
npm run dev
```

Then open `http://localhost:4173`. Use `npm run dev` while editing so `public/` assets are served with `no-store` caching and the server restarts when `server.js` or shared modules change.

`npm start` runs the same server in production cache mode. `npm run build` runs tests and a Wrangler dry-run (compile check before deploy). `npm run deploy` runs the build, then publishes to Cloudflare.

**Note:** `https://picker.rynell.org` only updates after `npm run deploy`. Local changes are not visible there until you deploy.

For another phone or tablet on the same network, open `http://YOUR-COMPUTER-IP:4173` while the server is running.

## Accounts and YouTube

Sign-in is Google OAuth. The same consent also requests read-only YouTube access so subscriptions can be synced later. Sessions stay in an HttpOnly cookie. Refresh tokens stay on the server (`data/accounts.json` locally, D1 in production), not in the browser library.

1. In Google Cloud, enable the YouTube Data API and create an OAuth client (Web). Add the redirect URIs in `.env.example`.
2. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` for `npm run dev`, and as Worker secrets for production (`wrangler secret put`).
3. Create the account database and apply `migrations/0001_accounts.sql`:

```sh
npx wrangler d1 create picker-accounts
```

Add the printed `database_id` to `wrangler.jsonc` as an `AUTH` D1 binding, then:

```sh
npx wrangler d1 migrations apply picker-accounts --remote
```

Until those secrets and the database exist, the header still shows **Sign in** and `/api/auth/me` reports that Google is not configured. Favourites, likes, and offline files remain in this browser until a later step copies them onto the account.

## Cloudflare Deployment

The repository includes `wrangler.jsonc`. It deploys the browser files in `public/` plus a page-scan relay at `/api/scrape`. Run:

```sh
npm run deploy
```

For a connected Cloudflare Workers Build, leave the build command empty and use `npx wrangler deploy` as the deploy command. The explicit asset directory prevents `node_modules`, tests, server code, and local video archives from being uploaded as static assets.

The Cloudflare deployment scans pages through its own relay, and provider playback, browser storage, notes, folders, and transcript editing stay in the browser. Server translation, server transcription, and disk-backed offline copies still require the local Node server, because Workers cannot write to this computer's `data/videos` directory. Run `npm start` when those local features are needed.

## What It Does

- Scans a user-provided page URL for video URLs, embeds, iframes, HLS streams, and direct media links. A guarded same-origin relay handles sites that block browser CORS access.
- Shows the source page in an iframe when the source allows it.
- Stores the video library, notes, tags, transcripts, and translations in browser `localStorage`.
- Saves authorized direct video files and public unencrypted HLS media under `data/videos/<video-id>` for true offline playback. The player always prefers the disk copy when one exists.
- Keeps a browser-local history of the last 100 page scans, including timestamps and found/added counts.
- Organizes saved videos into persistent folders with All Videos and Unfiled views.
- Supports multi-select, bulk folder moves, folder rename, and folder deletion without deleting videos.
- Plays direct video files, YouTube, Vimeo, and Wistia embeds, plus HLS through native playback or HLS.js compatibility playback.
- Checks every saved item and labels it as ready, blocked, or needing a manual playback check.
- Lets users paste page source HTML, embed code, or one video URL per line when a site blocks direct browser scanning.
- Loads public Vimeo WebVTT caption tracks directly as timed transcripts, with browser Speech Recognition as a microphone fallback.
- Uses the browser Translator API when available and a server translation fallback otherwise; local proofreading cleanup remains available.
- Exports video notes and transcript text as `.txt`.

## Offline Storage

In the Library, mark individual videos or choose **Mark all**, confirm that you have permission to download the marked videos, and choose **Save marked offline**. The app saves the queue sequentially and changes each card from Saving to Offline. You can also save one selected video from its player panel. Direct files are copied as video files. Public unencrypted HLS streams, including publicly exposed Vimeo HLS, are stored as local manifests and media segments. The Offline copy panel shows progress, size, and the absolute disk archive path.

Use **Choose folder** before saving to place an additional complete copy in a folder you select. Existing offline videos can also be marked and copied there without downloading them again. The app streams each file into the selected folder, preserves HLS manifests and segment folders, and keeps its internal `data/videos` copy for built-in playback. Folder selection uses the browser File System Access API and is currently available in supporting desktop browsers on localhost or HTTPS. Other browsers continue to use Material Picker storage.

Material Picker deliberately refuses encrypted or DRM-protected HLS, signed-in media, and provider pages that do not expose downloadable media. It does not bypass paywalls, account access, or provider download restrictions.

The `data/videos` directory is ignored by Git because it may contain large copyrighted media. Removing a copy in the app deletes its disk folder but keeps the video record, notes, and transcript.

## Browser Limits

The included server relays HTML for extraction and stores permitted media bytes for offline playback. It does not bypass provider access controls.

- Sites can still deny automated page requests. Use the paste extractor in that case.
- Some pages block iframe previews with security headers.
- Remote HLS playback needs cross-origin access, while a completed offline HLS copy is served locally. Expired, DRM-protected, signed-in, or domain-restricted streams cannot be bypassed by this app.
- Browser speech recognition listens through the microphone. It cannot reliably capture protected video audio directly.
- Built-in translation depends on browser support for the experimental Translator API. Without it, the app keeps the text local and prepares a translation draft.

## Tests

Run the dependency-free test suite with:

```sh
npm test
```

The tests cover the real 10-item Day 2 summit playlist structure, title and URL extraction, Vimeo embed generation, duplicate removal, unsupported links, scrape-history migration, and browser-storage round trips.

To verify that all 10 example-page Vimeo players currently expose selectable, public, unencrypted HLS sources, and that YouTube search and an RSS feed return usable results, run `npm run test:live`. This check requires an internet connection and is kept separate from the deterministic test suite. The local suite also checks global search, account login/logout, and adding and removing synced RSS feeds.
