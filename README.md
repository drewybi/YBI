# YBI Proofs — artwork approval app

A small, YBI-branded proofing tool for YBI Creative. The studio uploads a proof, sends the client a link, and the client either **approves** it or **requests changes**. They can add a note and attach files. The studio then uploads V2, V3 and so on, and the same client link always shows the newest version.

- **No client accounts.** Each job has its own page at `/proof/{jobNumber}` (e.g. `/proof/30434`), plus an optional secure `?k=` link.
- **Studio** is protected by one password.
- **No build step, no framework, no database.** It runs on Node ≥ 18 and keeps everything in plain files under `data/`.
- **Brand** comes from the ybicreative.com.au site build (`/workspace/ybi-site/dist`): the Archivo (wide) and Work Sans fonts, the white YBI logo, the near-black `#09090a` / off-white `#f3f1ec` palette with the single `#A7A9AC` (35% black) accent, outline display headings, pill buttons, and the engine/workshop hero imagery.

## URLs

The app is mounted at **`/proof`** by default (`BASE_PATH`). Each job's page is its **job number**.

| Who | URL | What |
|---|---|---|
| Everyone | `/proof` | Entry page: a client types a job number to find their proof; the studio password box is next to it |
| Client | **`/proof/30434`** | Review page for job 30434 (view, approve, request changes and attach files) |
| Client (secure) | `/proof/30434?k=<token>` | Same page, using the job's private token. **Email client** uses this link. |
| Studio | `/proof/studio` | Dashboard (redirects to `/proof` to log in) |
| Studio | `/proof/studio/30434` | Admin page for job 30434: links, versions, client feedback, upload a new version |
| Studio | `/proof/studio/settings` | Notification email and logout |
| Files | `/proof/30434/file/v2`, `/proof/30434/file/a<id>` | Proof version / client attachment (same access rules as the page) |
| Legacy | `/p/<token>` | Redirects to `/proof/{jobNumber}?k=<token>` |

`/` redirects to `/proof`. The server accepts requests **with or without** the `/proof` prefix, so a reverse proxy can either keep or strip it. Set `BASE_PATH=` (empty) to mount the app at the root instead, for example on a `proofs.` subdomain.

## Run it

```bash
cd ybi-approval
node server.js                 # zero dependencies needed
# → http://localhost:4321/proof        studio password: ybi-proof
```

Production-style:

```bash
STUDIO_PASSWORD='something-long' PORT=8080 \
PUBLIC_URL='https://www.ybicreative.com.au' BASE_PATH=/proof node server.js
```

| Env | Default | Meaning |
|---|---|---|
| `PORT` | `4321` | Port to listen on |
| `BASE_PATH` | `/proof` | Path prefix the app lives under (`''` = root) |
| `PUBLIC_URL` | *(request host)* | **Origin only** (no path) used to build client links, e.g. `https://www.ybicreative.com.au`. `X-Forwarded-Host/Proto` are honoured if it isn't set. |
| `STUDIO_PASSWORD` | `ybi-proof` | Studio password. **Change it before going online.** |
| `DEFAULT_ACCESS` | `public` | `public`: `/proof/{jobNumber}` works for anyone. `private`: new jobs need the secure `?k=` link. Each job can be switched in the studio. |
| `SMTP_*`, `NOTIFY_EMAIL` | — | Email alerts (see below) |

## Job numbers

- The job number **is** the URL: `30434` → `/proof/30434`. Allowed characters are letters, numbers, `-`, `_` and `.` (no spaces, max 40). Matching is case-insensitive.
- **Job numbers must be unique.** Creating a job with a number that already exists is **refused** (HTTP 409, *"Job 30434 already exists — open it and upload a new version instead."*) and the studio shows an "Open it" link. This prevents one client's proof from silently replacing another's. To revise a job, open it and use **Upload new version**.
- Reserved words that can't be used as job numbers: `studio`, `api`, `assets`, `vendor`, `f`, `p`, `settings`, `login`, `logout`.

## Studio (YBI side)

| What | Where |
|---|---|
| Login + dashboard | `http://localhost:4321/proof` → `/proof/studio` |
| Default password | **`ybi-proof`** (change it with `STUDIO_PASSWORD`) |
| One-click login link | `/proof/studio?key=<password>` sets a 90-day cookie. Bookmark it on studio machines. |
| Scripts/API | send the header `X-Studio-Key: <password>`. Jobs can be addressed by number: `/proof/api/jobs/30434` |

1. Click **+ New proof**. Enter the job number (this becomes the link), client name, business, email and description, then drop in a PDF (single or multi-page), JPG or PNG. Click **Create & get link**.
2. On the job page:
   - **Copy link** copies `/proof/30434`, or the secure link if the job is private.
   - The secure link `…/proof/30434?k=…` is shown underneath. **Email client** opens your mail app with the secure link already in the message.
   - The **Private job** tick box makes the bare job-number URL ask for the secure link.
3. When the client responds, the job shows **Approved** or **Changes requested**, with a yellow dot until you open it. Their note and attachments (thumbnails and downloads) appear under *Client feedback & history*. The dashboard's *Latest client activity* lists every response.
4. To send a revision, use **Upload new version (V2)**, with an optional note to the client. The same client URL now shows V2 and returns to *Awaiting review*. Earlier versions stay viewable.

## Client side

The client opens `/proof/30434` (or types `30434` on `/proof`) and sees:

- the job number, client name and job description
- the proof itself: images inline; PDFs page by page (‹ ›, arrow keys, thumbnails), plus zoom, download and open-in-new-tab
- **Approve**: name, an optional comment and a "checked spelling, contact details, colours, sizes" tick box, then a green confirmation
- **Request changes**: name, a note, and **optional file attachments** (several files, up to 100 MB each). They then see "Thanks — we're on it. This same link will show the new version" and can add more notes or files while they wait.
- previous versions (view-only) and a short history

An approved version is locked. A decision made on an out-of-date version is rejected with a message asking the client to refresh. Each feedback entry records whether it came via the `secure-link` or the `job-number` URL.

## Security: job-number URLs are guessable

`/proof/30434` is easy to guess. Anyone who tries `/proof/30435` could see that client's artwork and could **approve it**. Here is what's in place and what we recommend:

- **Secure link per job.** Every job has a random 24-character token. `…/proof/30434?k=<token>` always works. Use it in emails; **Email client** already does.
- **Private mode.** Tick *Private job*, or start the server with `DEFAULT_ACCESS=private`, and the bare `/proof/30434` shows *"This proof is private — use the secure link YBI emailed you"*. The files are hidden too.
- **Rate limiting.** An IP that gets more than 40 wrong job numbers or keys in 10 minutes is blocked (HTTP 429) for the rest of that window.
- Pages are served with `noindex` and `same-origin` referrer, so the token isn't leaked to other sites.
- **Recommendation:** for anything confidential, or for clients where a wrong approval would be costly, use private mode (or make it the default) and send the secure link. If a secure link gets forwarded, generate a new token with `PATCH /proof/api/jobs/30434 {"rotateToken":true}`; there's no button for this yet.

## Notifications

Every approval or change request:
1. shows on the **studio dashboard** (activity feed, status, unread dot; the dashboard refreshes every 30 s)
2. is added to **`data/notifications.log`**
3. is **emailed** to the address in **Studio → Settings**, *if* SMTP is configured:

```bash
npm install            # installs nodemailer (the only, optional, dependency)
SMTP_HOST=smtp.office365.com SMTP_PORT=587 SMTP_USER=proofs@ybicreative.com.au SMTP_PASS='…' \
SMTP_FROM='YBI Proofs <proofs@ybicreative.com.au>' node server.js
```

You can also set `SMTP_SECURE=true` for port 465, and `NOTIFY_EMAIL` as the default recipient before one is saved in Settings. The email includes the client's note, links to their attachments and a link to the job in the studio. Its reply-to is the client's email.

## Where things live

```
ybi-approval/
  server.js            # the whole backend (Node built-ins only)
  public/              # front-end: login.html, studio.html, review.html, assets/ (css, js, fonts, logo), vendor/pdfjs (PDF.js 4.10, bundled, works offline)
  data/                # created on first run. Back this folder up.
    jobs/<id>.json     # one file per job: details, token, versions, feedback
    files/<id>/        # proof files (v1-xxxx.pdf, v2-…) and feedback/ (client attachments)
    settings.json      # notification email
    notifications.log  # plain-text log of every approve / change request
    secret.key         # signs the studio login cookie
  samples/             # test proofs (scripts/make-samples.py)
  scripts/smoke-test.sh  # API end-to-end test (curl): routes, duplicates, private jobs, full flow
  scripts/ui-test.py     # browser end-to-end test + screenshots (Playwright)
  screenshots/         # output of the UI test
```

To start fresh, stop the server and delete `data/`. To remove one job, use **Delete job** on its page; this also deletes its files and stops its link working.

## Tests

```bash
node server.js &                         # in one terminal
bash scripts/smoke-test.sh               # API: routes, duplicate refusal, private jobs, JPG approve, PDF changes+file → V2 → approve
rm -rf data && node server.js &          # ui-test creates job 30434, so start from empty data
python3 scripts/ui-test.py               # same flow in a real browser, saves screenshots/
```

## Hosting on ybicreative.com.au/proof

This is a **Node server with a disk**. It can't run inside Wix:
- `www.ybicreative.com.au` is still the classic Wix Editor site. Wix can't reverse-proxy a path like `/proof/*` to an outside server.
- The new headless build is static files on Wix's headless hosting. That serves HTML, CSS and JS only: no Node process, no file storage, no proxy rules.

So the backend needs its own host (a small VPS, Render or Railway with a volume, Fly.io and so on), behind HTTPS with `data/` on persistent storage. There are three ways to get the address:

1. **Subdomain (simplest, recommended):** `proofs.ybicreative.com.au`. Add one DNS record (CNAME or A) pointing at the Node host and run it with `BASE_PATH=/proof PUBLIC_URL=https://proofs.ybicreative.com.au`. Links become `https://proofs.ybicreative.com.au/proof/30434`; with `BASE_PATH=` they'd be `…/30434`. Optionally, add a redirect on the Wix site from `www…/proof` to the subdomain. Wix's redirect manager is meant for internal paths, so check whether it accepts an external target and per-job wildcards before relying on it.
2. **Exactly `www.ybicreative.com.au/proof/30434`:** needs a reverse proxy *in front of* www that sends `/proof/*` to the Node app and everything else to Wix. In practice that means moving the domain's DNS to Cloudflare with a proxied record and a Worker route. That is a larger change: Wix doesn't officially support being proxied, and SSL or domain verification for the Wix site can break. Test it on a staging domain first. The app is ready for this (it accepts the prefix kept or stripped, and honours `X-Forwarded-Host/Proto`). Example nginx (or Caddy) equivalent:
   ```nginx
   location /proof/ { proxy_pass http://127.0.0.1:4321; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto https; client_max_body_size 300m; }
   location / { proxy_pass https://<wix-origin>; }   # everything else → Wix
   ```
3. **Native Wix rebuild:** re-implement the storage on Wix (CMS collections, Media Manager, backend functions) so `/proof` is served by Wix itself. It's possible, but it's a rebuild rather than a deploy.

Serverless hosts without a disk (Netlify or Vercel functions) would need storage moved to S3 or R2 first. Nothing here touches the live Wix site or DNS.

## Security notes (v1)
- See *Security: job-number URLs are guessable* above. Secure links (`?k=`) are 24-character random tokens, so treat them like a password.
- The studio uses one shared password and an HttpOnly cookie. Use a strong `STUDIO_PASSWORD` once it's online.
- Proofs must be PDF, JPG or PNG (up to 300 MB). Client attachments can be any type and are downloaded rather than run.
