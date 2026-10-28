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
chk "$(code "$BASE")" 200 "$BP entry page (find proof + studio login)"
chk "$(code "$BASE/studio")" 302 "$BP/studio redirects to login when signed out"
chk "$(code "$BASE/api/jobs")" 401 "studio API blocked without password"

echo "2) Job $NA — JPG → approve via $BP/$NA"
A=$(curl -sf "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"$NA\",\"clientName\":\"Sam Client\",\"clientCompany\":\"Bendigo Motor Show\",\"description\":\"A2 event poster, 170gsm gloss, qty 50\"}" "$BASE/api/jobs")
ATOK=$(echo "$A" | j .token); chk "$(echo "$A" | j .reviewUrl)" "$BASE/$NA" "public link is $BP/{jobNumber}"
chk "$(code "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"$NA\",\"clientName\":\"Dupe\"}" "$BASE/api/jobs")" 409 "duplicate job number refused (409)"
chk "$(code "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"${NA,,}\",\"clientName\":\"Dupe\"}" "$BASE/api/jobs")" 409 "duplicate check is case-insensitive"
chk "$(code "${H[@]}" "${JS[@]}" -d '{"jobNumber":"bad number!","clientName":"x"}' "$BASE/api/jobs")" 400 "invalid job number refused"
chk "$(code "${H[@]}" "${JS[@]}" -d '{"jobNumber":"studio","clientName":"x"}' "$BASE/api/jobs")" 400 "reserved job number refused"
curl -sf "${H[@]}" -H 'Content-Type: image/jpeg' --data-binary @"$S/poster-A2.jpg" "$BASE/api/jobs/$NA/versions?name=poster-A2.jpg" >/dev/null && pass "V1 JPG uploaded (studio API by job number)"
chk "$(code "$BASE/$NA")" 200 "client page $BP/$NA"
chk "$(curl -s "$BASE/api/review/$NA" | j .status)" awaiting_review "client sees awaiting_review"
chk "$(curl -s -o /dev/null -w '%{content_type}' "$BASE/$NA/file/v1")" image/jpeg "proof served at $BP/$NA/file/v1"
chk "$(curl -s -o /dev/null -w '%{redirect_url}' "$ORIGIN$BP/p/$ATOK")" "$BASE/$NA?k=$ATOK" "legacy /p/<token> → $BP/$NA?k=…"
chk "$(curl -sf "${JS[@]}" -d '{"type":"approve","name":"Sam Client","note":"Looks great","version":1}' "$BASE/api/review/$NA/decision" | j .status)" approved "approved"
chk "$(code "${JS[@]}" -d '{"type":"changes","name":"x","note":"y","version":1}' "$BASE/api/review/$NA/decision")" 409 "approved version locked (409)"

echo "3) Job $NB — 3-page PDF → changes + file → V2 → approve"
B=$(curl -sf "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"$NB\",\"clientName\":\"Jo Retailer\",\"description\":\"Spring catalogue, A4 3pp\"}" "$BASE/api/jobs")
curl -sf "${H[@]}" -H 'Content-Type: application/pdf' --data-binary @"$S/catalogue-V1.pdf" "$BASE/api/jobs/$NB/versions?name=catalogue-V1.pdf" >/dev/null && pass "V1 PDF uploaded"
ATT=$(curl -sf -H 'Content-Type: image/png' --data-binary @"$S/client-markup.png" "$BASE/api/review/$NB/attachments?name=client-markup.png" | j .id) && pass "client attachment uploaded"
chk "$(curl -sf "${JS[@]}" -d "{\"type\":\"changes\",\"name\":\"Jo Retailer\",\"note\":\"Back cover phone number is wrong — see markup.\",\"attachments\":[\"$ATT\"],\"stickies\":[{\"page\":2,\"x\":0.42,\"y\":0.18,\"text\":\"Fix the phone on page 2\"},{\"page\":1,\"x\":0.2,\"y\":0.7,\"text\":\"Move the logo up\"}],\"version\":1}" "$BASE/api/review/$NB/decision" | j .status)" changes_requested "changes requested"
chk "$(code "${JS[@]}" -d '{"type":"changes","name":"Jo","note":"x","version":1,"stickies":[{"page":1,"x":0.2,"y":0.2,"text":""}]}' "$BASE/api/review/$NB/decision")" 400 "sticky without text is refused"
SJ=$(curl -sf "${H[@]}" "$BASE/api/jobs/$NB")
chk "$(echo "$SJ" | j '.versions[0].feedback[0].attachments[0].name')" client-markup.png "studio sees note + attachment"
chk "$(echo "$SJ" | j '.versions[0].feedback[0].stickies[0].text')" "Fix the phone on page 2" "studio sees sticky text"
chk "$(echo "$SJ" | j '.versions[0].feedback[0].stickies[0].page')" 2 "studio sees sticky page"
chk "$(echo "$SJ" | j '.versions[0].feedback[0].stickies.length')" 2 "studio sees both stickies"
chk "$(code "$ORIGIN$(echo "$SJ" | j '.versions[0].feedback[0].attachments[0].url')")" 200 "attachment downloadable"
chk "$(code "${H[@]}" -X POST --data-binary 'x' "$BASE/api/jobs/$NB/versions?name=evil.exe")" 415 "non-proof file types rejected"
curl -sf "${H[@]}" -H 'Content-Type: application/pdf' --data-binary @"$S/catalogue-V2.pdf" "$BASE/api/jobs/$NB/versions?name=catalogue-V2.pdf&note=Phone%20number%20fixed" >/dev/null && pass "V2 uploaded"
C=$(curl -sf "$BASE/api/review/$NB"); chk "$(echo "$C" | j '.versions.length')/$(echo "$C" | j .status)" 2/awaiting_review "client sees V2, awaiting review"
chk "$(code "${JS[@]}" -d '{"type":"approve","name":"Jo","version":1}' "$BASE/api/review/$NB/decision")" 409 "stale-version decision blocked (409)"
chk "$(curl -sf "${JS[@]}" -d '{"type":"approve","name":"Jo Retailer","version":2}' "$BASE/api/review/$NB/decision" | j .status)" approved "V2 approved"

echo "4) Private job $NP — job number alone is not enough"
P=$(curl -sf "${H[@]}" "${JS[@]}" -d "{\"jobNumber\":\"$NP\",\"clientName\":\"Private Co\",\"access\":\"private\"}" "$BASE/api/jobs"); PTOK=$(echo "$P" | j .token)
curl -sf "${H[@]}" -H 'Content-Type: image/png' --data-binary @"$S/client-markup.png" "$BASE/api/jobs/$NP/versions?name=art.png" >/dev/null
chk "$(code "$BASE/api/review/$NP")" 403 "no key → 403"
chk "$(code "$BASE/$NP/file/v1")" 404 "file hidden without key"
chk "$(code "$BASE/api/review/$NP?k=$PTOK")" 200 "secure link ?k= works"
chk "$(code "$BASE/$NP/file/v1?k=$PTOK")" 200 "file with key works"
curl -sf "${H[@]}" "${JS[@]}" -X PATCH -d '{"access":"public"}' "$BASE/api/jobs/$NP" >/dev/null
chk "$(code "$BASE/api/review/$NP")" 200 "switching to public opens $BP/$NP"

echo "5) Misc"
grep -q "$NB" "${DATA_DIR:-$(dirname "$0")/../data}/notifications.log" && pass "logged in notifications.log"
chk "$(code "$BASE/api/review/NOPE$RUN")" 404 "unknown job number 404"
if [ -n "$BP" ]; then chk "$(code "$ORIGIN/api/review/$NA")" 200 "also works when a proxy strips the $BP prefix"; fi
if [ -z "${KEEP:-}" ]; then for n in "$NA" "$NB" "$NP"; do curl -sf "${H[@]}" -X DELETE "$BASE/api/jobs/$n" >/dev/null; done; pass "test jobs cleaned up (KEEP=1 to keep them)"; fi
echo; echo "ALL GOOD. Entry: $BASE  ·  Studio: $BASE/studio  ·  Jobs: $BASE/$NA  $BASE/$NB"
