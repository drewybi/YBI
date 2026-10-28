#!/usr/bin/env bash
# End-to-end API smoke test.
# Usage: ORIGIN=http://localhost:4321 BASE_PATH=/proof KEY=ybi-proof bash scripts/smoke-test.sh
set -euo pipefail
ORIGIN=${ORIGIN:-http://localhost:4321}; BP=${BASE_PATH-/proof}; BASE="$ORIGIN$BP"; KEY=${KEY:-ybi-proof}; S="$(dirname "$0")/../samples"
H=(-H "X-Studio-Key: $KEY"); JS=(-H 'Content-Type: application/json')
RUN=$RANDOM; NA="T${RUN}A"; NB="T${RUN}B"; NP="T${RUN}P"   # unique test job numbers
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
echo "$caljs" | grep -qi 'calendar.google.com\|STAFF_CALENDAR_URL\|<iframe' && fail "studio calendar still points at Google or an embed" || pass "studio calendar does not use Google or an embed"
echo "$caljs" | grep -q '/api/calendar/events' && pass "studio calendar calls the studio API" || fail "calendar API missing from studio.js"
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
chk "$(echo "$EV" | j .start)" "2026-11-12T09:30" "start stays Melbourne wall time"
chk "$(echo "$EV" | j .notes)" "Bring proofs" "calendar notes stored"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events/$EID" | j .end)" "2026-11-12T10:15" "calendar event readable by id"
AD=$(curl -sf "${H[@]}" "${JS[@]}" -d '{"title":"Install week","allDay":true,"start":"2026-11-16","end":"2026-11-18","notes":"On site"}' "$BASE/api/calendar/events")
AID=$(echo "$AD" | j .id)
chk "$(echo "$AD" | j .allDay)" true "all-day calendar event created"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events?from=2026-11-17&to=2026-11-17" | j ".events.filter(e=>e.id==='$AID').length")" 1 "multi-day event appears inside its range"
chk "$(curl -sf "${H[@]}" "$BASE/api/calendar/events?from=2026-11-19&to=2026-11-19" | j ".events.filter(e=>e.id==='$AID').length")" 0 "multi-day event is outside a later day"
chk "$(curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d '{"title":"Smoke deadline moved","allDay":true,"start":"2026-11-13","end":null,"notes":"All day now"}' "$BASE/api/calendar/events/$EID" | j .start)" "2026-11-13" "calendar event updated"
chk "$(code "${H[@]}" -X DELETE "$BASE/api/calendar/events/$EID")" 200 "calendar event deleted"
chk "$(code "${H[@]}" "$BASE/api/calendar/events/$EID")" 404 "deleted calendar event is gone"
chk "$(code "${H[@]}" -X DELETE "$BASE/api/calendar/events/$AID")" 200 "all-day calendar event deleted"
chk "$(code "${H[@]}" "$BASE/api/calendar/nope")" 404 "unknown calendar route 404"

echo "6) Misc"
grep -q "$NB" "${DATA_DIR:-$(dirname "$0")/../data}/notifications.log" && pass "logged in notifications.log"
chk "$(code "$BASE/api/review/NOPE$RUN")" 404 "unknown job number 404"
if [ -n "$BP" ]; then chk "$(code "$ORIGIN/api/review/$NA")" 403 "stripped prefix still refuses a bare job number"; chk "$(code "$ORIGIN/api/review/$NA?k=$ATOK")" 200 "stripped prefix accepts the secure key"; fi
if [ -z "${KEEP:-}" ]; then for n in "$NA" "$NB" "$NP"; do curl -sf "${H[@]}" -X DELETE "$BASE/api/jobs/$n" >/dev/null; done; pass "test jobs cleaned up (KEEP=1 to keep them)"; fi
echo; echo "ALL GOOD. Entry: $BASE  ·  Studio: $BASE/studio  ·  Jobs: $BASE/$NA  $BASE/$NB"
