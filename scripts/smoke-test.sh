#!/usr/bin/env bash
# End-to-end API smoke test.
# Usage: ORIGIN=http://localhost:4321 BASE_PATH=/proof KEY=ybi-proof bash scripts/smoke-test.sh
set -euo pipefail
ORIGIN=${ORIGIN:-http://localhost:4321}; BP=${BASE_PATH-/proof}; BASE="$ORIGIN$BP"; KEY=${KEY:-ybi-proof}; S="$(dirname "$0")/../samples"
H=(-H "X-Studio-Key: $KEY"); JS=(-H 'Content-Type: application/json')
RUN=$RANDOM; NA="T${RUN}A"; NB="T${RUN}B"; NP="T${RUN}P"; NC="T${RUN}C"; NCOL="T${RUN}R"; NGRY="T${RUN}G"; NDATE="T${RUN}D"; NDAYG="T${RUN}E"   # unique test job numbers
j() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const o=JSON.parse(s);console.log(eval('o'+process.argv[1]))})" "$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
pass() { echo "  ✓ $*"; }; fail() { echo "  ✗ $*"; exit 1; }
chk() { [ "$1" = "$2" ] && pass "$3" || fail "$3 (got '$1', want '$2')"; }
[ -f "$S/poster-A2.jpg" ] || python3 "$(dirname "$0")/make-samples.py" >/dev/null

echo "1) Routes + auth"
if [ -n "$BP" ]; then chk "$(code "$ORIGIN/")" 302 "/ redirects to $BP"; fi
chk "$(code "$BASE")" 200 "$BP entry page (studio login)"
entry=$(curl -sf "$BASE"); echo "$entry" | grep -q 'id="jn"' && fail "job-number finder still on the entry page" || pass "no job-number finder"
chk "$(code "$BASE/studio")" 302 "$BP/studio redirects to login when signed out"
chk "$(code "$BASE/studio/calendar")" 302 "$BP/studio/calendar redirects to login when signed out"
cal_loc=$(curl -s -D - -o /dev/null "$BASE/studio/calendar" | awk 'tolower($1)=="location:" {print $2}' | tr -d '\r')
echo "$cal_loc" | grep -q 'studio%2Fcalendar' && pass "calendar login redirect returns to the calendar page" || fail "calendar login redirect (got '$cal_loc')"
chk "$(code "$BASE/api/jobs")" 401 "studio API blocked without password"

echo "2) Job $NA — JPG → approve via $BP/$NA"
A=$(curl -sf "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"$NA\",\"clientName\":\"Sam Client\",\"clientCompany\":\"Bendigo Motor Show\",\"description\":\"A2 event poster, 170gsm gloss, qty 50\"}" "$BASE/api/jobs")
ATOK=$(echo "$A" | j .token); chk "$(echo "$A" | j .secureUrl)" "$BASE/$NA?k=$ATOK" "client link is the secure URL"
chk "$(code "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"$NA\",\"clientName\":\"Dupe\"}" "$BASE/api/jobs")" 409 "duplicate job number refused (409)"
chk "$(code "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"${NA,,}\",\"clientName\":\"Dupe\"}" "$BASE/api/jobs")" 409 "duplicate check is case-insensitive"
chk "$(code "${H[@]}" "${JS[@]}" -d '{"jobNumber":"bad number!","clientName":"x"}' "$BASE/api/jobs")" 400 "invalid job number refused"
chk "$(code "${H[@]}" "${JS[@]}" -d '{"jobNumber":"studio","clientName":"x"}' "$BASE/api/jobs")" 400 "reserved job number refused"
chk "$(code "${H[@]}" "${JS[@]}" -d '{"jobNumber":"calendar","clientName":"x"}' "$BASE/api/jobs")" 400 "reserved calendar job number refused"
calhtml=$(curl -sf "${H[@]}" "$BASE/studio/calendar")
echo "$calhtml" | grep -q "href=\"$BP/studio/calendar\"" && pass "studio nav links to calendar" || fail "studio nav missing calendar link"
echo "$calhtml" | grep -qi '<iframe' && fail "calendar page must not embed an iframe" || pass "calendar page has no iframe"
caljs=$(curl -sf "$BASE/assets/studio.js")
grep -qi 'calendar.google.com\|STAFF_CALENDAR_URL\|<iframe' <<<"$caljs" && fail "studio calendar still points at Google or an embed" || pass "studio calendar does not use Google or an embed"
grep -q '/api/calendar/events' <<<"$caljs" && pass "studio calendar calls the studio API" || fail "calendar API missing from studio.js"
curl -sf "${H[@]}" -H 'Content-Type: image/jpeg' --data-binary @"$S/poster-A2.jpg" "$BASE/api/jobs/$NA/versions?name=poster-A2.jpg" >/dev/null && pass "V1 JPG uploaded (studio API by job number)"
chk "$(code "$BASE/api/review/$NA")" 403 "job number alone cannot read the proof"
chk "$(code "$BASE/$NA/file/v1")" 404 "file hidden without key"
chk "$(curl -s "$BASE/api/review/$NA?k=$ATOK" | j .status)" awaiting_review "secure link sees awaiting_review"
chk "$(curl -s -o /dev/null -w '%{content_type}' "$BASE/$NA/file/v1?k=$ATOK")" image/jpeg "proof served with key"
chk "$(curl -s -o /dev/null -w '%{redirect_url}' "$ORIGIN$BP/p/$ATOK")" "$BASE/$NA?k=$ATOK" "legacy /p/<token> → $BP/$NA?k=…"
chk "$(curl -sf "${JS[@]}" -d '{"type":"approve","name":"Sam Client","note":"Looks great","version":1}' "$BASE/api/review/$NA/decision?k=$ATOK" | j .status)" approved "approved"
chk "$(code "${JS[@]}" -d '{"type":"changes","name":"x","note":"y","version":1}' "$BASE/api/review/$NA/decision?k=$ATOK")" 409 "approved version locked (409)"

echo "3) Job $NB — 3-page PDF → changes + file → V2 → approve"
B=$(curl -sf "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"$NB\",\"clientName\":\"Jo Retailer\",\"description\":\"Spring catalogue, A4 3pp\"}" "$BASE/api/jobs"); BTOK=$(echo "$B" | j .token)
curl -sf "${H[@]}" -H 'Content-Type: application/pdf' --data-binary @"$S/catalogue-V1.pdf" "$BASE/api/jobs/$NB/versions?name=catalogue-V1.pdf" >/dev/null && pass "V1 PDF uploaded"
chk "$(code -H 'Content-Type: image/png' --data-binary @"$S/client-markup.png" "$BASE/api/review/$NB/attachments?name=client-markup.png")" 403 "attachment upload without key refused"
ATT=$(curl -sf -H 'Content-Type: image/png' --data-binary @"$S/client-markup.png" "$BASE/api/review/$NB/attachments?name=client-markup.png&k=$BTOK" | j .id) && pass "client attachment uploaded"
chk "$(curl -sf "${JS[@]}" -d "{\"type\":\"changes\",\"name\":\"Jo Retailer\",\"note\":\"Back cover phone number is wrong — see markup.\",\"attachments\":[\"$ATT\"],\"stickies\":[{\"page\":2,\"x\":0.42,\"y\":0.18,\"text\":\"Fix the phone on page 2\"},{\"page\":1,\"x\":0.2,\"y\":0.7,\"text\":\"Move the logo up\"}],\"version\":1}" "$BASE/api/review/$NB/decision?k=$BTOK" | j .status)" changes_requested "changes requested"
chk "$(code "${JS[@]}" -d '{"type":"changes","name":"Jo","note":"x","version":1,"stickies":[{"page":1,"x":0.2,"y":0.2,"text":""}]}' "$BASE/api/review/$NB/decision?k=$BTOK")" 400 "sticky without text is refused"
SJ=$(curl -sf "${H[@]}" "$BASE/api/jobs/$NB")
chk "$(echo "$SJ" | j '.versions[0].feedback[0].attachments[0].name')" client-markup.png "studio sees note + attachment"
chk "$(echo "$SJ" | j '.versions[0].feedback[0].stickies[0].text')" "Fix the phone on page 2" "studio sees sticky text"
chk "$(echo "$SJ" | j '.versions[0].feedback[0].stickies[0].page')" 2 "studio sees sticky page"
chk "$(echo "$SJ" | j '.versions[0].feedback[0].stickies.length')" 2 "studio sees both stickies"
FID=$(echo "$SJ" | j '.versions[0].feedback[0].id')
chk "$(code "$BASE/api/jobs/$NB/changes.pdf?v=1&f=$FID")" 401 "changes pdf needs studio login"
curl -sf "${H[@]}" -o /tmp/ybi-changes.pdf "$BASE/api/jobs/$NB/changes.pdf?v=1&f=$FID" && pass "changes pdf downloaded"
node -e '
const fs=require("fs"); const {PDFDocument}=require("pdf-lib");
(async()=>{
  const doc=await PDFDocument.load(fs.readFileSync("/tmp/ybi-changes.pdf"));
  const {PDFCheckBox}=require("pdf-lib");
  const n=doc.getPageCount(), boxes=doc.getForm().getFields().filter(f=>f instanceof PDFCheckBox).length;
  if(n<4) throw new Error("expected artwork pages plus a checklist, got "+n);
  if(boxes<3) throw new Error("expected a checkbox per sticky plus the general note, got "+boxes);
  console.log("  ✓ changes pdf has "+n+" pages and "+boxes+" checkboxes");
})().catch(e=>{console.error("  ✗", e.message); process.exit(1);});
'
chk "$(code "$ORIGIN$(echo "$SJ" | j '.versions[0].feedback[0].attachments[0].url')")" 200 "attachment downloadable"
chk "$(code "${H[@]}" -X POST --data-binary 'x' "$BASE/api/jobs/$NB/versions?name=evil.exe")" 415 "non-proof file types rejected"
curl -sf "${H[@]}" -H 'Content-Type: application/pdf' --data-binary @"$S/catalogue-V2.pdf" "$BASE/api/jobs/$NB/versions?name=catalogue-V2.pdf&note=Phone%20number%20fixed" >/dev/null && pass "V2 uploaded"
chk "$(code "$BASE/api/review/$NB")" 403 "V2 still hidden without key"
C=$(curl -sf "$BASE/api/review/$NB?k=$BTOK"); chk "$(echo "$C" | j '.versions.length')/$(echo "$C" | j .status)" 2/awaiting_review "secure link sees V2, awaiting review"
chk "$(code "${JS[@]}" -d '{"type":"approve","name":"Jo","version":1}' "$BASE/api/review/$NB/decision?k=$BTOK")" 409 "stale-version decision blocked (409)"
chk "$(curl -sf "${JS[@]}" -d '{"type":"approve","name":"Jo Retailer","version":2}' "$BASE/api/review/$NB/decision?k=$BTOK" | j .status)" approved "V2 approved"

echo "4) Private job $NP — job number alone is not enough"
P=$(curl -sf "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"$NP\",\"clientName\":\"Private Co\",\"access\":\"private\"}" "$BASE/api/jobs"); PTOK=$(echo "$P" | j .token)
curl -sf "${H[@]}" -H 'Content-Type: image/png' --data-binary @"$S/client-markup.png" "$BASE/api/jobs/$NP/versions?name=art.png" >/dev/null
chk "$(code "$BASE/api/review/$NP")" 403 "no key → 403"
chk "$(code "$BASE/$NP/file/v1")" 404 "file hidden without key"
chk "$(code "$BASE/api/review/$NP?k=$PTOK")" 200 "secure link ?k= works"
chk "$(code "$BASE/$NP/file/v1?k=$PTOK")" 200 "file with key works"
curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d '{"access":"public"}' "$BASE/api/jobs/$NP" >/dev/null
chk "$(code "$BASE/api/review/$NP")" 403 "asking for public access does not open the job number"
chk "$(echo "$(curl -sf "${H[@]}" "$BASE/api/jobs/$NP")" | j .access)" private "stored access stays private"

echo "5) Staff calendar CRUD"
chk "$(code "$BASE/api/calendar/events")" 401 "calendar API blocked without password"
chk "$(code "${H[@]}" "${JS[@]}" -d '{"title":"","start":"2026-11-12T09:00"}' "$BASE/api/calendar/events")" 400 "calendar event needs a title"
chk "$(code "${H[@]}" "${JS[@]}" -d '{"title":"Bad time","allDay":false,"start":"2026-11-12T15:00","end":"2026-11-12T09:00"}' "$BASE/api/calendar/events")" 400 "calendar end before start refused"
chk "$(code "${H[@]}" "${JS[@]}" -d '{"title":"Needs a time","allDay":false,"start":"2026-11-12"}' "$BASE/api/calendar/events")" 400 "timed calendar event needs a time"
EV=$(curl -sf "${H[@]}" "${JS[@]}" -d '{"title":"Smoke deadline","start":"2026-11-12T09:30","end":"2026-11-12T10:15","notes":"Bring proofs","allDay":false}' "$BASE/api/calendar/events")
EID=$(echo "$EV" | j .id)
chk "$(echo "$EV" | j .title)" "Smoke deadline" "calendar event created"
chk "$(echo "$EV" | j .kind)" event "staff event kind stays event"
chk "$(echo "$EV" | j .colour)" grey "calendar event defaults to grey"
chk "$(echo "$EV" | j .start)" "2026-11-12T09:30" "start stays Melbourne wall time"
chk "$(echo "$EV" | j .notes)" "Bring proofs" "calendar notes stored"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events/$EID" | j .end)" "2026-11-12T10:15" "calendar event readable by id"
AD=$(curl -sf "${H[@]}" "${JS[@]}" -d '{"title":"Install week","allDay":true,"start":"2026-11-16","end":"2026-11-18","notes":"On site"}' "$BASE/api/calendar/events")
AID=$(echo "$AD" | j .id)
chk "$(echo "$AD" | j .allDay)" true "all-day calendar event created"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events?from=2026-11-17&to=2026-11-17" | j ".events.filter(e=>e.id==='$AID').length")" 1 "multi-day event appears inside its range"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events?from=2026-11-19&to=2026-11-19" | j ".events.filter(e=>e.id==='$AID').length")" 0 "multi-day event is outside a later day"
chk "$(curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d '{"title":"Smoke deadline moved","allDay":true,"start":"2026-11-13","end":null,"notes":"All day now"}' "$BASE/api/calendar/events/$EID" | j .start)" "2026-11-13" "calendar event updated"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events/$EID" | j .colour)" grey "updating an event keeps its colour"
chk "$(curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d '{"colour":"blue"}' "$BASE/api/calendar/events/$EID" | j .colour)" blue "event colour saved"
chk "$(curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d '{"notes":"Colour stays"}' "$BASE/api/calendar/events/$EID" | j .colour)" blue "title-less update does not clear colour"
chk "$(code "${H[@]}" "${JS[@]}" -X PATCH -d '{"colour":"orange"}' "$BASE/api/calendar/events/$EID")" 400 "unknown event colour refused"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events/$EID" | j .colour)" blue "refused colour is not stored"
chk "$(curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d '{"colour":"green"}' "$BASE/api/calendar/events/$AID" | j .colour)" green "all-day event colour saved"
chk "$(code "${H[@]}" -X DELETE "$BASE/api/calendar/events/$EID")" 200 "calendar event deleted"
chk "$(code "${H[@]}" "$BASE/api/calendar/events/$EID")" 404 "deleted calendar event is gone"
chk "$(code "${H[@]}" -X DELETE "$BASE/api/calendar/events/$AID")" 200 "all-day calendar event deleted"
chk "$(code "${H[@]}" "$BASE/api/calendar/nope")" 404 "unknown calendar route 404"
chk "$(code "${JS[@]}" -X PATCH -d '{"colour":"red"}' "$BASE/api/calendar/jobs/$NA")" 401 "job calendar update needs studio login"
DATA="${DATA_DIR:-$(dirname "$0")/../data}"
DUEID=$(printf '%012x' "$RUN"); TZID=$(printf '%012x' $((100000 + RUN)))
mkdir -p "$DATA/jobs"
cat > "$DATA/jobs/$DUEID.json" <<EOF
{"id":"$DUEID","token":"fixturetokenfixturetoken","jobNumber":"DUE$RUN","description":"Due fixture","clientName":"Due Client","clientCompany":"","clientEmail":"","clientPhone":"","access":"private","createdAt":"2020-01-15T02:00:00.000Z","dueAt":"2026-12-20","versions":[]}
EOF
cat > "$DATA/jobs/$TZID.json" <<EOF
{"id":"$TZID","token":"fixturetokenfixturetoken","jobNumber":"TZ$RUN","description":"Created late UTC","clientName":"Tz Client","clientCompany":"","clientEmail":"","clientPhone":"","access":"private","createdAt":"2026-06-15T14:30:00.000Z","versions":[]}
EOF
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events?from=2026-12-20&to=2026-12-20" | j ".events.filter(e=>e.jobNumber==='DUE$RUN').length")" 1 "job with dueAt is on that day"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events?from=2020-01-15&to=2020-01-15" | j ".events.filter(e=>e.jobNumber==='DUE$RUN').length")" 0 "dueAt wins over createdAt"
DUE_TITLE=$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/DUE$RUN" | j .title)
chk "$DUE_TITLE" "Due fixture" "job calendar chip label is the job description"
echo "$DUE_TITLE" | grep -q "DUE$RUN\|Due Client" && fail "calendar chip label includes the job number or client" || pass "calendar chip label omits job number and client"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/DUE$RUN" | j .colour)" grey "job calendar colour defaults to grey"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/DUE$RUN" | j .kind)" job "job calendar entry is linked as a job"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/DUE$RUN" | j .href)" "$BP/studio/DUE$RUN" "job calendar entry links to the studio job"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events?from=2026-06-16&to=2026-06-16" | j ".events.filter(e=>e.jobNumber==='TZ$RUN').length")" 1 "job with no due date uses the Melbourne createdAt day"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events?from=2026-06-15&to=2026-06-15" | j ".events.filter(e=>e.jobNumber==='TZ$RUN').length")" 0 "UTC createdAt after 14:30 is the next Melbourne day in June"
chk "$(curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d '{"colour":"yellow"}' "$BASE/api/calendar/jobs/DUE$RUN" | j .start)" "2026-12-20" "colour-only update keeps the due day"
chk "$(code "${H[@]}" "${JS[@]}" -X PATCH -d '{"colour":"orange"}' "$BASE/api/calendar/jobs/DUE$RUN")" 400 "unknown job colour refused"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/DUE$RUN" | j .colour)" yellow "refused job colour is not stored"
chk "$(code "${H[@]}" "${JS[@]}" -X PATCH -d '{"date":"2026-02-31","colour":"purple"}' "$BASE/api/calendar/jobs/DUE$RUN")" 400 "invalid job calendar date refused"
MOVED=$(curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d '{"date":"2026-12-22","colour":"purple"}' "$BASE/api/calendar/jobs/$DUEID")
chk "$(echo "$MOVED" | j .start)" "2026-12-22" "job day saved by job id"
chk "$(echo "$MOVED" | j .colour)" purple "job colour saved by job id"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events?from=2026-12-20&to=2026-12-20" | j ".events.filter(e=>e.jobNumber==='DUE$RUN').length")" 0 "moved job leaves its old day"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events?from=2026-12-22&to=2026-12-22" | j ".events.filter(e=>e.jobNumber==='DUE$RUN').length")" 1 "moved job appears on the new day"
HOLD=$(curl -sf "${H[@]}" "${JS[@]}" -d '{"title":"Keep overrides","allDay":true,"start":"2026-12-22","colour":"red"}' "$BASE/api/calendar/events")
chk "$(echo "$HOLD" | j .colour)" red "staff event can be created in red"
KEPT=$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/DUE$RUN")
chk "$(echo "$KEPT" | j .start)" "2026-12-22" "saving a staff event keeps the job date"
chk "$(echo "$KEPT" | j .colour)" purple "saving a staff event keeps the job colour"
curl -sf "${H[@]}" -X DELETE "$BASE/api/calendar/events/$(echo "$HOLD" | j .id)" >/dev/null
TODAY=$(node -e 'const p=new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Melbourne",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()); const g=t=>p.find(x=>x.type===t).value; console.log(g("year")+"-"+g("month").padStart(2,"0")+"-"+g("day").padStart(2,"0"))')
curl -sf "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"$NC\",\"clientName\":\"New Cal\",\"description\":\"Appears without import\"}" "$BASE/api/jobs" >/dev/null
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events?from=$TODAY&to=$TODAY" | j ".events.filter(e=>e.jobNumber==='$NC'&&e.colour==='grey'&&e.kind==='job').length")" 1 "a new job appears on the Melbourne created day without an import"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events?from=$TODAY&to=$TODAY" | j ".events.filter(e=>e.jobNumber==='$NA').length")" 1 "an existing job is on the calendar"
COL=$(curl -sf "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"$NCOL\",\"clientName\":\"Colour Co\",\"colour\":\"red\"}" "$BASE/api/jobs")
COLID=$(echo "$COL" | j .id)
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/$NCOL" | j .colour)" red "new job saves the chosen calendar colour"
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const o=d.jobOverrides[process.argv[2]]; if(!o||o.colour!=="red") process.exit(1);' "$DATA/calendar-events.json" "$COLID" && pass "new job colour is stored as a job override" || fail "new job colour override"
echo "$COL" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s); if(Object.prototype.hasOwnProperty.call(o,"colour")){console.error("colour leaked"); process.exit(1)}})' && pass "job create response does not include the calendar colour" || fail "job create response includes the calendar colour"
GRY=$(curl -sf "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"$NGRY\",\"clientName\":\"Grey Co\",\"colour\":\"grey\"}" "$BASE/api/jobs")
GRYID=$(echo "$GRY" | j .id)
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/$NGRY" | j .colour)" grey "new job defaults to grey when grey is chosen"
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(d.jobOverrides[process.argv[2]]) process.exit(1);' "$DATA/calendar-events.json" "$GRYID" && pass "grey is not stored as a job override" || fail "grey job override was stored"
chk "$(code "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"T${RUN}X\",\"clientName\":\"Bad Colour\",\"colour\":\"orange\"}" "$BASE/api/jobs")" 400 "new job refuses an unknown calendar colour"
chk "$(code "${H[@]}" "$BASE/api/jobs/T${RUN}X")" 404 "refused colour does not create the job"
studiohtml=$(curl -sf "${H[@]}" "$BASE/studio")
echo "$studiohtml" | grep -q '>+ New job<' && pass "studio header says New job" || fail "studio header still says New proof"
echo "$studiohtml" | grep -q '>New job<' && pass "new job modal title is New job" || fail "new job modal title"
echo "$studiohtml" | grep -q 'id="n-colour-label">Calendar colour' && pass "new job form has a calendar colour field" || fail "new job calendar colour field"
grep -q "name: 'colour'" <<<"$caljs" && pass "new job form uses the calendar colour swatches" || fail "new job colour swatches"
echo "$studiohtml" | grep -q '>Date on Calendar<' && pass "new job form labels Date on Calendar" || fail "new job Date on Calendar label"
grep -q 'n-caldate' <<<"$caljs" && pass "new job form fills the calendar date" || fail "new job calendar date script"
grep -q '/api/calendar/order' <<<"$caljs" && pass "studio calendar saves within-day order" || fail "calendar order API missing from studio.js"
grep -q 'New proof' <<<"$caljs" && fail "studio script still says New proof" || pass "studio script create label is New job"
reviewhtml=$(curl -sf "$BASE/no-such-job-$RUN")
echo "$reviewhtml" | grep -q 'Artwork proof' && pass "client page still says artwork proof" || fail "client page lost proof wording"
echo "$reviewhtml" | grep -q 'New job' && fail "client page shows the staff New job label" || pass "client page does not show New job"
node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(d.events)||!d.jobOverrides||typeof d.jobOverrides!=="object") process.exit(1);' "$DATA/calendar-events.json" && pass "calendar file keeps events and job overrides" || fail "calendar file shape"
curl -sf "${H[@]}" -X DELETE "$BASE/api/jobs/DUE$RUN" >/dev/null
curl -sf "${H[@]}" -X DELETE "$BASE/api/jobs/TZ$RUN" >/dev/null
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events?from=2026-12-22&to=2026-12-22" | j ".events.filter(e=>e.jobNumber==='DUE$RUN').length")" 0 "deleted job leaves the calendar"
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if(d.jobOverrides[process.argv[2]]) process.exit(1);' "$DATA/calendar-events.json" "$DUEID" && pass "deleted job drops its calendar override" || fail "deleted job calendar override still stored"

echo "5b) Day order and Date on Calendar"
OA=$(curl -sf "${H[@]}" "${JS[@]}" -d '{"title":"Order A","allDay":true,"start":"2026-11-20","colour":"red"}' "$BASE/api/calendar/events")
OB=$(curl -sf "${H[@]}" "${JS[@]}" -d '{"title":"Order B","allDay":true,"start":"2026-11-20","colour":"blue"}' "$BASE/api/calendar/events")
OC=$(curl -sf "${H[@]}" "${JS[@]}" -d '{"title":"Order C","allDay":true,"start":"2026-11-20","colour":"green","dayOrder":4}' "$BASE/api/calendar/events")
IDA=$(echo "$OA" | j .id); IDB=$(echo "$OB" | j .id); IDC=$(echo "$OC" | j .id)
chk "$(echo "$OA" | j .dayOrder)" null "new event has no day order"
chk "$(echo "$OC" | j .dayOrder)" 4 "event can be created with a day order"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events?from=2026-11-20&to=2026-11-20" | j ".events.filter(e=>['$IDA','$IDB','$IDC'].includes(e.id)).map(e=>e.title).join(',')")" "Order C,Order A,Order B" "a set day order sorts before unset titles"
chk "$(curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d '{"dayOrder":1}' "$BASE/api/calendar/events/$IDB" | j .dayOrder)" 1 "event day order can be patched on its own"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events/$IDB" | j .colour)" blue "day-order patch keeps the event colour"
chk "$(curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d '{"colour":"yellow"}' "$BASE/api/calendar/events/$IDB" | j .dayOrder)" 1 "colour patch keeps the event day order"
chk "$(code "${H[@]}" "${JS[@]}" -X PATCH -d '{"dayOrder":-1}' "$BASE/api/calendar/events/$IDA")" 400 "negative event day order refused"
chk "$(code "${H[@]}" "${JS[@]}" -X PATCH -d '{"dayOrder":1.5}' "$BASE/api/calendar/events/$IDA")" 400 "fractional event day order refused"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events/$IDA" | j .dayOrder)" null "refused day order is not stored"
ORD=$(curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d "{\"date\":\"2026-11-20\",\"ids\":[\"$IDC\",\"$IDB\",\"$IDA\"]}" "$BASE/api/calendar/order")
chk "$(echo "$ORD" | j ".events.map(e=>e.title).join(',')")" "Order C,Order B,Order A" "order endpoint returns the day in the new order"
chk "$(echo "$ORD" | j ".events.map(e=>e.dayOrder).join(',')")" "0,1,2" "order endpoint stores 0, 1, 2"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events?from=2026-11-20&to=2026-11-20" | j ".events.filter(e=>['$IDA','$IDB','$IDC'].includes(e.id)).map(e=>e.title).join(',')")" "Order C,Order B,Order A" "reloading the day keeps the saved order"
chk "$(code "${H[@]}" "${JS[@]}" -X PATCH -d "{\"date\":\"2026-11-21\",\"ids\":[\"$IDA\"]}" "$BASE/api/calendar/order")" 400 "order refuses an event that is not on that day"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events/$IDA" | j .dayOrder)" 2 "rejected order does not change the saved place"
chk "$(code "${H[@]}" "${JS[@]}" -X PATCH -d "{\"date\":\"2026-11-20\",\"ids\":[\"$IDA\",\"$IDA\"]}" "$BASE/api/calendar/order")" 400 "order refuses a repeated id"
chk "$(code "${H[@]}" "${JS[@]}" -X PATCH -d '{"date":"2026-11-20","ids":["nope"]}' "$BASE/api/calendar/order")" 400 "order refuses an unknown id shape"
chk "$(code "${H[@]}" "$BASE/api/calendar/order")" 405 "reading the order route is not allowed"
CLEARED=$(curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d '{"dayOrder":null}' "$BASE/api/calendar/events/$IDC")
chk "$(echo "$CLEARED" | j .dayOrder)" null "event day order can be cleared"
chk "$(echo "$CLEARED" | j .colour)" green "clearing day order keeps the colour"
MOVEDAY=$(curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d '{"start":"2026-11-22","end":null,"dayOrder":null}' "$BASE/api/calendar/events/$IDB")
chk "$(echo "$MOVEDAY" | j .start)" "2026-11-22" "moving an event can clear its day order in the same save"
chk "$(echo "$MOVEDAY" | j .dayOrder)" null "moved event no longer has a day order"
chk "$(echo "$MOVEDAY" | j .colour)" yellow "moved event keeps its colour"
JDATE=$(curl -sf "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"$NDATE\",\"clientName\":\"Date Co\",\"description\":\"Window vinyl\",\"colour\":\"blue\",\"calendarDate\":\"2026-09-14\"}" "$BASE/api/jobs")
JDATEID=$(echo "$JDATE" | j .id)
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/$NDATE" | j .start)" "2026-09-14" "Date on Calendar places the new job"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/$NDATE" | j .title)" "Window vinyl" "new job calendar label is the description"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/$NCOL" | j .title)" "" "job with no description has a blank calendar label"
curl -sf "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"T${RUN}L\",\"clientName\":\"Lines\",\"description\":\"Line one\nLine two\"}" "$BASE/api/jobs" >/dev/null
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/T${RUN}L" | j .title)" "Line one Line two" "calendar label uses the description on one line"
curl -sf "${H[@]}" -X DELETE "$BASE/api/jobs/T${RUN}L" >/dev/null
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/$NDATE" | j .colour)" blue "new job keeps its colour when a calendar date is set"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events?from=$TODAY&to=$TODAY" | j ".events.filter(e=>e.jobNumber==='$NDATE').length")" 0 "calendar date wins over the created day"
echo "$JDATE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s); if(Object.prototype.hasOwnProperty.call(o,"calendarDate")||Object.prototype.hasOwnProperty.call(o,"colour")){console.error("leaked"); process.exit(1)}})' && pass "job create response does not include calendar date or colour" || fail "job create response leaked calendar fields"
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const o=d.jobOverrides[process.argv[2]]; if(!o||o.calendarDate!=="2026-09-14"||o.colour!=="blue") process.exit(1);' "$DATA/calendar-events.json" "$JDATEID" && pass "calendar date and colour are stored on the job override" || fail "calendar date override"
node -e 'const fs=require("fs"); const p=process.argv[1]; const j=JSON.parse(fs.readFileSync(p,"utf8")); j.dueAt="2026-01-02"; fs.writeFileSync(p, JSON.stringify(j,null,2));' "$DATA/jobs/$JDATEID.json"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/$NDATE" | j .start)" "2026-09-14" "Date on Calendar wins over a due date on the job"
chk "$(code "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"T${RUN}Z\",\"clientName\":\"Bad Date\",\"colour\":\"red\",\"calendarDate\":\"2026-02-31\"}" "$BASE/api/jobs")" 400 "new job refuses an invalid calendar date"
chk "$(code "${H[@]}" "$BASE/api/jobs/T${RUN}Z")" 404 "refused calendar date does not create the job"
JGREY=$(curl -sf "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"$NDAYG\",\"clientName\":\"Grey Date\",\"colour\":\"grey\",\"calendarDate\":\"2026-09-15\"}" "$BASE/api/jobs")
JGREYID=$(echo "$JGREY" | j .id)
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/$NDAYG" | j .start)" "2026-09-15" "grey new job still saves Date on Calendar"
node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); const o=d.jobOverrides[process.argv[2]]; if(!o||o.calendarDate!=="2026-09-15"||o.colour) process.exit(1);' "$DATA/calendar-events.json" "$JGREYID" && pass "grey is still not stored when a calendar date is" || fail "grey stored with calendar date"
chk "$(code "${H[@]}" "${JS[@]}" -X PATCH -d "{\"date\":\"2026-09-14\",\"ids\":[\"job-$JDATEID\",\"$IDA\"]}" "$BASE/api/calendar/order")" 400 "order refuses a mix of days"
SAME=$(curl -sf "${H[@]}" "${JS[@]}" -d '{"title":"With the job","allDay":true,"start":"2026-09-14","colour":"purple"}' "$BASE/api/calendar/events")
SID=$(echo "$SAME" | j .id)
MIXOK=$(curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d "{\"date\":\"2026-09-14\",\"ids\":[\"job-$JDATEID\",\"$SID\"]}" "$BASE/api/calendar/order")
chk "$(echo "$MIXOK" | j ".events.map(e=>e.kind).join(',')")" "job,event" "one save orders a job and a staff event"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/$NDATE" | j .dayOrder)" 0 "job day order is stored on the override"
ORDJOB=$(curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d '{"dayOrder":3}' "$BASE/api/calendar/jobs/$NDATE")
chk "$(echo "$ORDJOB" | j .dayOrder)" 3 "job day order can be patched on its own"
chk "$(echo "$ORDJOB" | j .start)" "2026-09-14" "job day-order patch keeps the calendar date"
chk "$(echo "$ORDJOB" | j .colour)" blue "job day-order patch keeps the colour"
chk "$(code "${H[@]}" "${JS[@]}" -X PATCH -d '{"dayOrder":"nope"}' "$BASE/api/calendar/jobs/$NDATE")" 400 "job day order must be a whole number"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/jobs/$NDATE" | j .dayOrder)" 3 "refused job day order is not stored"
HELD=$(curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d '{"date":"2026-09-16","dayOrder":null}' "$BASE/api/calendar/jobs/$NDATE")
chk "$(echo "$HELD" | j .start)" "2026-09-16" "moving a job can clear its day order"
chk "$(echo "$HELD" | j .dayOrder)" null "moved job has no day order"
chk "$(echo "$HELD" | j .colour)" blue "moved job keeps its colour"
curl -sf "${H[@]}" -X DELETE "$BASE/api/calendar/events/$IDA" >/dev/null
curl -sf "${H[@]}" -X DELETE "$BASE/api/calendar/events/$IDB" >/dev/null
curl -sf "${H[@]}" -X DELETE "$BASE/api/calendar/events/$IDC" >/dev/null
curl -sf "${H[@]}" -X DELETE "$BASE/api/calendar/events/$SID" >/dev/null

echo "6) Misc"
grep -q "$NB" "${DATA_DIR:-$(dirname "$0")/../data}/notifications.log" && pass "logged in notifications.log"
chk "$(code "$BASE/api/review/NOPE$RUN")" 404 "unknown job number 404"
if [ -n "$BP" ]; then chk "$(code "$ORIGIN/api/review/$NA")" 403 "stripped prefix still refuses a bare job number"; chk "$(code "$ORIGIN/api/review/$NA?k=$ATOK")" 200 "stripped prefix accepts the secure key"; fi
if [ -z "${KEEP:-}" ]; then for n in "$NA" "$NB" "$NP" "$NC" "$NCOL" "$NGRY" "$NDATE" "$NDAYG"; do curl -sf "${H[@]}" -X DELETE "$BASE/api/jobs/$n" >/dev/null; done; pass "test jobs cleaned up (KEEP=1 to keep them)"; fi
echo; echo "ALL GOOD. Entry: $BASE  ·  Studio: $BASE/studio  ·  Jobs: $BASE/$NA  $BASE/$NB"
