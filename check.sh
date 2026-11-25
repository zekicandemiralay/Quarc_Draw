#!/usr/bin/env bash
# ============================================================
#  Quarc Draw — Full System Diagnostic
#  Run from the project root: bash check.sh
# ============================================================

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

PASS=0; WARN=0; FAIL=0; FAILURES=()

ok()   { printf "  ${GREEN}✓${NC} %s\n" "$1"; PASS=$((PASS+1)); }
warn() { printf "  ${YELLOW}⚠${NC} %s\n" "$1"; WARN=$((WARN+1)); }
fail() { printf "  ${RED}✗${NC} %s\n" "$1"; FAIL=$((FAIL+1)); FAILURES+=("$1"); }
info() { printf "  ${DIM}·${NC} %s\n" "$1"; }
hdr()  { printf "\n${BOLD}${CYAN}── %s ${NC}\n" "$*"; }

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env 2>/dev/null || true
  set +a
else
  warn "No .env file found in current directory"
fi

HTTPS_PORT=${HTTPS_PORT:-4009}
BASE="https://localhost:${HTTPS_PORT}"

PROJECT=$(basename "$(pwd)" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_-]/_/g')
cid() { docker ps -q \
  --filter "label=com.docker.compose.project=${PROJECT}" \
  --filter "label=com.docker.compose.service=$1" | head -1; }
dexec() { local c; c=$(cid "$1"); shift; [ -n "$c" ] && docker exec -i "$c" "$@" || echo ""; }

printf "\n${BOLD}Quarc Draw — System Diagnostic${NC}  $(date '+%Y-%m-%d %H:%M:%S')\n"
if ! docker info &>/dev/null 2>&1; then
  printf "  ${RED}✗ Docker not accessible — re-run as root: sudo bash check.sh${NC}\n\n"
  exit 1
fi

# ════════════════════════════════════════════════════════════════════════
hdr "Docker Containers"
# ════════════════════════════════════════════════════════════════════════

for svc in backend frontend; do
  CID=$(docker ps -q --filter "label=com.docker.compose.service=${svc}" | head -1)
  if [ -z "$CID" ]; then
    CID_ANY=$(docker ps -aq --filter "label=com.docker.compose.service=${svc}" | head -1)
    [ -n "$CID_ANY" ] && fail "$svc: exists but is stopped/exited" \
                      || fail "$svc: container not found (never started?)"
    continue
  fi
  STATE=$(docker inspect --format '{{.State.Status}}' "$CID" 2>/dev/null || echo "unknown")
  if [ "$STATE" = "running" ]; then ok "$svc: running"; else fail "$svc: state=${STATE}"; fi
done

QA_CID=$(docker ps -q --filter "name=quarc-auth" | head -1)
if [ -n "$QA_CID" ]; then
  ok "quarc-auth: running (shared login service)"
else
  fail "quarc-auth: not running — logins will fail. See Quarc_Store/auth/README.md"
fi

# ════════════════════════════════════════════════════════════════════════
hdr "Network & HTTPS"
# ════════════════════════════════════════════════════════════════════════

HTTPS_CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "${BASE}/" 2>/dev/null || echo 0)
if [ "$HTTPS_CODE" = "200" ]; then
  ok "HTTPS:${HTTPS_PORT} serving frontend (200)"
else
  fail "HTTPS:${HTTPS_PORT} not responding (got: ${HTTPS_CODE})"
fi

CERT_EXP=$(echo | openssl s_client -connect "localhost:${HTTPS_PORT}" \
  -servername localhost 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || echo "")
if [ -n "$CERT_EXP" ]; then
  EXP_EPOCH=$(date -d "$CERT_EXP" +%s 2>/dev/null || echo 0)
  DAYS_LEFT=$(( (EXP_EPOCH - $(date +%s)) / 86400 ))
  if [ "$DAYS_LEFT" -gt 14 ]; then ok "TLS certificate valid for ${DAYS_LEFT} more days"
  elif [ "$DAYS_LEFT" -gt 0 ]; then warn "TLS certificate expires in ${DAYS_LEFT} days — renew it (tailscale cert)"
  else fail "TLS certificate has expired"; fi
else
  warn "Could not read the TLS certificate"
fi

for path in /sw.js /manifest.webmanifest /logo.png; do
  C=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "${BASE}${path}" 2>/dev/null || echo 0)
  [ "$C" = "200" ] && ok "${path} served" || fail "${path} not served (got ${C})"
done
# Every other route is client-side: nginx must hand it to the app, not 404.
C=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "${BASE}/some/app/route" 2>/dev/null || echo 0)
[ "$C" = "200" ] && ok "app routes fall back to index.html" || fail "/some/app/route returned ${C} (nginx should fall back to index.html)"

# ════════════════════════════════════════════════════════════════════════
hdr "Shared login (JWT)"
# ════════════════════════════════════════════════════════════════════════

AUTH_SECRET=$(docker exec quarc-auth printenv JWT_SECRET 2>/dev/null || echo "")
MY_SECRET=$(dexec backend printenv JWT_SECRET)
if [ -z "$AUTH_SECRET" ]; then
  warn "Could not read quarc-auth's JWT_SECRET to compare"
elif [ "$AUTH_SECRET" = "$MY_SECRET" ]; then
  ok "JWT_SECRET matches quarc-auth"
else
  fail "JWT_SECRET does NOT match quarc-auth — every request will be rejected. Copy it from Quarc_Store/auth/.env"
fi
[ "$MY_SECRET" = "insecure-default-change-in-production" ] && fail "JWT_SECRET is still the insecure default"

C=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "${BASE}/api/auth/me" 2>/dev/null || echo 0)
[ "$C" = "401" ] && ok "/api/auth/me reaches quarc-auth (401 without a login)" || fail "/api/auth/me answered ${C} — nginx cannot reach quarc-auth (expected 401)"

# ════════════════════════════════════════════════════════════════════════
hdr "API"
# ════════════════════════════════════════════════════════════════════════

H=$(curl -sk --max-time 5 "${BASE}/api/health" 2>/dev/null)
echo "$H" | grep -q '"ok":true' && ok "/api/health" || fail "/api/health did not answer ok (${H:-no response})"
for p in /api/ping /api/docs /api/events; do
  C=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "${BASE}${p}" 2>/dev/null || echo 0)
  [ "$C" = "401" ] && ok "${p} requires a login (401)" || fail "${p} answered ${C} without a login — expected 401"
done

# ════════════════════════════════════════════════════════════════════════
hdr "Documents"
# ════════════════════════════════════════════════════════════════════════

BACKEND=$(cid backend)
if [ -n "$BACKEND" ]; then
  USERS=$(dexec backend sh -c 'ls /app/data/users 2>/dev/null | wc -l')
  DOCS=$(dexec backend sh -c 'ls /app/data/users/*/docs/*.qdraw 2>/dev/null | wc -l')
  info "accounts with documents: ${USERS:-0} · documents: ${DOCS:-0}"

  # Every document an index lists must exist on disk with the recorded size.
  BAD=$(dexec backend node -e "
    const fs=require('fs'),path=require('path');
    const root='/app/data/users';let bad=0;
    for(const u of (fs.existsSync(root)?fs.readdirSync(root):[])){
      let idx={};try{idx=JSON.parse(fs.readFileSync(path.join(root,u,'index.json'),'utf8'));}catch{continue;}
      for(const [id,d] of Object.entries(idx)){
        try{ if(fs.statSync(path.join(root,u,'docs',id+'.qdraw')).size!==d.size) bad++; }catch{ bad++; }
      }
    }
    console.log(bad)" 2>/dev/null)
  [ "${BAD:-?}" = "0" ] && ok "every listed document exists on disk with the right size" || fail "${BAD:-?} document(s) are missing or damaged on disk (restore data/ from a backup)"

  TMP=$(dexec backend sh -c 'ls /app/data/users/*/docs/*.tmp 2>/dev/null | wc -l')
  [ "${TMP:-0}" = "0" ] && ok "no half-finished uploads" || info "${TMP} upload(s) in progress or interrupted"

  USED=$(dexec backend sh -c 'du -sh /app/data 2>/dev/null | cut -f1')
  info "data volume: ${USED:-?}"
  FREE=$(dexec backend sh -c "df -P /app/data | awk 'NR==2{print \$5}'" | tr -d '%')
  if [ -n "$FREE" ] && [ "$FREE" -ge 90 ] 2>/dev/null; then fail "the disk is ${FREE}% full — uploads will fail"
  elif [ -n "$FREE" ] && [ "$FREE" -ge 80 ] 2>/dev/null; then warn "the disk is ${FREE}% full"
  elif [ -n "$FREE" ]; then ok "disk usage ${FREE}%"; fi
fi

# ════════════════════════════════════════════════════════════════════════
hdr "Summary"
# ════════════════════════════════════════════════════════════════════════

printf "\n  ${GREEN}%d passed${NC}  ${YELLOW}%d warnings${NC}  ${RED}%d failed${NC}\n\n" "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf "${BOLD}Failures:${NC}\n"
  for f in "${FAILURES[@]}"; do printf "  ${RED}✗${NC} %s\n" "$f"; done
  echo
  exit 1
fi
exit 0
