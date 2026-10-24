// R8 배포 준비 로직(순수 함수): 테스트/운영 프로젝트 분리 가드, 배포 자가 점검(비밀값 없이 상태만).
//  · 환경 이름(RICH300_ENV)은 test 또는 prod. 시트 Meta 의 envName 표식과 일치해야 한다(운영 데이터가 테스트 프로젝트에, 또는 그 반대로 연결되는 실수를 막는다).
//  · Telegram 호출 가드: 운영은 RICH300_PROD_APPROVED=yes 일 때만, 테스트는 RICH300_TEST_TG_ALLOW=yes 일 때만 허용. 환경이 비어 있거나 다른 값이면 차단(fail-closed). 승인 전 어떤 메시지도 나가지 않는다.
//  · 점검 결과에는 *값이 아니라 존재 여부·길이 충족 여부*만 담는다(토큰·키·이메일·시트 ID를 출력하지 않는다).
import { StoreError, META_SHEET } from './schema.mjs';

export const DEPLOY_ENVS = Object.freeze(['test', 'prod']);
export function deployGate(p, method) {                    // 허용이면 null, 차단이면 사유 문자열
  if (p.env !== 'test' && p.env !== 'prod') return 'env-unset';
  if (p.env === 'prod') return p.prodApproved === 'yes' ? null : 'prod-not-approved';
  return p.testTgAllow === 'yes' ? null : 'test-tg-off';
}
export function deployMarkEnv(se, name) {                   // 최초 1회만 기록(이미 있으면 같은 값인지 확인)
  if (!DEPLOY_ENVS.includes(name)) throw new StoreError('VALIDATION', '환경 이름은 test 또는 prod');
  const cur = deployReadEnv(se);
  if (cur !== null) { if (cur !== name) throw new StoreError('ENV_MISMATCH', `이 시트는 ${cur} 환경으로 표시돼 있습니다`); return { status: 'unchanged' }; }
  se.sheets.append(META_SHEET, [['envName', name, String(se.now())]]); return { status: 'marked' };
}
export function deployReadEnv(se) { const v = se.sheets.rows(META_SHEET).filter(r => String(r[0]) === 'envName').map(r => String(r[1])); return v.length ? v[v.length - 1] : null; }
export function deployCheckEnv(se, expected) { const actual = deployReadEnv(se); return { ok: actual === expected, actual, expected }; }

// info: Apps Script가 모은 상태(값 없음). 반환: { items:[{id,level,ok,text}], fail, warn }
export function deploySelfTest(info) {
  const items = [], add = (id, ok, level, text) => items.push({ id, ok, level: ok ? 'ok' : level, text });
  add('env', DEPLOY_ENVS.includes(info.env), 'fail', `환경 이름 RICH300_ENV 는 test 또는 prod 여야 합니다(현재: ${DEPLOY_ENVS.includes(info.env) ? info.env : '미설정'})`);
  add('timezone', info.tz === 'Asia/Seoul', 'fail', `프로젝트 시간대는 Asia/Seoul 이어야 합니다(현재: ${info.tz ?? '알 수 없음'})`);
  add('v8', info.v8 === true, 'fail', 'V8 런타임(BigInt 지원)이 필요합니다');
  add('sheet', info.has.sheetId, 'fail', '스프레드시트 ID(RICH300_SHEET_ID)가 설정되어야 합니다');
  add('owner', info.has.ownerEmail, 'fail', '소유자 이메일(RICH300_OWNER_EMAIL)이 없으면 화면 접근이 모두 차단됩니다');
  add('ingest-key', info.has.ingestKey ? info.ingestKeyLen >= 32 : false, info.has.ingestKey ? 'fail' : 'warn', info.has.ingestKey ? '수신 키는 32자 이상이어야 합니다' : '수신 키(RICH300_INGEST_KEY)가 없어 신호 수신이 꺼져 있습니다');
  add('telegram-token', info.has.tgToken, 'warn', 'Telegram 봇 토큰(RICH300_TG_TOKEN)이 없어 Telegram 기능이 꺼져 있습니다');
  add('ui-url', info.has.uiUrl, 'warn', '입력 화면 URL(RICH300_UI_URL, https)이 없어 알림·버튼에 링크가 들어가지 않습니다');
  if (info.env === 'test') {
    add('test-no-prod-flags', !(info.flags.closeSendApproved || info.flags.prodApproved), 'fail', '테스트 프로젝트에 운영 승인 플래그(RICH300_PROD_APPROVED·RICH300_CLOSE_SEND_APPROVED)가 있습니다 — 제거하세요');
  }
  if (info.env === 'prod') add('prod-gate', true, 'warn', info.flags.prodApproved ? '운영 승인 플래그가 켜져 있어 Telegram 호출이 허용됩니다' : '운영 승인 전: Telegram 호출이 차단되어 있습니다(정상)');
  add('integrity', info.integrity ? info.integrity.ok : false, 'fail', info.integrity ? `저장소 무결성 문제: ${info.integrity.issues.join(', ')}` : '저장소를 열 수 없습니다');
  add('env-marker', info.envMarker ? info.envMarker.ok : false, 'fail', info.envMarker ? `시트의 환경 표식(${info.envMarker.actual ?? '없음'})이 이 프로젝트(${info.env})와 다릅니다` : '시트 환경 표식을 확인할 수 없습니다');
  add('owner-visible', info.owner.activeEmailVisible === true, 'warn', '실행 중 사용자 이메일을 읽을 수 없습니다 — "접속한 사용자로 실행" 배포가 아니면 UI 소유자 확인이 항상 거부됩니다(S0 ④ 확인 필요)');
  const need = info.expectTriggers ?? ['rich300CloseTick', 'rich300TgPoll', 'rich300BackupRun'], have = new Set(info.triggers);
  for (const t of need) add(`trigger-${t}`, have.has(t), 'warn', `트리거 ${t} 가 설치되어 있지 않습니다`);
  add('backup', info.backupCount > 0, info.env === 'prod' ? 'warn' : 'warn', '아직 백업이 없습니다');
  return { items, fail: items.filter(i => i.level === 'fail').length, warn: items.filter(i => i.level === 'warn').length };
}
