# YBI Proofs — artwork approval app

A small, YBI-branded proofing tool for YBI Creative. The studio uploads a proof, sends the client a link, and the client either **approves** it or **requests changes**. They can add a note and attach files. The studio then uploads V2, V3 and so on, and the same client link always shows the newest version.

- **No client accounts.** Each job is opened only with a private link, `/proof/{jobNumber}?k={token}`. The job number alone does not show the proof.
- **Studio** is protected by one password.
- **No build step, no framework, no database.** It runs on Node ≥ 18 and keeps everything in plain files under `data/`.
- **Brand** comes from the ybicreative.com.au site build: the Archivo (wide) and Work Sans fonts, the white YBI logo, the near-black `#09090a` / off-white `#f3f1ec` palette with the single `#A7A9AC` (35% black) accent, outline display headings, pill buttons, and the looping engine film in the header (the still image shows when motion is reduced).

## URLs

The app is mounted at **`/proof`** by default (`BASE_PATH`). Each job's page is its **job number**.

| Who | URL | What |
|---|---|---|
| Studio | `/proof` | Studio login. Clients are not asked for a job number here |
| Client | **`/proof/30434?k=<token>`** | The only client URL. View, approve, or request changes. **Copy link** and **Email client** use this |
| Client (no key) | `/proof/30434` | Does not show the proof or its files. Asks for the private link |
| Studio | `/proof/studio` | Dashboard (redirects to `/proof` to log in) |
| Studio | `/proof/studio/30434` | Admin page for job 30434: links, versions, client feedback, upload a new version |
| Studio | `/proof/studio/calendar` | Private staff calendar. Proof jobs appear on their own, plus deadlines and meetings. Month and week views. Each item can be coloured and reordered within a day |
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
| `DEFAULT_ACCESS` | `private` | Kept for Render config. The app always requires the secure link; it does not honour `public`. |
| `SMTP_*`, `NOTIFY_EMAIL` | — | Email alerts (see below) |

## Job numbers

- The job number **is** the URL: `30434` → `/proof/30434`. Allowed characters are letters, numbers, `-`, `_` and `.` (no spaces, max 40). Matching is case-insensitive.
- **Job numbers must be unique.** Creating a job with a number that already exists is **refused** (HTTP 409, *"Job 30434 already exists — open it and upload a new version instead."*) and the studio shows an "Open it" link. This prevents one client's proof from silently replacing another's. To revise a job, open it and use **Upload new version**.
- Reserved words that can't be used as job numbers: `studio`, `api`, `assets`, `vendor`, `f`, `p`, `settings`, `calendar`, `login`, `logout`.

## Studio (YBI side)

| What | Where |
|---|---|
| Login + dashboard | `http://localhost:4321/proof` → `/proof/studio` |
| Default password | **`ybi-proof`** (change it with `STUDIO_PASSWORD`) |
| One-click login link | `/proof/studio?key=<password>` sets a 90-day cookie. Bookmark it on studio machines. |
| Scripts/API | send the header `X-Studio-Key: <password>`. Jobs can be addressed by number: `/proof/api/jobs/30434` |

1. Click **+ New job**. Enter the job number (for the studio — it is not the client link), client name, business, email and description, pick a calendar colour (grey if you leave it), and set **Date on Calendar** (it starts as today, or as a due date if that field is already on the form). Then drop in a PDF (single or multi-page), JPG or PNG. Click **Create & get link**.
2. On the job page:
   - **Copy link** copies the private URL `/proof/30434?k=…`. That is the only link that opens the proof.
   - **Email client** opens your mail app with that same private link already in the message.
3. When the client responds, the job shows **Approved** or **Changes requested**, with a yellow dot until you open it. Their note, sticky markers and attachments appear under *Client feedback & history*. **Download changes PDF** builds a file of that version with the numbered stickies drawn on the artwork and a last page of fillable checkboxes (one per change, plus the general note) so you can tick them on screen or on a printout. The dashboard's *Latest client activity* lists every response.
4. To send a revision, use **Upload new version (V2)**, with an optional note to the client. The same client URL now shows V2 and returns to *Awaiting review*. Earlier versions stay viewable.

**Staff calendar** (`/proof/studio/calendar`) shows every proof job, plus deadlines, meetings and notes. It does not use Google Calendar. Times are Australia/Melbourne. A job is placed on the **Date on Calendar** chosen when it is created. If that was left blank, it uses a due date on the job (`dueAt`, `dueDate`, `deadline` or `calendarDate`) and otherwise the day the job was created in Melbourne. New jobs show up on their own — nothing is copied in by hand. The chip’s only text is the job description from **New job** (no job number, client name, or “Job” label). A blank description leaves a colour-only chip. Open a job from the day list or from **Open job** on its calendar card. Changing the day or the colour does not edit the proof; those overrides live in `data/calendar-events.json` (`jobOverrides`). The colour and the date chosen on **New job** are saved the same way. Staff events are in the same file (`events`): title, start, optional end, optional notes, optional all-day, a colour, and an optional `dayOrder`. Colours are red, blue, green, yellow, purple or grey (grey if unset). Drag a chip to another day to reschedule it. In week view, drop a timed event on a time to change the clock. Slide a chip up or down between the others on the same day to change that day’s order — month view and the week-day list both do this, and a reload keeps it. `dayOrder` is a whole number, lower first; chips with no order keep the previous all-day-then-time order and sit after anything that has been placed. Moving a chip to a different day clears its order so it doesn’t jump the queue. The API is `/proof/api/calendar/events` for staff events and `/proof/api/calendar/jobs/{job number or id}` to set a job’s day, colour and `dayOrder`. `PATCH /proof/api/calendar/order` with `{ "date", "ids" }` saves one day’s order in a single write. Creating a job accepts `colour` and `calendarDate`. Both use the same studio login.

## Client side

The client opens the private link YBI sent (`/proof/30434?k=…`) and sees:

- the job number, client name and job description
- the proof itself: images inline; PDFs page by page (‹ ›, arrow keys, thumbnails), plus zoom (+ / −), a full-screen stage (⤢, Esc to leave), download and open-in-new-tab
- **Approve**: name, an optional comment and a "checked spelling, contact details, colours, sizes" tick box, then a green confirmation
- **Request changes**: name, optional notes, and **optional file attachments** (several files, up to 100 MB each). They can also click the proof to drop numbered sticky notes — each sticky has its own change text, listed on the right in the same order, and selecting a list item highlights that sticky (and the other way around). Positions are saved with the feedback so the studio sees them on the artwork. They then see "Thanks — we're on it. This same link will show the new version" and can add more notes or files while they wait.
- previous versions (view-only) and a short history

An approved version is locked. A decision made on an out-of-date version is rejected with a message asking the client to refresh. Each feedback entry records whether it came via the `secure-link` or the `job-number` URL.

## Security: job numbers are not enough

`/proof/30434` does not show the artwork. Every job has a random token, and the client page, the review API, and the files all require `?k=<token>`. Jobs saved earlier as public are treated as private too. There is no control to turn that off.

- **Copy link** and **Email client** always use `/proof/{jobNumber}?k=<token>`.
- A wrong or missing key gets the same “use the secure link” response, and the file URL 404s.
- **Rate limiting.** An IP that gets more than 40 wrong job numbers or keys in 10 minutes is blocked (HTTP 429) for the rest of that window.
- Pages are served with `noindex` and `same-origin` referrer, so the token isn't leaked to other sites.
- If a secure link gets forwarded, generate a new token with `PATCH /proof/api/jobs/30434 {"rotateToken":true}`; there's no button for this yet.

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
    calendar-events.json  # staff events, plus each job’s calendar colour, date and day order
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
