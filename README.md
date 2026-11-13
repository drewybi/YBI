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
| Studio | `/proof/studio/quote` | Staff quotes. Saved in `data/quotes.json` so the studio can reopen them |
| Client | `/proof/quote/{id}?k=<token>` | The private quote link. Accept, or request changes. The id alone does not open it |
| Studio | `/proof/studio/settings` | Notification emails and logout |
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
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_SECURE` | — | Outbound mail. Alerts stay off until `SMTP_HOST` is set. |
| `NOTIFY_EMAIL` | drew@, nicola@ and rob@ybicreative.com.au | Default recipient list until Studio → Settings saves one. Commas or semicolons. |

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

1. Click **+ New job**. Enter the job number (for the studio — it is not the client link), client name, business, email and description, pick a calendar colour (grey if you leave it), and set **Date on Calendar** (it starts as today, or as a due date if that field is already on the form). Then drop in one or more PDFs, one or more JPG/PNG images, or a single ZIP. Several PDFs are saved as **one** version, in the order you add them, and the client scrolls through every page. Several images are saved as **one** version. A ZIP is stored as that file and the client downloads it as it was uploaded — it is not unpacked into pages, and it is not mixed with other files. A PDF is not mixed into an image set. Click **Create & get link**.
2. On the job page:
   - **Copy link** copies the private URL `/proof/30434?k=…`. That is the only link that opens the proof.
   - **Email client** opens your mail app with that same private link already in the message.
3. When the client responds, the job shows **Approved** or **Changes requested**, with a yellow dot until you open it. Their note, sticky markers and attachments appear under *Client feedback & history*. **Download changes PDF** builds a file of that version with the numbered stickies drawn on the artwork and a last page of fillable checkboxes (one per change, plus the general note) so you can tick them on screen or on a printout.
4. To send a revision, use **Upload new version (V2)**, with an optional note to the client. The same client URL now shows V2 and returns to *Awaiting review*. Earlier versions stay viewable. Uploading a proof does not email staff.
5. **Edit job** updates the job number, description, client name, business, email and phone, plus the calendar colour and date. Proof files, the secure key, and the order within a day stay. The calendar chip text is the description, so editing that updates the chip. Changing the date clears that day’s order. Changing the job number changes the client link (the key stays the same) — copy the new link and send it. A job number that already belongs to another job is refused.
6. **Remove proof**, next to a version under *Client feedback & history*, deletes that PDF/JPG/PNG and any client notes, stickies or files that were on it. The job, client link, calendar entry and the other versions stay. Confirm before it goes. If that was the only proof, the job remains ready for a new upload and the client page says the proof is still being prepared. `DELETE /proof/api/jobs/{job number or id}/versions/{n}` is studio-only.
7. **Archive.** Two days (48 hours) after the client approves the latest version, the job leaves **All** and the **Approved** filter — but only if **Production** is **No production required** or **Approved for production**. **Awaiting approval** (the default for new and older jobs) keeps the job in the open list even after that approval is two days old. It stays on the jobs page under **Archive**, with the same artwork-status chip. Nothing is deleted: the proof, client link and calendar entry stay, and the job page still opens from Archive. `archivedAt` on the job file is the approval time plus 48 hours. The check runs when the jobs list or a job is opened, again when the server starts, and hourly while it is running. It does not change `updatedAt`. Uploading a newer version, or removing the approved version so the latest one is no longer an approval from two days ago, or setting Production back to Awaiting approval, clears `archivedAt` and the job returns to All. With the search box empty, All and the status filters hide Archive. Typing a search looks through active jobs and Archive together — job number, client, contact, and description — and a result opens the job as usual. The jobs list headings are **Artwork status** (the client’s proof decision) and **Production** (staff only; clients never see it).

**Staff calendar** (`/proof/studio/calendar`) shows every proof job, plus deadlines, meetings and notes. It does not use Google Calendar. Times are Australia/Melbourne. A job is placed on the **Date on Calendar** chosen when it is created. If that was left blank, it uses a due date on the job (`dueAt`, `dueDate`, `deadline` or `calendarDate`) and otherwise the day the job was created in Melbourne. New jobs show up on their own — nothing is copied in by hand. The chip’s only text is the job description from **New job** (no job number, client name, or “Job” label). A blank description leaves a colour-only chip. Open a job from the day list or from **Open job** on its calendar card. Changing the day or the colour does not edit the proof; those overrides live in `data/calendar-events.json` (`jobOverrides`). The colour and the date chosen on **New job** are saved the same way. Staff events are in the same file (`events`): title, start, optional end, optional notes, optional all-day, a colour, and an optional `dayOrder`. Colours are red, blue, green, yellow, purple or grey (grey if unset). Drag a chip to another day to reschedule it. In week view, drop a timed event on a time to change the clock. Slide a chip up or down between the others on the same day to change that day’s order — month view and the week-day list both do this, and a reload keeps it. `dayOrder` is a whole number, lower first; chips with no order keep the previous all-day-then-time order and sit after anything that has been placed. Moving a chip to a different day clears its order so it doesn’t jump the queue. The API is `/proof/api/calendar/events` for staff events and `/proof/api/calendar/jobs/{job number or id}` to set a job’s day, colour and `dayOrder`. `PATCH /proof/api/calendar/order` with `{ "date", "ids" }` saves one day’s order in a single write. Creating a job accepts `colour` and `calendarDate`. Both use the same studio login.

**Staff quotes** (`/proof/studio/quote`) are studio-only. A quote has Client, Contact, date, job description and a validation period of **7 days**, **30 days** or **6 months**, plus 20 lines (description, quantity, price). A blank quantity counts as **1**, so a line with only a price is charged once. When a quantity is filled in, the line amount is quantity × price (a quantity of 0 is free). Prices are ex GST, in Australian dollars. GST is 10% of the subtotal, rounded to the nearest cent, and the total includes GST. The page lists recent quotes for anyone with the studio password. Quotes are stored in `data/quotes.json`. **Print / PDF** uses the browser print dialog. The printed page opens with a short engine masthead — white YBI mark, Brand Engineering lockup, and an outline **Quote.** — and closes with the offices published on ybicreative.com.au (Bendigo and Williamstown, both phones, and website@ybicreative.com.au). The site does not publish an ABN, so the quote does not invent one.

**Copy link** on a saved quote is `/proof/quote/{id}?k=<token>`, the same private-key idea as a proof. The client can accept the quote or request changes with a note. Accept still opens their email to **website@ybicreative.com.au** (the public address on the site) with the subject `QUOTE CONFIRMED:` plus the job description. That draft is a backup. Staff are notified without it: both accept and request-changes are written to `data/notifications.log` and, when SMTP is on, emailed through the same path as a proof decision. The From address is the proof one (`SMTP_FROM`, otherwise `SMTP_USER`, otherwise `proofs@ybicreative.com.au`). Recipients are the studio notification list — with nothing saved in Settings and no `NOTIFY_EMAIL`, that is drew@, nicola@ and rob@ybicreative.com.au.

Accepting a quote adds **one** proof job to the job list. Quote **Client** is the job **Client** (the name in the jobs list). Quote **Contact** is the job **Contact** (the line under that name, and the field that used to be labelled Business). The job description is copied as the description, cut at 2,000 characters, with no job number added to it. The job number is left blank for the studio to type in. Until then the job opens from its id, and the page heading is the description. Versions stay empty until a proof is uploaded, and the job sits on the calendar on the day it was created. The quote stores that job’s id. Accepting again is refused and does not create a second job, including when an earlier attempt saved the job and the confirmation is retried. Requesting changes does not create a job. Lines, GST and the validation period stay on the quote. Deleting the quote does not delete the job. A quote that was already accepted before this link existed is left as it is.

## Client side

The client opens the private link YBI sent (`/proof/30434?k=…`) and sees:

- the job number, client name and job description
- the proof itself: a single image inline; a version made of several JPG/PNG files flips between them (‹ ›, arrow keys, swipe, thumbnails) and offers **Download all** (one ZIP of that version). A multi-page PDF, or several PDFs uploaded as one version, stacks every page so you can scroll through them in the preview and in full screen (‹ ›, arrow keys and thumbnails jump to a page). A short label marks where the next PDF starts. Each page is fitted with space around it; + zooms in. **Download all** is one ZIP of that version, and each PDF can be downloaded on its own. A version that was uploaded as a ZIP is not shown as pages — the page offers **Download zip**, which is the file the studio uploaded. Zoom (+ / −), a full-screen stage (⤢, Esc to leave), download and open-in-new-tab
- **Approve**: name, an optional comment and a "checked spelling, contact details, colours, sizes" tick box, then a green confirmation
- **Request changes**: name, optional notes, and **optional file attachments** (several files, up to 100 MB each). They can also click the proof to drop numbered sticky notes — each sticky has its own change text, listed on the right in the same order, and selecting a list item highlights that sticky (and the other way around). Positions are saved with the feedback so the studio sees them on the artwork. They then see "Thanks — we're on it. This same link will show the new version" and can add more notes or files while they wait.
- previous versions from the Versions menu: that version’s artwork, the note YBI wrote when they uploaded it, and a **Changes requested** section with the client’s own comment, numbered sticky text (matching the markers on the proof), who asked and when, and their attachments. There is no side-by-side diff. The decision panel stays on the latest version

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
1. shows on the **studio dashboard** (status and unread dot; the dashboard refreshes every 30 s)
2. is added to **`data/notifications.log`**
3. is **emailed** to every address in **Studio → Settings**, *if* SMTP is configured:

```bash
npm install            # installs nodemailer (the only, optional, dependency)
SMTP_HOST=smtp.office365.com SMTP_PORT=587 SMTP_USER=proofs@ybicreative.com.au SMTP_PASS='…' \
SMTP_FROM='YBI Proofs <proofs@ybicreative.com.au>' node server.js
```

You can also set `SMTP_SECURE=true` for port 465. The notification field is a list: separate addresses with commas or semicolons. Invalid addresses are skipped. When Settings has nothing saved, `NOTIFY_EMAIL` is the list (same separators). When that is unset too, alerts go to:

- drew@ybicreative.com.au
- nicola@ybicreative.com.au
- rob@ybicreative.com.au

A list saved in Studio → Settings replaces both the built-in addresses and `NOTIFY_EMAIL`. Clear the field and save to go back to that default.

The client email includes the job number, client, the client's note, sticky positions, links to their attachments and a link to the job in the studio. Times are Australia/Melbourne. Its reply-to is the client's email.

Quote confirmations and quote change requests use this same recipient list and the same From address. They do not change who a proof approval or change request is sent to. A quote confirmation also names the proof job that was created from it.

Uploading a proof, including a new version on a job that already has one, does not email staff and is not written to `data/notifications.log`.

## Where things live

```
ybi-approval/
  server.js            # the whole backend (Node built-ins only)
  public/              # front-end: login.html, studio.html, review.html, assets/ (css, js, fonts, logo), vendor/pdfjs (PDF.js 4.10, bundled, works offline)
  data/                # created on first run. Back this folder up.
    jobs/<id>.json     # one file per job: details, token, versions, feedback, archivedAt once an approval is two days old
    files/<id>/        # proof files (v1-xxxx.pdf, v2-…) and feedback/ (client attachments)
    settings.json      # notification emails (comma- or semicolon-separated; blank uses the default list)
    calendar-events.json  # staff events, plus each job’s calendar colour, date and day order
    quotes.json        # staff quotes (client, lines, validation). Totals are recalculated when a quote is opened
    notifications.log  # plain-text log of every approve / change request, plus quote responses
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
node scripts/notify-recipients.test.js   # default recipient list, comma/semicolon settings, approve + V2 mail
node scripts/multi-version.test.js       # several JPG/PNG in one version, ZIP download, legacy single-file jobs
node scripts/zip-upload.test.js          # a ZIP is stored and downloaded as uploaded; it is not unpacked
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
- Proofs must be PDF, JPG, PNG, or a ZIP (up to 300 MB). Several JPG/PNG files can share one version, and several PDFs can share one version, up to 40 files and 300 MB combined. A ZIP is one file per version and is downloaded as uploaded, not unpacked. A PDF is not mixed with images in the same version. Client attachments can be any type and are downloaded rather than run.
