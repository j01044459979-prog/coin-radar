#!/usr/bin/env bash
# RICH 300 설치(clasp): 기존 RICH300 Apps Script 프로젝트의 내용을 설치 파일 3개로 교체한다. 사용자는 Google 로그인·승인과 확인 입력만 한다(코드 복사 없음).
#  사용(Google Cloud Shell 권장, https://shell.cloud.google.com). 파일로 받아 실행해야 로그인 프롬프트가 키보드 입력을 받는다('| bash' 로 실행하면 clasp 가 스크립트 자신을 입력으로 읽어 로그인이 실패한다):
#    ID=<편집기 주소의 프로젝트 ID>; C=<커밋 40자>; curl -fsSLo /tmp/r300.sh https://raw.githubusercontent.com/j01044459979-prog/coin-radar/$C/rich300/deploy/clasp-install.sh && bash /tmp/r300.sh "$ID" "$C"
#  인자 2개는 모두 필수(기본값 없음): ① 스크립트(프로젝트) ID — 편집기 주소 https://script.google.com/home/projects/<ID>/edit 의 <ID>  ② 설치 파일이 있는 커밋(40자). 스크립트도 설치 파일도 이 커밋 그대로만 쓴다.
#  순서: 인자·커밋 검증 → 설치 파일 SHA-256·문법·매니페스트 확인 → clasp 로그인 → 현재 내용 *백업*(~/rich300-backup-…, 남겨 둠) → 대상·변경 파일 표시 + 프로젝트 확인 → push → 다시 내려받아 일치 확인 → 실패하면 *백업으로 복구* → 로그아웃(토큰 삭제)
#  하지 않는 일: 새 프로젝트 생성, 프로젝트 삭제, 웹 앱 배포, Telegram 호출, 스크립트 속성 변경. 비밀값을 다루지 않는다.
#  로그인: Cloud Shell(원격)에서는 clasp 의 '--no-localhost' 방식 — 주소를 열어 승인하면 열리지 않는 페이지(localhost)로 이동하고, 그 주소창의 URL 전체(code= 포함)를 이 터미널에 붙여 넣는다(채팅에 공유하지 말 것). 내 PC(브라우저와 같은 기기)에서 실행하면 붙여 넣기 없이 자동 완료된다.
#  권한: 기본 clasp 로그인은 cloud-platform 등 넓은 범위를 요청하므로, 이 스크립트는 임시 폴더의 매니페스트로 script.projects·userinfo.email 두 범위만 요청한다(--use-project-scopes). 부족하면 RICH300_SCOPES=default 로 기본 범위 사용.
#  시험·자동화용 환경 변수: RICH300_CONFIRM(확인 값 = ID 마지막 6글자), RICH300_TTY(키보드 입력 장치 대체, 기본 /dev/tty), RICH300_LOGIN(paste|local), RICH300_SCOPES(default), RICH300_SRC_DIR(로컬 저장소 사본, 시험 전용), RICH300_REPO, RICH300_CLASP(clasp 명령 대체), RICH300_CLASP_VERSION(npx 로 받을 때 버전, 기본 3.4.1 — PATH 에 clasp 3.x 가 있으면 그것을 씀).
#  push 실패 시: clasp 가 가린 Google 오류 본문을 Apps Script API 직접 호출(projects.updateContent)로 그대로 보여 주고, 그 호출이 성공하면 반영된 것으로 보고 다시 내려받아 확인한다. 실패하면 원격이 바뀌지 않았는지 확인하고 백업 기준으로 복구한다. API 시험용: RICH300_API_BASE, RICH300_TOKEN_URL, RICH300_CLASPRC.
set -euo pipefail
SCRIPT_ID="${1:-}"; COMMIT="${2:-}"
REPO="${RICH300_REPO:-https://github.com/j01044459979-prog/coin-radar.git}"
CLASP_PIN="${RICH300_CLASP_VERSION:-3.4.1}"
# clasp: 이미 설치된 clasp 3.x(Cloud Shell 에서 쓰던 것)를 그대로 쓴다. 없거나 3.x 가 아니면 고정 버전을 npx 로 쓴다(로그인한 clasp 와 push 하는 clasp 버전이 달라지지 않게).
if [[ -n "${RICH300_CLASP:-}" ]]; then CLASP="$RICH300_CLASP"
elif command -v clasp >/dev/null 2>&1 && [[ "$(clasp --version </dev/null 2>/dev/null | head -n1)" =~ ^3\. ]]; then CLASP="clasp"
else CLASP="npx -y @google/clasp@$CLASP_PIN"; fi
WORK="$(mktemp -d)"; BACKUP=""; WE_LOGGED_IN=0; TTY_DEV="${RICH300_TTY:-/dev/tty}"; TTY_OPEN=0
cleanup() { [[ "$WE_LOGGED_IN" == 1 ]] && { $CLASP logout </dev/null >/dev/null 2>&1 || true; }; rm -rf "$WORK"; }
trap cleanup EXIT
say() { printf '%s\n' "$*"; }
fail() { say "[FAIL] $*"; [[ -n "$BACKUP" ]] && say "백업 폴더: $BACKUP"; exit 1; }
say "(clasp: $CLASP)"
[[ -n "$SCRIPT_ID" && -n "$COMMIT" ]] || fail "사용법: bash -s -- <프로젝트ID> <커밋40자> (두 값 모두 필수, 기본값 없음). 프로젝트 ID 는 편집기 주소 https://script.google.com/home/projects/<ID>/edit 의 <ID> 입니다"
[[ "$SCRIPT_ID" =~ ^[A-Za-z0-9_-]{20,80}$ ]] || fail "프로젝트 ID 형식이 올바르지 않습니다"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail "커밋은 40자리 16진수 전체여야 합니다"
command -v node >/dev/null || fail "node 가 필요합니다(Cloud Shell 에는 기본 설치)"
write_clasp() { printf '{"scriptId":"%s","rootDir":".","fileExtension":"gs"}\n' "$SCRIPT_ID" > "$1/.clasp.json"; }
# Google Apps Script API 직접 호출(진단 겸 대체 경로): clasp 는 push 실패 때 API 오류 본문을 버리고 짧은 문장만 보여 주므로, 같은 요청(projects.updateContent)을 직접 보내 HTTP 상태·오류 본문(토큰은 출력하지 않음)을 그대로 보여 준다. 성공하면 clasp push 와 같은 결과다.
API_JS="$WORK/api-push.mjs"
cat > "$API_JS" <<'APIJS'
import fs from 'node:fs'; import path from 'node:path';
const [scriptId, dir] = process.argv.slice(2), env = process.env, say = (...a) => console.log(...a);
const API = env.RICH300_API_BASE || 'https://script.googleapis.com', TOK = env.RICH300_TOKEN_URL || 'https://oauth2.googleapis.com/token', rc = env.RICH300_CLASPRC || path.join(env.HOME, '.clasprc.json');
const show = async r => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, j, t }; };
const err = x => { const e = x.j && x.j.error; return e && typeof e === 'object' ? { status: e.status, message: e.message, details: e.details } : e ? { error: e, description: x.j.error_description } : x.t.slice(0, 1500); };
const hint = (st, msg = '') => st === 401 ? '로그인 토큰이 만료·취소됨 → 아래 명령으로 로그아웃 후 다시 실행: clasp logout' : st === 403 && /has not been used|disabled|SERVICE_DISABLED/i.test(msg) ? 'Apps Script API 가 꺼져 있음 → https://script.google.com/home/usersettings 에서 켜기(몇 분 걸릴 수 있음)' : st === 403 ? '권한 없음 → 이 프로젝트를 만든 같은 Google 계정으로 로그인했는지, 요청 권한(script.projects)이 승인됐는지 확인' : st === 404 ? '프로젝트 ID 가 틀리거나 이 계정에 없는 프로젝트' : st === 400 ? '요청 내용 거부(매니페스트·코드 형식 문제일 수 있음) — 위 오류 본문의 message 확인' : st === 429 ? '요청 한도 초과 — 잠시 후 다시' : '';
let store; try { store = JSON.parse(fs.readFileSync(rc, 'utf8')); } catch (e) { say('  인증 파일(' + rc + ')을 읽지 못했습니다: ' + e.message); process.exit(2); }
const c = (store.tokens && store.tokens.default) || (store.token && store.oauth2ClientSettings ? { ...store.token, client_id: store.oauth2ClientSettings.clientId, client_secret: store.oauth2ClientSettings.clientSecret } : null) || (store.refresh_token ? store : null);
if (!c) { say('  인증 파일에 로그인 정보가 없습니다 — clasp login 을 다시 하세요'); process.exit(2); }
let access = c.access_token;
if (c.refresh_token && c.client_id && c.client_secret) {
  const r = await show(await fetch(TOK, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: 'refresh_token' }) }));
  if (r.status !== 200) { say('  토큰 갱신 실패: HTTP ' + r.status + ' ' + JSON.stringify(err(r))); say('  → ' + hint(401)); process.exit(3); }
  access = r.j.access_token; say('  토큰 갱신 OK — 승인된 권한 범위: ' + (r.j.scope || '(알 수 없음)').split(' ').map(x => x.replace('https://www.googleapis.com/auth/', '')).join(', '));
}
if (!access) { say('  액세스 토큰이 없습니다 — clasp login 을 다시 하세요'); process.exit(2); }
const TYPES = { gs: 'SERVER_JS', js: 'SERVER_JS', html: 'HTML', json: 'JSON' }, files = [];
for (const f of fs.readdirSync(dir).sort()) { if (f === '.clasp.json' || f.startsWith('.')) continue; const ext = f.split('.').pop(), name = f.slice(0, -(ext.length + 1)); if (!TYPES[ext] || (ext === 'json' && name !== 'appsscript')) continue; files.push({ name, type: TYPES[ext], source: fs.readFileSync(path.join(dir, f), 'utf8') }); }
if (!files.some(f => f.name === 'appsscript')) { say('  appsscript.json 이 없어 보내지 않습니다'); process.exit(2); }
say('  전송 대상 ' + files.length + '개: ' + files.map(f => f.name + '(' + f.type + ',' + Buffer.byteLength(f.source) + 'B)').join(', '));
const r = await show(await fetch(API + '/v1/projects/' + encodeURIComponent(scriptId) + '/content', { method: 'PUT', headers: { authorization: 'Bearer ' + access, 'content-type': 'application/json' }, body: JSON.stringify({ files }) }));
if (r.status === 200) { say('  Apps Script API 응답: HTTP 200 (반영됨)'); process.exit(0); }
const e = err(r); say('  Apps Script API 응답: HTTP ' + r.status); say('  오류 본문: ' + (typeof e === 'string' ? e : JSON.stringify(e, null, 2).replace(/\n/g, '\n  '))); const h = hint(r.status, JSON.stringify(e)); if (h) say('  → ' + h); process.exit(4);
APIJS
api_push() {  # $1=폴더 — 종료코드 0=반영됨
  node "$API_JS" "$SCRIPT_ID" "$1" </dev/null
}
# 디렉터리에서 이름(확장자 제외)으로 파일 찾기: Code → Code.gs 또는 Code.js
find_src() { local d="$1" n="$2"; for e in gs js; do [[ -f "$d/$n.$e" ]] && { printf '%s' "$d/$n.$e"; return 0; }; done; return 1; }
# 키보드(터미널) 입력: '| bash' 로 실행되면 stdin 은 스크립트 자신이므로, 사용자 입력은 항상 터미널(fd 3)에서만 읽고 clasp 로그인에도 fd 3 을 물려 준다.
open_tty() { [[ "$TTY_OPEN" == 1 ]] && return 0; { exec 3<"$TTY_DEV"; } 2>/dev/null || return 1; TTY_OPEN=1; }
# ① 설치 파일: 지정한 커밋 그대로
if [[ -n "${RICH300_SRC_DIR:-}" ]]; then SRC="$RICH300_SRC_DIR/rich300/apps-script"
else
  command -v git >/dev/null || fail "git 이 필요합니다"
  git init -q "$WORK/repo" && git -C "$WORK/repo" remote add origin "$REPO" && git -C "$WORK/repo" fetch -q --depth 1 origin "$COMMIT" && git -C "$WORK/repo" checkout -q FETCH_HEAD || fail "커밋 $COMMIT 을 받지 못했습니다"
  [[ "$(git -C "$WORK/repo" rev-parse HEAD)" == "$COMMIT" ]] || fail "받은 커밋이 지정한 커밋과 다릅니다"
  SRC="$WORK/repo/rich300/apps-script"
fi
for f in Code.gs Fill.html appsscript.json MANIFEST.txt; do [[ -s "$SRC/$f" ]] || fail "설치 파일이 없습니다: $f"; done
mkdir -p "$WORK/push"; for f in Code.gs Fill.html appsscript.json; do
  want="$(awk -v n="$f" '$3==n {print $1}' "$SRC/MANIFEST.txt")"; got="$(sha256sum "$SRC/$f" | cut -d' ' -f1)"
  [[ -n "$want" && "$want" == "$got" ]] || fail "$f 가 MANIFEST 와 다릅니다(잘렸거나 손상)"; cp "$SRC/$f" "$WORK/push/$f"; done
node -e "process.exit(require('fs').readFileSync('$WORK/push/Code.gs','utf8').endsWith('\n}\n')?0:1)" || fail "Code.gs 끝부분이 완결되지 않았습니다"
node -e "new (require('vm').Script)(require('fs').readFileSync('$WORK/push/Code.gs','utf8'))" 2>/dev/null || fail "Code.gs 문법 검사 실패"
[[ -f "$SRC/../deploy/gas-compat.mjs" ]] || fail "Apps Script 호환 검사 도구(rich300/deploy/gas-compat.mjs)가 이 커밋에 없습니다"
COMPAT_OUT="$(node "$SRC/../deploy/gas-compat.mjs" "$WORK/push/Code.gs" 2>&1)" || fail "Code.gs 에 Apps Script 가 거부할 수 있는 최신 문법이 있습니다(push 하면 'Syntax error: ParseError' 로 실패): $(printf '%s' "$COMPAT_OUT" | head -n 5 | tr '\n' ' ')"
node -e "const m=JSON.parse(require('fs').readFileSync('$WORK/push/appsscript.json','utf8'));const w=m.webapp||{};if(w.access!=='MYSELF'||w.executeAs!=='USER_ACCESSING'||m.runtimeVersion!=='V8')process.exit(1)" || fail "매니페스트가 '나만 접근·접속한 사용자로 실행·V8' 이 아닙니다"
say "[PASS] 설치 파일 3개(커밋 ${COMMIT:0:12}): SHA-256·문법·매니페스트 확인"
# ② 로그인(이미 되어 있으면 건너뜀)
if [[ -s "$HOME/.clasprc.json" ]]; then say "(이미 clasp 로그인 상태입니다 — 기존 로그인을 사용하며 끝나도 지우지 않습니다)"
else
  open_tty || fail "터미널 입력을 사용할 수 없습니다. 안내된 대로 파일로 받아 'bash /tmp/r300.sh \"\$ID\" \"\$C\"' 형태로 실행하세요('| bash' 는 로그인 입력을 받을 수 없습니다). 아무것도 바꾸지 않았습니다"
  MODE="${RICH300_LOGIN:-}"; [[ -n "$MODE" ]] || { [[ -n "${CLOUD_SHELL:-}" || -n "${SSH_CONNECTION:-}" ]] && MODE=paste || MODE=local; }
  LOGIN_ARGS=(); [[ "$MODE" == paste ]] && LOGIN_ARGS+=(--no-localhost)
  mkdir -p "$WORK/login"; write_clasp "$WORK/login"
  if [[ "${RICH300_SCOPES:-}" == default ]]; then say "(경고: clasp 기본 권한 범위 사용 — cloud-platform 등 넓은 범위가 포함됩니다)"
  else printf '{"timeZone":"Asia/Seoul","runtimeVersion":"V8","oauthScopes":["https://www.googleapis.com/auth/script.projects","https://www.googleapis.com/auth/userinfo.email"]}\n' > "$WORK/login/appsscript.json"; LOGIN_ARGS+=(--use-project-scopes); fi
  say ""; say "Google 로그인: 아래에 나오는 주소를 열어 승인하세요(요청 권한: Apps Script 프로젝트 관리 + 이메일 확인)."
  if [[ "$MODE" == paste ]]; then say "승인하면 '사이트에 연결할 수 없음' 같은 페이지가 뜨는 것이 정상입니다. 그 페이지의 주소창에서 http://localhost:8888/?code=… 로 시작하는 URL 전체를 복사해 아래 프롬프트에 붙여 넣으세요. 이 URL 에는 일회용 승인 코드가 들어 있으니 채팅·메신저에 공유하지 마세요."; fi
  ( cd "$WORK/login" && $CLASP login ${LOGIN_ARGS[@]+"${LOGIN_ARGS[@]}"} <&3 ) || fail "로그인하지 못했습니다(붙여 넣은 URL 에 code= 가 있어야 합니다. 같은 명령을 다시 실행하세요)"
  WE_LOGGED_IN=1
fi
# 비교·판별 도구(값은 출력하지 않고 크기·해시 앞 12자리·줄 번호만 보여 준다)
cmp_dirs() {  # $1=기준 폴더 $2=확인 폴더 $3=verbose(1이면 차이 설명 출력). Code·Fill 은 줄바꿈(CRLF) 차이를 무시하고 내용 비교, 매니페스트는 의미(런타임·시간대·웹 앱 설정·권한 목록, 키 순서 무시)로 비교
  node -e '
const fs=require("fs"),path=require("path"),crypto=require("crypto"),[A,B,V]=process.argv.slice(1);
const find=(d,n,ex)=>ex.map(e=>path.join(d,n+"."+e)).find(p=>fs.existsSync(p));
const norm=s=>s.replace(/\r\n/g,"\n"),h=s=>crypto.createHash("sha256").update(s).digest("hex").slice(0,12),out=[];let bad=0;
for(const [n,ex] of [["Code",["gs","js"]],["Fill",["html"]]]){const pa=find(A,n,ex),pb=find(B,n,ex);
  if(!pa||!pb){bad++;out.push("  - 다름: "+n+" ("+(pa?"확인 쪽에 파일 없음":"기준 쪽에 파일 없음")+")");continue}
  const sa=norm(fs.readFileSync(pa,"utf8")),sb=norm(fs.readFileSync(pb,"utf8"));
  if(sa!==sb){bad++;const la=sa.split("\n"),lb=sb.split("\n");let i=0;while(i<la.length&&la[i]===lb[i])i++;out.push("  - 다름: "+n+" (기준 "+Buffer.byteLength(sa)+"바이트 sha="+h(sa)+", 확인 "+Buffer.byteLength(sb)+"바이트 sha="+h(sb)+", 첫 차이 "+(i+1)+"번째 줄)")}}
try{const ma=JSON.parse(fs.readFileSync(path.join(A,"appsscript.json"),"utf8")),mb=JSON.parse(fs.readFileSync(path.join(B,"appsscript.json"),"utf8"));
  const canon=o=>Array.isArray(o)?o.map(canon):o&&typeof o==="object"?Object.fromEntries(Object.keys(o).sort().map(k=>[k,canon(o[k])])):o;
  const pick=m=>canon({runtimeVersion:m.runtimeVersion,timeZone:m.timeZone,webapp:m.webapp||null,oauthScopes:[...(m.oauthScopes||[])].sort()});
  if(JSON.stringify(pick(ma))!==JSON.stringify(pick(mb))){bad++;out.push("  - 다름: appsscript.json (의미 비교: 런타임·시간대·웹 앱 설정·권한 목록 중 다른 항목이 있음)")}}
catch(e){bad++;out.push("  - 다름: appsscript.json (읽을 수 없음)")}
if(V==="1")for(const l of out)console.log(l);process.exit(bad?1:0)' "$1" "$2" "${3:-0}"
}
state_of() {  # $1=폴더 → bootstrap | installed | other | none
  local c; c="$(find_src "$1" Code || true)"; [[ -n "$c" ]] || { printf none; return 0; }
  if grep -q 'function rich300Install(' "$c"; then printf installed; elif grep -q 'function rich300Bootstrap(' "$c"; then printf bootstrap; else printf other; fi
}
state_label() { case "$1" in bootstrap) printf '부트스트랩 상태(설치 전)';; installed) printf '설치 완료 상태(rich300Install 있음)';; other) printf '기타(알 수 없는 내용)';; *) printf 'Code 없음';; esac; }
describe() { local c; c="$(find_src "$1" Code || true)"; [[ -n "$c" ]] && printf 'Code %s바이트 sha256=%s' "$(wc -c < "$c")" "$(sha256sum "$c" | cut -c1-12)"; }
POLL_TRIES="${RICH300_POLL_TRIES:-6}"; POLL_SLEEP="${RICH300_POLL_SLEEP:-5}"
poll_verify() {  # $1=기준 폴더 $2=결과 폴더(매번 새로 pull) — 서버 반영이 늦을 수 있어 몇 번 다시 읽는다
  local i; for ((i = 1; i <= POLL_TRIES; i++)); do
    rm -rf "$2"; mkdir -p "$2"; write_clasp "$2"
    if ( cd "$2" && $CLASP pull </dev/null >/dev/null 2>&1 ) && cmp_dirs "$1" "$2" 0; then return 0; fi
    [[ "$i" -lt "$POLL_TRIES" ]] && sleep "$POLL_SLEEP"
  done; return 1
}
# ③ 현재 내용 백업(남겨 둠) + 상태 판별 + 대상 확인
BACKUP="$HOME/rich300-backup-$(date +%Y%m%d-%H%M%S)-${SCRIPT_ID: -6}"; mkdir -p "$BACKUP"; write_clasp "$BACKUP"
( cd "$BACKUP" && $CLASP pull </dev/null ) || fail "현재 내용을 백업하지 못했습니다(프로젝트 ID·Google 계정 확인) — 아무것도 바꾸지 않았습니다"
RCODE="$(find_src "$BACKUP" Code || true)"
[[ -n "$RCODE" ]] || fail "대상 프로젝트에서 Code 파일을 찾지 못했습니다 — 프로젝트 ID 를 확인하세요. 아무것도 바꾸지 않았습니다"
if [[ "${RICH300_FORCE:-}" != 1 ]]; then
  grep -qE 'rich300Bootstrap|rich300Install' "$RCODE" && ! grep -qE 's0Compat|s0Tick|s0EngineBench|s0InstallTriggers' "$RCODE" || fail "이 프로젝트는 RICH300 부트스트랩/설치 상태가 아닙니다(다른 프로젝트일 수 있음). 아무것도 바꾸지 않았습니다"
fi
RSTATE="$(state_of "$BACKUP")"
say ""; say "대상 프로젝트 ID: $SCRIPT_ID"; say "현재 원격 상태: $(state_label "$RSTATE") — $(describe "$BACKUP")"; say "설치할 파일:      $(describe "$WORK/push")"
say "현재 원격 파일(백업됨: $BACKUP):"
( cd "$BACKUP" && for f in $(ls -A | grep -v '^\.clasp\.json$'); do printf '  - %s (%s바이트)\n' "$f" "$(wc -c < "$f")"; done )
if cmp_dirs "$WORK/push" "$BACKUP" 0; then
  say "[PASS] 이미 설치 완료 상태입니다 — 원격 Code·Fill·매니페스트가 설치 파일과 같아 변경하지 않았습니다(push 안 함). 백업: $BACKUP"
  say "다음: Apps Script 편집기를 새로 고침 → 함수 rich300Install 실행."; exit 0
fi
say "변경 계획:"
for n in Code:Code.gs Fill:Fill.html appsscript:appsscript.json; do b="${n%%:*}"; f="${n##*:}"; if ls "$BACKUP/$b."* >/dev/null 2>&1; then say "  - 교체: $f"; else say "  - 추가: $f"; fi; done
( cd "$BACKUP" && for f in $(ls -A | grep -v '^\.clasp\.json$'); do case "${f%.*}" in Code|Fill|appsscript) ;; *) say "  - 삭제(이 프로젝트에서만): $f";; esac; done )
EXPECT="${SCRIPT_ID: -6}"
if [[ "${RICH300_CONFIRM:-}" == "$EXPECT" ]]; then say "(확인 값이 환경 변수로 전달됨)"
else
  ANS=""; open_tty || fail "확인을 입력받을 수 없습니다(터미널 없음). 아무것도 바꾸지 않았습니다"
  printf '%s' "이 프로젝트가 맞으면 ID 의 마지막 6글자 [$EXPECT] 를 입력하세요(그 밖의 입력은 중단): "; read -r ANS <&3 || fail "확인을 입력받을 수 없습니다. 아무것도 바꾸지 않았습니다"
  [[ "$ANS" == "$EXPECT" ]] || fail "확인 값이 다릅니다 — 중단했습니다. 아무것도 바꾸지 않았습니다"
fi
# ④ push → 반영 확인(서버 반영 지연 대비 재시도) → 실패 시 복구
restore() {
  say "[복구] 백업 기준으로 원격을 확인합니다: $BACKUP"
  if poll_verify "$BACKUP" "$WORK/check0"; then say "[복구 불필요] 원격이 이미 설치 전 상태(백업과 같음)입니다 — 설치 파일이 반영되지 않았거나 이미 되돌아가 있습니다."; return 0; fi
  say "[복구] 백업으로 되돌립니다"
  ( cd "$BACKUP" && $CLASP push -f </dev/null ) || { say "[복구] clasp push 실패 — Apps Script API 직접 호출로 다시 시도"; api_push "$BACKUP" || true; }
  if poll_verify "$BACKUP" "$WORK/check"; then say "[복구 완료] 프로젝트를 설치 전 상태로 되돌리고 확인했습니다."
  else say "[복구 실패] 자동 복구가 끝나지 않았습니다. 백업 폴더: $BACKUP — 그 폴더에서 'clasp push -f' 로 수동 복구하거나, 편집기의 버전 기록에서 되돌리세요."; fi
}
write_clasp "$WORK/push"
PUSH_OUT="$( cd "$WORK/push" && $CLASP push -f </dev/null 2>&1 )" && PUSH_OK=1 || PUSH_OK=0
printf '%s\n' "$PUSH_OUT"
if [[ "$PUSH_OK" != 1 ]]; then
  say "[주의] clasp push 실패(위 메시지). clasp 는 Google 오류 본문을 줄여 보여 주므로, 같은 요청을 Apps Script API 로 직접 보내 실제 오류를 확인합니다(같은 파일 3개·같은 프로젝트, 토큰은 출력하지 않음):"
  if api_push "$WORK/push"; then say "[정보] clasp 대신 API 직접 호출로 반영했습니다 — 아래에서 다시 내려받아 일치를 확인합니다."
  else say "[FAIL] push 실패 — 위 'Apps Script API 응답/오류 본문'이 Google 이 돌려준 실제 오류입니다. 원격은 바뀌지 않았는지 확인합니다."; restore; exit 1; fi
fi
if printf '%s' "$PUSH_OUT" | grep -qi 'already up to date'; then say "[주의] clasp 가 '이미 최신'이라고 했지만 원격은 설치 파일과 달랐습니다(위 비교). 서버 반영 지연이거나 다른 프로젝트를 보고 있을 수 있어 다시 읽어 확인합니다."; fi
if poll_verify "$WORK/push" "$WORK/pull"; then
  say "[PASS] 반영 완료: Code·Fill 내용 일치, 매니페스트(런타임·시간대·웹 앱: 나만·접속한 사용자) 확인. 이전 내용 백업: $BACKUP"
else
  say "[FAIL] 반영 결과가 설치 파일과 다릅니다(재시도 ${POLL_TRIES}회 후에도):"; cmp_dirs "$WORK/push" "$WORK/pull" 1 || true
  say "다시 읽은 원격 상태: $(state_label "$(state_of "$WORK/pull")") — $(describe "$WORK/pull")"
  restore; exit 1
fi
BUILD_ID="$(awk '$1=="build" {print $2}' "$SRC/MANIFEST.txt" 2>/dev/null | head -n1)"
say "웹앱 반영: push 는 코드(HEAD)만 바꿉니다. 운영 주소(/exec)는 '배포된 버전'을 실행하므로 편집기 → 배포 → 배포 관리 → 기존 웹 앱 배포의 연필(편집) → 버전 '새 버전' → 배포 로 갱신하세요(주소·Deployment ID 는 그대로 유지됩니다). 갱신 뒤 <웹앱 주소>?p=health 의 '코드 빌드'가 ${BUILD_ID:-(확인 불가)} 이면 같은 버전입니다."
say "다음: Apps Script 편집기를 새로고침 → 함수 rich300Install 실행. (로그인 토큰은 이 셸에서 삭제합니다. 원하면 https://myaccount.google.com/permissions 에서 clasp 권한도 철회하세요.)"
