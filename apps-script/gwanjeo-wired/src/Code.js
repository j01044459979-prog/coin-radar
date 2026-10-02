/*******************************************************
 * 관저중로점 유선 실적관리 V1
 *
 * - 데이터 원본: '유선_개통보고' 시트 (모든 월 누적, 적용월 열로 구분)
 * - 실적 분류: '유선_설정' 시트 (동판유형별 분류규칙)
 * - 선택 목록: '유선_목록' 시트 (작업자 / 사은품권종)
 * - 기존 월별 장표(26년 1월 등)는 읽지도 쓰지도 않음
 *******************************************************/

const SPREADSHEET_ID = '10RtgRZCz_0eOaW3FbAwHB7cxJ6GPfNGF1Eo5FdTtc6M';
const TZ = 'Asia/Seoul';

const SHEET_REPORT = '유선_개통보고';
const SHEET_RULES = '유선_설정';
const SHEET_LISTS = '유선_목록';
const SHEET_LEGACY_MAP = '유선_기존장표매핑';
const SHEET_LEGACY_STAT_MAP = '유선_기존장표실적매핑';

/*
 * 한 번의 요청 안에서 같은 시트 상단 헤더를 두 번 읽지 않도록 캐시
 */
const HEAD_CACHE_ = {};
function resetHeadCache_() {
  Object.keys(HEAD_CACHE_).forEach(k => { delete HEAD_CACHE_[k]; });
}
function headValues_(sh, scan, lastCol) {
  const key = sh.getName() + '|' + scan + '|' + lastCol;
  if (!HEAD_CACHE_[key]) HEAD_CACHE_[key] = sh.getRange(1, 1, scan, lastCol).getDisplayValues();
  return HEAD_CACHE_[key];
}

/*
 * 유선_개통보고 열 구조 (순서 변경 금지, 추가는 맨 뒤에)
 * text: true 인 열은 문자열로 저장 (앞자리 0 보존)
 */
const REPORT_COLUMNS = [
  { key: 'id',            title: '등록ID',          text: true },
  { key: 'createdAt',     title: '등록일시',        text: true },
  { key: 'month',         title: '적용월',          text: true },
  { key: 'worker',        title: '작업자' },
  { key: 'lineType',      title: '동판유형' },
  { key: 'accessNo',      title: '접속번호',        text: true },
  { key: 'holderPhone',   title: '핸드폰명의자',    text: true },
  { key: 'lineCount',     title: '동판회선수' },
  { key: 'lineCtns',      title: '동판회선CTN',     text: true },
  { key: 'customerName',  title: '인터넷명의자명' },
  { key: 'nameMatch',     title: '명의일치' },
  { key: 'guideMethod',   title: '불일치_내용안내방법' },
  { key: 'mismatchNote',  title: '불일치_참고사항' },
  { key: 'mismatchPhone', title: '불일치_연락처',   text: true },
  { key: 'gift',          title: '지급사은품' },
  { key: 'giftPhone',     title: '사은품발송번호',  text: true },
  { key: 'giftKind',      title: '사은품권종' },
  { key: 'giftProcess',   title: '사은품처리방식' },
  { key: 'gtt',           title: 'GTT' },
  { key: 'gttProcess',    title: 'GTT처리방식' },
  { key: 'rawText',       title: '원문보고' }
];

/*
 * 실적 항목 (유선_설정 B~E열 순서)
 */
const METRICS = [
  { key: 'newSub',   title: '순신규실적' },
  { key: 'newLine',  title: '순신규동판' },
  { key: 'newDong',  title: '신동' },
  { key: 'renewLine', title: '약갱동판' }
];

const UNCLASSIFIED = '미분류';

const DEFAULT_WORKERS = ['전명석', '박영빈', '김소명', '유병규', '황윤주'];
const DEFAULT_LINE_TYPES = ['UUUMIT'];
const DEFAULT_GIFT_KINDS = ['롯데'];


/*******************************************************
 * 웹앱 진입
 *******************************************************/
function doGet() {
  return HtmlService
    .createHtmlOutputFromFile('index')
    .setTitle('관저중로점 유선 실적관리')
    .addMetaTag(
      'viewport',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'
    );
}


/*******************************************************
 * 공통
 *******************************************************/
function ss_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function str_(v) {
  return String(v == null ? '' : v).trim();
}

function digits_(v) {
  return str_(v).replace(/\D/g, '');
}

/*
 * 휴대폰 번호 표시 형식 (숫자만 받아 010-1234-5678)
 * 형식이 맞지 않으면 입력값 그대로 둠
 */
function formatPhone_(v) {
  const d = digits_(v);
  if (/^01\d{8,9}$/.test(d)) {
    return d.length === 11
      ? d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7)
      : d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
  }
  return str_(v);
}

function validMonth_(m) {
  return /^20\d{2}-(0[1-9]|1[0-2])$/.test(str_(m));
}

/*
 * 시트에 저장된 적용월 값 → 'yyyy-MM'
 * (문자열로 저장하지만 혹시 날짜로 바뀐 경우도 처리)
 */
function monthOf_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, TZ, 'yyyy-MM');
  }
  return str_(v);
}

function currentMonth_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
}


/*******************************************************
 * 관리 시트 준비 (없을 때만 새로 만듦, 기존 시트는 건드리지 않음)
 *******************************************************/
function ensureSheets_(ss) {

  let report = ss.getSheetByName(SHEET_REPORT);
  if (!report) {
    report = ss.insertSheet(SHEET_REPORT);
    report.getRange(1, 1, 1, REPORT_COLUMNS.length)
      .setValues([REPORT_COLUMNS.map(c => c.title)])
      .setFontWeight('bold');
    REPORT_COLUMNS.forEach((c, i) => {
      if (c.text) {
        report.getRange(2, i + 1, report.getMaxRows() - 1, 1).setNumberFormat('@');
      }
    });
    report.setFrozenRows(1);
  } else {
    migrateReportSheet_(report);
  }

  let rules = ss.getSheetByName(SHEET_RULES);
  if (!rules) {
    rules = ss.insertSheet(SHEET_RULES);
    rules.getRange(1, 1, 1, METRICS.length + 1)
      .setValues([['동판유형'].concat(METRICS.map(m => m.title))])
      .setFontWeight('bold');
    rules.getRange(2, 1, DEFAULT_LINE_TYPES.length, METRICS.length + 1)
      .setValues(DEFAULT_LINE_TYPES.map(t => [t].concat(METRICS.map(() => UNCLASSIFIED))));
    rules.getRange(1, METRICS.length + 3, 6, 1).setValues([
      ['[분류값 안내]'],
      ['미분류 : 아직 규칙 미확정 (집계 제외, 미분류로 표시)'],
      ['0 : 해당 실적 아님'],
      ['1 : 개통보고 1건당 1'],
      ['회선수 : 동판회선수만큼 (예: 3회선 → 3)'],
      ['A열에 동판유형을 추가하면 개통보고 선택 목록에 바로 나타납니다.']
    ]);
    rules.setFrozenRows(1);
  }

  let lists = ss.getSheetByName(SHEET_LISTS);
  if (!lists) {
    lists = ss.insertSheet(SHEET_LISTS);
    lists.getRange(1, 1, 1, 2).setValues([['작업자', '사은품권종']]).setFontWeight('bold');
    const n = Math.max(DEFAULT_WORKERS.length, DEFAULT_GIFT_KINDS.length);
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push([DEFAULT_WORKERS[i] || '', DEFAULT_GIFT_KINDS[i] || '']);
    }
    lists.getRange(2, 1, n, 2).setValues(rows);
    lists.setFrozenRows(1);
  }

  return { report: report, rules: rules, lists: lists };
}


/*
 * 기존 '유선_개통보고' 호환: 기존 열/데이터는 그대로 두고
 * 맨 뒤 헤더(원문보고 등)가 비어 있을 때만 제목을 채움
 */
function migrateReportSheet_(report) {
  const need = REPORT_COLUMNS.length;
  if (report.getMaxColumns() < need) {
    report.insertColumnsAfter(report.getMaxColumns(), need - report.getMaxColumns());
  }
  const head = report.getRange(1, 1, 1, need).getDisplayValues()[0];
  REPORT_COLUMNS.forEach((c, i) => {
    const cur = str_(head[i]);
    if (!cur) {
      report.getRange(1, i + 1).setValue(c.title).setFontWeight('bold');
    } else if (cur !== c.title) {
      throw new Error(
        "'" + SHEET_REPORT + "' " + (i + 1) + '번째 열 제목이 [' + cur + '] 입니다. [' +
        c.title + '] 이어야 합니다. 시트를 확인해주세요.'
      );
    }
  });
}


/*******************************************************
 * 설정 읽기
 *******************************************************/
function readColumnList_(sh, col) {
  if (sh.getLastRow() < 2) return [];
  const seen = {};
  return sh.getRange(2, col, sh.getLastRow() - 1, 1)
    .getDisplayValues()
    .map(r => str_(r[0]))
    .filter(v => {
      if (!v || seen[v]) return false;
      seen[v] = true;
      return true;
    });
}

/*
 * 분류값 해석
 *  미분류/빈칸 → null (미분류)
 *  0, 1, 2 ... → 건당 숫자
 *  회선수      → 'lines' (동판회선수만큼)
 *  그 외 값    → null (미분류로 취급)
 */
function parseRuleValue_(v) {
  const s = str_(v).replace(/\s/g, '');
  if (!s || s === UNCLASSIFIED) return null;
  if (s === '회선수' || s === '회선') return 'lines';
  if (/^\d+$/.test(s)) return Number(s);
  return null;
}

function readRules_(rulesSheet) {
  const rules = {};
  const types = [];
  if (rulesSheet.getLastRow() < 2) return { rules: rules, types: types };
  rulesSheet.getRange(2, 1, rulesSheet.getLastRow() - 1, METRICS.length + 1)
    .getDisplayValues()
    .forEach(r => {
      const type = str_(r[0]);
      if (!type || rules[type]) return;
      types.push(type);
      const rule = {};
      METRICS.forEach((m, i) => { rule[m.key] = parseRuleValue_(r[i + 1]); });
      rules[type] = rule;
    });
  return { rules: rules, types: types };
}


/*******************************************************
 * 개통보고 읽기
 *******************************************************/
function readReports_(reportSheet, month) {
  const last = reportSheet.getLastRow();
  if (last < 2) return [];
  const rows = reportSheet.getRange(2, 1, last - 1, REPORT_COLUMNS.length).getValues();
  const out = [];
  rows.forEach((r, i) => {
    if (monthOf_(r[2]) !== month) return;
    const o = { row: i + 2 };
    REPORT_COLUMNS.forEach((c, j) => { o[c.key] = r[j] instanceof Date ? monthOf_(r[j]) : r[j]; });
    o.month = monthOf_(r[2]);
    o.lineCount = Number(o.lineCount) || 0;
    out.push(o);
  });
  return out;
}


/*******************************************************
 * 실적 집계 (항상 원본 + 분류규칙으로 다시 계산)
 *******************************************************/
function computeStats_(reports, rules, workers, legacyRows, month) {
  const v2 = isV2Month_(month);

  const byWorker = {};
  const order = workers.slice();

  function blank(name) {
    const o = { worker: name };
    METRICS.forEach(m => { o[m.key] = 0; });
    return o;
  }

  order.forEach(w => { byWorker[w] = blank(w); });

  const unclassified = {};
  let unclassifiedCount = 0;

  reports.forEach(rep => {
    const w = str_(rep.worker) || '미지정';
    if (!byWorker[w]) {
      byWorker[w] = blank(w);
      order.push(w);
    }

    const type = str_(rep.lineType);
    const cls = v2 ? classifyReportV2_(rep, rules) : classifyReportV11_(rep, rules);
    const missing = cls.missing;
    METRICS.forEach(m => { byWorker[w][m.key] += cls.values[m.key]; });

    if (missing) {
      unclassifiedCount++;
      const label = type || '(유형 없음)';
      unclassified[label] = (unclassified[label] || 0) + 1;
    }
  });

  // 기존 장표 실적 (실적 열 직접 집계 결과) 합산
  (legacyRows || []).forEach(lr => {
    const w = str_(lr.worker) || '미지정';
    if (!byWorker[w]) {
      byWorker[w] = blank(w);
      order.push(w);
    }
    METRICS.forEach(m => { byWorker[w][m.key] += Number(lr[m.key]) || 0; });
  });

  const rows = order.map(w => byWorker[w]);
  const total = blank('합계');
  rows.forEach(r => METRICS.forEach(m => { total[m.key] += r[m.key]; }));

  return {
    metrics: METRICS,
    rows: rows,
    total: total,
    unclassifiedCount: unclassifiedCount,
    unclassifiedTypes: Object.keys(unclassified).map(k => ({ type: k, count: unclassified[k] }))
  };
}


/*******************************************************
 * 화면 데이터 (선택 월 기준)
 *******************************************************/
function getAppData(month) {
  resetHeadCache_();

  const m = validMonth_(month) ? str_(month) : currentMonth_();
  const ss = ss_();
  const sh = ensureSheets_(ss);

  const workers = readColumnList_(sh.lists, 1);
  const giftKinds = readColumnList_(sh.lists, 2);
  const ruleInfo = readRules_(sh.rules);
  const reports = readReports_(sh.report, m);

  const webList = reports
    .slice()
    .sort((a, b) => str_(b.createdAt).localeCompare(str_(a.createdAt)) || b.row - a.row)
    .map(r => ({
      source: 'webapp',
      id: str_(r.id),
      customerName: str_(r.customerName),
      accessNo: str_(r.accessNo),
      gift: str_(r.gift),
      giftPhone: str_(r.giftPhone),
      worker: str_(r.worker),
      lineType: str_(r.lineType),
      createdAt: str_(r.createdAt)
    }));

  /*
   * 기존 월별 장표(읽기 전용)의 같은 달 개통건을 화면에서만 합침
   * 같은 적용월 + 같은 접속번호(숫자 기준)는 웹앱 데이터 우선, 한 건만 표시
   */
  const webKeys = {};
  reports.forEach(r => { const k = digits_(r.accessNo); if (k) webKeys[k] = true; });
  const legacy = readLegacyMonth_(ss, m, true, webKeys);
  const seen = {};
  webList.forEach(r => { const k = digits_(r.accessNo); if (k) seen[k] = true; });
  const legacyList = [];
  legacy.rows.forEach(r => {
    const k = digits_(r.accessNo);
    if (k && seen[k]) return;
    if (k) seen[k] = true;
    legacyList.push(r);
  });
  const list = webList.concat(legacyList);

  return {
    month: m,
    today: currentMonth_(),
    workers: workers.length ? workers : DEFAULT_WORKERS,
    lineTypes: ruleInfo.types,
    giftKinds: giftKinds,
    list: list,
    legacy: {
      sheet: legacy.sheet,
      ok: legacy.ok,
      reason: legacy.reason,
      status: legacy.status,
      mapping: legacy.mapping,
      read: legacy.rows.length,
      shown: legacyList.length
    },
    legacyStats: legacy.stats ? {
      ok: legacy.stats.ok,
      sheet: legacy.stats.sheet,
      reason: legacy.stats.reason,
      excluded: legacy.stats.excluded
    } : null,
    stats: computeStats_(
      reports, ruleInfo.rules, workers.length ? workers : DEFAULT_WORKERS,
      legacy.stats && legacy.stats.ok ? legacy.stats.byWorker : [],
      m
    )
  };
}


/*******************************************************
 * 유선판매보고 원문 파싱
 * - 'ㄴ' 줄, 빈 줄, 제목줄은 무시 (ㄴ 뒤 전화번호는 동판회선CTN 추가분)
 * - 콜론 앞뒤 공백/전각 콜론 허용, 라벨 띄어쓰기 무시
 * - '처리방식' 2번 등장: GTT 이전 = 사은품처리방식, GTT 이후 = GTT처리방식
 * - 인식 못 한 값은 비워둠 (추측하지 않음)
 *******************************************************/
const LABELS = [
  { key: 'worker',        names: ['작업자'] },
  { key: 'lineType',      names: ['동판유형'] },
  { key: 'accessNo',      names: ['접속번호'] },
  { key: 'holderPhone',   names: ['핸드폰명의자', '휴대폰명의자', '핸드폰명의자번호'] },
  { key: 'lineCount',     names: ['동판회선수', '회선수'] },
  { key: 'lineCtns',      names: ['동판회선ctn', '동판ctn', '회선ctn'] },
  { key: 'customerName',  names: ['인터넷명의자명', '인터넷명의자'] },
  { key: 'guideMethod',   names: ['내용안내방법'] },
  { key: 'mismatchNote',  names: ['참고사항'] },
  { key: 'mismatchPhone', names: ['연락처'] },
  { key: 'gift',          names: ['지급사은품'] },
  { key: 'giftPhone',     names: ['사은품발송번호'] },
  { key: 'giftKind',      names: ['사은품권종'] },
  { key: 'giftProcess',   names: ['사은품처리방식'] },
  { key: 'gtt',           names: ['gtt'] },
  { key: 'gttProcess',    names: ['gtt처리방식'] },
  { key: 'process',       names: ['처리방식'] }
];

const REQUIRED = [
  { key: 'worker',       message: '작업자를 확인하지 못했습니다.' },
  { key: 'lineType',     message: '동판유형을 확인하지 못했습니다.' },
  { key: 'accessNo',     message: '접속번호를 확인하지 못했습니다.' },
  { key: 'customerName', message: '인터넷 명의자명을 확인하지 못했습니다.' }
];

function normLabel_(s) {
  return String(s || '')
    .replace(/\(?\s*불일치\s*시?\s*\)?/g, '')
    .replace(/[\s ]/g, '')
    .toLowerCase();
}

function labelKey_(label) {
  const n = normLabel_(label);
  for (let i = 0; i < LABELS.length; i++) {
    if (LABELS[i].names.indexOf(n) >= 0) return LABELS[i].key;
  }
  return '';
}

function cleanValue_(v) {
  const s = str_(v).replace(/^ㄴ+\s*/, '');
  return s === '-' ? '' : s;
}

function parseReportText_(text) {

  const raw = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
  const f = {
    worker: '', lineType: '', accessNo: '', holderPhone: '', lineCountText: '',
    customerName: '', guideMethod: '', mismatchNote: '', mismatchPhone: '',
    gift: '', giftPhone: '', giftKind: '', giftProcess: '', gtt: '', gttProcess: ''
  };
  const ctns = [];
  let lastKey = '';
  let seenGtt = false;
  let seenGiftProcess = false;

  raw.split('\n').forEach(line0 => {
    const line = line0.replace(/：/g, ':').trim();
    if (!line) return;

    const m = line.match(/^([^:]{1,30}):(.*)$/);
    const key = m ? labelKey_(m[1]) : '';

    if (!key) {
      // 'ㄴ 010 ...' 또는 번호만 있는 줄 → 직전 항목이 CTN 이면 추가 CTN
      const cont = line.replace(/^ㄴ+/, '').trim();
      if (lastKey === 'lineCtns' && cont && /^01\d{8,9}$/.test(digits_(cont))) {
        ctns.push(cont);
      }
      return;
    }

    const value = cleanValue_(m[2]);
    lastKey = key;

    switch (key) {
      case 'lineCtns':
        if (value) ctns.push(value);
        break;
      case 'lineCount':
        f.lineCountText = value;
        break;
      case 'gtt':
        seenGtt = true;
        f.gtt = value;
        break;
      case 'giftProcess':
        seenGiftProcess = true;
        f.giftProcess = value;
        break;
      case 'process':
        if (!seenGtt && !seenGiftProcess) {
          seenGiftProcess = true;
          f.giftProcess = value;
        } else {
          f.gttProcess = value;
        }
        break;
      default:
        if (f[key] === '') f[key] = value;
    }
  });

  if (f.accessNo && !digits_(f.accessNo)) {
    f.accessNo = '';
  }
  const missing = REQUIRED.filter(r => !str_(f[r.key])).map(r => r.message);

  const warnings = [];
  let lineCount = 0;
  if (/^\d{1,2}$/.test(digits_(f.lineCountText)) && digits_(f.lineCountText) === f.lineCountText.replace(/\s|회선|개/g, '')) {
    lineCount = Number(digits_(f.lineCountText));
  } else {
    warnings.push('동판회선수를 확인하지 못했습니다. (0회선으로 처리)');
  }
  if (ctns.length !== lineCount) {
    warnings.push('동판회선수 ' + lineCount + ' / 인식된 CTN ' + ctns.length + '개 — 확인해주세요.');
  }

  return {
    fields: {
      worker: f.worker,
      lineType: f.lineType,
      accessNo: f.accessNo,
      holderPhone: formatPhone_(f.holderPhone),
      lineCount: lineCount,
      lineCtns: ctns.map(formatPhone_),
      customerName: f.customerName,
      nameMatch: '', // 보고 양식에 일치/불일치 항목이 없어 판단하지 않음 (불일치 항목은 원문대로 저장)
      guideMethod: f.guideMethod,
      mismatchNote: f.mismatchNote,
      mismatchPhone: formatPhone_(f.mismatchPhone),
      gift: f.gift,
      giftPhone: formatPhone_(f.giftPhone),
      giftKind: f.giftKind,
      giftProcess: f.giftProcess,
      gtt: f.gtt,
      gttProcess: f.gttProcess
    },
    missing: missing,
    warnings: warnings
  };
}

/*
 * 같은 적용월 + 같은 접속번호(숫자만 비교) 존재 여부
 */
function isDuplicate_(sh, month, accessNo) {
  const key = digits_(accessNo) || str_(accessNo);
  const last = sh.getLastRow();
  if (!key || last < 2) return false;
  return sh.getRange(2, 3, last - 1, 4).getValues() // C 적용월 ~ F 접속번호
    .some(r => monthOf_(r[0]) === month && (digits_(r[3]) || str_(r[3])) === key);
}

/*
 * 참고 경고: 목록/설정에 없는 작업자·동판유형
 */
function lookupWarnings_(ss, fields, month) {
  const sh = ensureSheets_(ss);
  const out = [];
  const workers = readColumnList_(sh.lists, 1);
  const types = readRules_(sh.rules).types;
  if (fields.worker && workers.length && workers.indexOf(fields.worker) < 0) {
    out.push("작업자 '" + fields.worker + "' 는 직원 목록에 없습니다. (실적표에 별도 행으로 표시)");
  }
  if (fields.lineType && types.indexOf(fields.lineType) < 0) {
    if (isV2Month_(month) && isRenewDongType_(fields.lineType)) {
      // 2026-09 이후 약정갱신 동판(약동/약갱)은 자동 분류되므로 미분류 경고 없음
    } else {
      out.push("동판유형 '" + fields.lineType + "' 은 유선_설정에 없습니다. (미분류로 집계)");
    }
  }
  return { sh: sh, warnings: out };
}


/*******************************************************
 * [내용 확인] 분석만 (저장하지 않음)
 *******************************************************/
function previewReport(x) {
  const month = str_(x && x.month);
  if (!validMonth_(month)) throw new Error('적용월을 확인해주세요.');
  const text = String(x && x.text || '');
  if (!str_(text)) throw new Error('유선판매보고 내용을 붙여넣어 주세요.');

  const p = parseReportText_(text);
  const ss = ss_();
  const lw = lookupWarnings_(ss, p.fields, month);
  const duplicate = !!p.fields.accessNo && isDuplicate_(lw.sh.report, month, p.fields.accessNo);

  return {
    month: month,
    fields: p.fields,
    missing: p.missing,
    warnings: p.warnings.concat(lw.warnings),
    duplicate: duplicate,
    canSave: !p.missing.length && !duplicate
  };
}


/*******************************************************
 * [개통보고 저장] 원문을 서버에서 다시 분석해서 저장
 *******************************************************/
function saveReportText(x) {

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw new Error('다른 저장이 진행 중입니다. 잠시 후 다시 저장해주세요.');
  }

  try {

    const month = str_(x && x.month);
    if (!validMonth_(month)) throw new Error('적용월을 확인해주세요.');
    const text = String(x && x.text || '');
    if (!str_(text)) throw new Error('유선판매보고 내용을 붙여넣어 주세요.');

    const p = parseReportText_(text);
    if (p.missing.length) {
      throw new Error(p.missing.join(' '));
    }

    const ss = ss_();
    const sh = ensureSheets_(ss).report;

    if (isDuplicate_(sh, month, p.fields.accessNo)) {
      return {
        saved: false,
        duplicate: true,
        message: '동일한 접속번호의 개통보고가 이미 존재합니다.'
      };
    }

    const fld = p.fields;
    const now = new Date();
    const rec = Object.assign({}, fld, {
      id: 'W' + Utilities.formatDate(now, TZ, 'yyyyMMddHHmmss') + '-' + Math.random().toString(36).slice(2, 6),
      createdAt: Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm:ss'),
      month: month,
      lineCtns: fld.lineCtns.join(' / '),
      rawText: text
    });

    const row = Math.max(sh.getLastRow() + 1, 2);
    if (row > sh.getMaxRows()) {
      sh.insertRowsAfter(sh.getMaxRows(), 50);
    }

    // 문자열 열은 값을 쓰기 전에 텍스트 서식 지정 (앞자리 0 보존)
    REPORT_COLUMNS.forEach((c, i) => {
      if (c.text) sh.getRange(row, i + 1).setNumberFormat('@');
    });

    sh.getRange(row, 1, 1, REPORT_COLUMNS.length)
      .setValues([REPORT_COLUMNS.map(c => rec[c.key] == null ? '' : rec[c.key])]);

    SpreadsheetApp.flush();

    return {
      saved: true,
      id: rec.id,
      month: month,
      message: '유선판매보고가 저장되었습니다.'
    };

  } finally {
    lock.releaseLock();
  }
}


/*******************************************************
 * 기존 월별 장표 연동 (읽기 전용)
 * - '26년 6월' 같은 시트를 이름(trim)으로 찾음
 * - 열 위치는 추측하지 않음: 실제 헤더 글자로 4개 항목 열을 찾고,
 *   항목마다 정확히 1개 열이 확인될 때만 연결
 * - 결과는 '유선_기존장표매핑' 시트에 기록, 관리자가 상태를 '확정'으로
 *   바꾸고 열을 직접 지정하면 그 값을 우선 사용 (자동감지가 덮어쓰지 않음)
 * - 기존 장표에는 읽기(getValues/getDisplayValues)만 사용
 *******************************************************/
const LEGACY_FIELDS = [
  { key: 'customerName', title: '고객명' },
  { key: 'accessNo',     title: '접속번호' },
  { key: 'gift',         title: '고객혜택' },
  { key: 'giftPhone',    title: '사은품발송번호' }
];

const LEGACY_MAP_HEADERS = [
  '시트명', '헤더행', '데이터시작행',
  '고객명열', '접속번호열', '지급사은품열', '사은품수령번호열',
  '상태', '확인내용', '갱신일시'
];

const LEGACY_HEADER_SCAN_ROWS = 20;

function legacyMonthKey_(name) {
  const m = str_(name).match(/^(\d{2}|\d{4})년\s*(\d{1,2})월$/);
  if (!m) return '';
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return '';
  return (m[1].length === 2 ? '20' + m[1] : m[1]) + '-' + String(mm).padStart(2, '0');
}

function findLegacySheet_(ss, month) {
  const list = ss.getSheets().filter(sh => legacyMonthKey_(sh.getName()) === month);
  return list.length === 1 ? list[0] : (list.length > 1 ? 'MULTI' : null);
}

function colLetter_(c) {
  let s = '';
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}

function colIndex_(letter) {
  const t = str_(letter).toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(t)) return 0;
  return t.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
}

function normHeader_(v) {
  return str_(v).replace(/[\s ()\[\]]/g, '');
}

/*
 * 헤더 글자 → 항목 판정 (열 번호가 아니라 헤더 글자만 사용)
 */
const LEGACY_MATCHERS = {
  accessNo: t => t.indexOf('접속번호') >= 0,
  giftPhone: t =>
    t.indexOf('발송번호') >= 0 || t.indexOf('수령번호') >= 0 ||
    t.indexOf('사은품번호') >= 0 || (t.indexOf('사은품') >= 0 && t.indexOf('연락처') >= 0),
  gift: t =>
    t.indexOf('지급사은품') >= 0 ||
    (t.indexOf('사은품') >= 0 &&
      !/(번호|권종|발송|수령|처리|연락처|금액|합계|비용|단가)/.test(t)),
  customerName: t =>
    !/(번호|연락처|핸드폰|휴대폰|사은품|직원|작업자|담당)/.test(t) &&
    (/(고객명|인터넷명의자|명의자명|가입자명|고객성명|성명)/.test(t) || t === '고객' || t === '이름' || t === '고객이름')
};

function detectLegacyMapping_(sh) {

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) {
    return { ok: false, reason: '빈 시트' };
  }

  const scan = Math.min(LEGACY_HEADER_SCAN_ROWS, lastRow);
  const head = headValues_(sh, scan, lastCol);

  // 접속번호 헤더가 있는 행
  let hr = -1;
  for (let r = 0; r < head.length && hr < 0; r++) {
    if (head[r].some(v => LEGACY_MATCHERS.accessNo(normHeader_(v)))) hr = r;
  }
  if (hr < 0) {
    return { ok: false, reason: "1~" + scan + "행에서 '접속번호' 헤더를 찾지 못함" };
  }

  // 2단 헤더 대비: 헤더행 위 1행(묶음 제목), 아래 1행(하위 제목, 데이터가 아닐 때만)
  const accCols = head[hr].map((v, i) => LEGACY_MATCHERS.accessNo(normHeader_(v)) ? i : -1).filter(i => i >= 0);
  const below = hr + 1 < head.length ? head[hr + 1] : null;
  const belowIsHeader = below && accCols.every(i => digits_(below[i]).length < 8) &&
    below.some(v => /[가-힣A-Za-z]/.test(str_(v)) && digits_(v).length < 8);
  const headerRows = [hr - 1, hr, belowIsHeader ? hr + 1 : -1].filter(r => r >= 0 && r < head.length);

  const colText = [];
  for (let c = 0; c < lastCol; c++) {
    colText.push(headerRows.map(r => normHeader_(head[r][c])).filter(Boolean));
  }

  const cols = {};
  const headers = {};
  const problems = [];

  LEGACY_FIELDS.forEach(f => {
    // 같은 열에서 '접속번호'·'사은품수령번호'가 먼저 판정되도록 우선순위 적용
    const hits = [];

    // 지급사은품: 기존 장표 헤더 '고객혜택'을 최우선 후보로 사용
    if (f.key === 'gift') {
      colText.forEach((parts, c) => {
        if (parts.some(t => t.indexOf('고객혜택') >= 0)) {
          hits.push({ c: c + 1, text: parts.join(' / ') });
        }
      });
    }

    if (!hits.length) colText.forEach((parts, c) => {
      const own = parts.find(t => LEGACY_MATCHERS[f.key](t));
      if (!own) return;
      if (f.key === 'gift' && parts.some(t => LEGACY_MATCHERS.giftPhone(t))) return;
      if (f.key === 'customerName' && parts.some(t => LEGACY_MATCHERS.accessNo(t) || LEGACY_MATCHERS.giftPhone(t))) return;
      hits.push({ c: c + 1, text: parts.join(' / ') });
    });
    if (hits.length === 1) {
      cols[f.key] = hits[0].c;
      headers[f.key] = hits[0].text;
    } else if (!hits.length) {
      problems.push(f.title + ' 헤더를 찾지 못함');
    } else {
      problems.push(f.title + ' 후보 열이 여러 개 (' + hits.map(h => colLetter_(h.c) + ':' + h.text).join(', ') + ')');
    }
  });

  const headerEnd = headerRows[headerRows.length - 1] + 1; // 1-based 마지막 헤더행

  if (problems.length) {
    return { ok: false, reason: problems.join(' / '), headerRow: hr + 1, cols: cols, headers: headers };
  }

  // 데이터 시작행: 헤더 아래에서 접속번호 칸에 숫자 8자리 이상이 처음 나오는 행
  let dataStart = 0;
  if (lastRow > headerEnd) {
    const acc = sh.getRange(headerEnd + 1, cols.accessNo, lastRow - headerEnd, 1).getDisplayValues();
    for (let i = 0; i < acc.length; i++) {
      if (digits_(acc[i][0]).length >= 8) { dataStart = headerEnd + 1 + i; break; }
    }
  }

  return {
    ok: true,
    headerRow: hr + 1,
    dataStart: dataStart || headerEnd + 1,
    cols: cols,
    headers: headers,
    reason: ''
  };
}

function ensureLegacyMapSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_LEGACY_MAP);
  if (!sh) {
    sh = ss.insertSheet(SHEET_LEGACY_MAP);
    sh.getRange(1, 1, 1, LEGACY_MAP_HEADERS.length)
      .setValues([LEGACY_MAP_HEADERS])
      .setFontWeight('bold');
    sh.getRange(1, LEGACY_MAP_HEADERS.length + 2, 4, 1).setValues([
      ['[안내]'],
      ['상태 자동 : 헤더 글자로 4개 열을 모두 확인함 (웹앱에 표시)'],
      ['상태 감지실패 : 확인 못 한 항목이 있어 연결 안 함 → 열 문자(D 등)와 헤더행/데이터시작행을 입력하고 상태를 확정으로'],
      ['상태 확정 : 관리자가 지정한 값을 그대로 사용 (자동감지가 덮어쓰지 않음)']
    ]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readLegacyMapRows_(mapSheet) {
  const out = {};
  if (!mapSheet || mapSheet.getLastRow() < 2) return out;
  mapSheet.getRange(2, 1, mapSheet.getLastRow() - 1, LEGACY_MAP_HEADERS.length)
    .getDisplayValues()
    .forEach((r, i) => {
      const name = str_(r[0]);
      if (name) out[name] = { row: i + 2, values: r };
    });
  return out;
}

/*
 * 해당 월 기존 장표의 매핑 결정
 * - 매핑 시트에 '확정' 행이 있으면 그 값만 사용 (헤더 탐색 안 함)
 * - 아니면 해당 시트 상단 20행만 읽어 헤더 자동감지 (write=true 면 매핑 시트에 결과 기록)
 */
function resolveLegacyMapping_(ss, sh, write) {

  const name = str_(sh.getName());
  const mapSheet = write ? ensureLegacyMapSheet_(ss) : ss.getSheetByName(SHEET_LEGACY_MAP);
  const saved = readLegacyMapRows_(mapSheet)[name];

  if (saved && str_(saved.values[7]) === '확정') {
    const v = saved.values;
    const cols = {
      customerName: colIndex_(v[3]),
      accessNo: colIndex_(v[4]),
      gift: colIndex_(v[5]),
      giftPhone: colIndex_(v[6])
    };
    const dataStart = Number(v[2]) || 0;
    const bad = LEGACY_FIELDS.filter(f => !cols[f.key]).map(f => f.title);
    if (bad.length || dataStart < 1) {
      return { ok: false, status: '확정', reason: '확정 행 입력 확인 필요: ' + (bad.length ? bad.join(', ') + ' 열' : '데이터시작행') };
    }
    return { ok: true, status: '확정', headerRow: Number(v[1]) || 0, dataStart: dataStart, cols: cols, headers: {}, reason: '' };
  }

  const det = detectLegacyMapping_(sh);
  det.status = det.ok ? '자동' : '감지실패';

  if (write && mapSheet) {
    const c = det.cols || {};
    const rowVals = [
      name,
      det.headerRow || '',
      det.ok ? det.dataStart : '',
      c.customerName ? colLetter_(c.customerName) : '',
      c.accessNo ? colLetter_(c.accessNo) : '',
      c.gift ? colLetter_(c.gift) : '',
      c.giftPhone ? colLetter_(c.giftPhone) : '',
      det.status,
      det.ok
        ? LEGACY_FIELDS.map(f => f.title + '=' + (det.headers[f.key] || '')).join(' | ')
        : det.reason
    ];
    const prev = saved ? saved.values.slice(0, 9).map(str_) : null;
    if (!prev || prev.join('\u0001') !== rowVals.map(x => str_(x)).join('\u0001')) {
      const row = saved ? saved.row : Math.max(mapSheet.getLastRow() + 1, 2);
      mapSheet.getRange(row, 2, 1, 2).setNumberFormat('0');
      mapSheet.getRange(row, 1, 1, LEGACY_MAP_HEADERS.length).setValues([rowVals.concat([
        Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss')
      ])]);
    }
  }

  return det;
}

/*
 * 기존 장표에서 개통건 읽기 (읽기 전용)
 * 접속번호 칸에 숫자 8자리 이상 있는 행만 개통건으로 인정 (합계/빈 행 제외)
 */
/*
 * 헤더 셀이 가로 병합(묶음 제목)이면 그 병합 범위의 열 전체를 반환
 * 예: '고객혜택'이 L~N 3칸에 걸쳐 있으면 [L, M, N]
 * 병합이 아니면 [감지된 열] 그대로
 */
function headerSpanCols_(sh, col, dataStart) {
  if (dataStart <= 1) return [col];
  let best = null;
  sh.getRange(1, col, dataStart - 1, 1).getMergedRanges().forEach(m => {
    if (m.getColumn() === col && m.getNumColumns() > 1 &&
        str_(m.getDisplayValue()) &&
        (!best || m.getNumColumns() > best.getNumColumns())) {
      best = m;
    }
  });
  if (!best) return [col];
  const out = [];
  for (let c = best.getColumn(); c < best.getColumn() + best.getNumColumns(); c++) out.push(c);
  return out;
}

/*
 * 발송번호: 숫자 서식 셀이라 앞자리 0이 빠진 경우(1036803060)만 0 복원 후 010-xxxx-xxxx
 */
function legacyPhone_(v) {
  const s = str_(v);
  const d = digits_(s);
  if (/^10\d{8}$/.test(d) && d === s.replace(/[\s-]/g, '')) return formatPhone_('0' + d);
  return formatPhone_(s);
}

/*
 * 고객혜택 표시값: 숫자만 있으면 금액 형식(1,570,000원), 그 외는 장표 표시값 그대로
 */
function giftText_(v) {
  const s = str_(v);
  if (/^-?\d{4,}$/.test(s)) return Number(s).toLocaleString('ko-KR') + '원';
  return s;
}

/*
 * 기존 장표에서 개통건 읽기 (읽기 전용, 표시값 기준)
 * - 4개 항목 모두 같은 행에서 읽음
 * - 고객혜택/발송번호 헤더가 가로 병합이면 그 병합 아래 열들의 같은 행 값을 합쳐 표시
 * - 한 개통건이 세로 병합(여러 행)으로 되어 있으면 그 병합 범위 안에서 값을 찾음
 * - 접속번호 칸에 숫자 8자리 이상 있는 행만 개통건으로 인정 (합계/빈 행 제외)
 */
function readLegacyRows_(sh, map, sample) {
  const lastRow = sh.getLastRow();
  if (!map.ok || lastRow < map.dataStart) return [];
  const n = lastRow - map.dataStart + 1;
  const start = map.dataStart;

  // 항목별로 읽을 열 (가로 병합 헤더면 병합 범위 전체)
  const spans = {
    customerName: [map.cols.customerName],
    accessNo: [map.cols.accessNo],
    gift: headerSpanCols_(sh, map.cols.gift, start),
    giftPhone: headerSpanCols_(sh, map.cols.giftPhone, start)
  };

  const vals = {};
  const subHead = {};
  Object.keys(spans).forEach(k => {
    vals[k] = spans[k].map(c => sh.getRange(start, c, n, 1).getDisplayValues());
    // 병합 묶음일 때 하위 제목으로 값 구분: 묶음 제목 아래 헤더 영역에서 가장 가까운 글자
    subHead[k] = [''];
    if (spans[k].length > 1 && start > 1) {
      const group = str_(sh.getRange(1, spans[k][0], start - 1, 1).getDisplayValues()
        .map(r => r[0]).filter(v => str_(v)).shift() || '');
      subHead[k] = spans[k].map(c => {
        const colVals = sh.getRange(1, c, start - 1, 1).getDisplayValues().map(r => str_(r[0]));
        for (let r = colVals.length - 1; r >= 0; r--) {
          if (colVals[r]) return colVals[r] === group ? '' : colVals[r];
        }
        return '';
      });
    }
  });

  // 세로 병합된 개통건(접속번호 칸 기준): 시작행 → 끝행
  const recordEnd = {};
  sh.getRange(start, map.cols.accessNo, n, 1).getMergedRanges().forEach(m => {
    if (m.getNumRows() > 1) recordEnd[m.getRow() - start] = m.getRow() - start + m.getNumRows() - 1;
  });

  function cellText(k, i) {
    const end = recordEnd[i] != null ? recordEnd[i] : i;
    const parts = [];
    spans[k].forEach((c, j) => {
      let v = '';
      for (let r = i; r <= end && !v; r++) v = str_(vals[k][j][r][0]);
      if (!v) return;
      if (k === 'gift') v = giftText_(v);
      parts.push(subHead[k][j] && spans[k].length > 1 ? subHead[k][j] + ' ' + v : v);
    });
    return parts.join(' / ');
  }

  const month = legacyMonthKey_(sh.getName());
  const out = [];
  for (let i = 0; i < n; i++) {
    const accessNo = str_(vals.accessNo[0][i][0]);
    if (digits_(accessNo).length < 8) continue;
    const customerName = str_(vals.customerName[0][i][0]);
    if (/^(합계|소계|총계|계)$/.test(customerName.replace(/\s/g, ''))) continue;
    const row = start + i;
    const gift = cellText('gift', i);
    out.push({
      source: 'legacy',
      id: 'L-' + month + '-' + row,
      sheet: str_(sh.getName()),
      row: row,
      customerName: customerName,
      accessNo: accessNo,
      gift: gift,
      giftPhone: legacyPhone_(cellText('giftPhone', i))
    });
    if (sample && !sample.rows) {
      sample.rows = true;
      sample.text = row + '행 · ' + LEGACY_FIELDS.map(f =>
        f.title + '(' + spans[f.key].map(c => colLetter_(c) + row).join('~') + ')=' +
        (f.key === 'gift' ? gift : f.key === 'giftPhone' ? cellText('giftPhone', i) : str_(vals[f.key][0][i][0]) || '빈칸') || '빈칸'
      ).join(' | ');
    }
  }
  out.forEach(r => { r.worker = ''; r.lineType = ''; r.createdAt = ''; });
  // 최신 입력이 위로 (장표 아래쪽 행이 최근)
  return out.reverse();
}

function readLegacyMonth_(ss, month, write, webKeys) {
  const sh = findLegacySheet_(ss, month);
  if (!sh) {
    return { sheet: '', ok: false, status: '', reason: '기존 장표 없음', mapping: null, rows: [] };
  }
  if (sh === 'MULTI') {
    return { sheet: '', ok: false, status: '감지실패', reason: '같은 달 시트가 여러 개', mapping: null, rows: [] };
  }
  const map = resolveLegacyMapping_(ss, sh, write);
  const sample = {};
  const rows = map.ok ? readLegacyRows_(sh, map, sample) : [];
  const stats = webKeys
    ? (map.ok
      ? readLegacyStats_(sh, map, webKeys, resolveLegacyStatCols_(ss, sh, write))
      : { ok: false, sheet: str_(sh.getName()), reason: '개통리스트 매핑 미확정: ' + map.reason, excluded: 0 })
    : null;
  // 같은 장표 안에서 같은 접속번호가 반복되면 첫 건(최신)만
  const seen = {};
  const uniq = rows.filter(r => {
    const k = digits_(r.accessNo);
    if (seen[k]) return false;
    seen[k] = true;
    return true;
  });
  return {
    sheet: str_(sh.getName()),
    ok: !!map.ok,
    status: map.status,
    reason: map.reason || '',
    mapping: map.ok ? LEGACY_FIELDS.map(f => ({
      field: f.title,
      col: colLetter_(map.cols[f.key]),
      header: (map.headers && map.headers[f.key]) || ''
    })).concat([{ field: '헤더행/데이터시작행', col: (map.headerRow || '-') + ' / ' + map.dataStart, header: '' }]) : null,
    sample: sample.text || '',
    stats: stats,
    rows: uniq
  };
}

/*
 * 전체 기존 장표 연동 점검 (개통리스트 하단 '전체 월 점검' 버튼)
 */
function getLegacyStatus() {
  resetHeadCache_();
  const ss = ss_();
  return ss.getSheets()
    .map(sh => ({ sh: sh, month: legacyMonthKey_(sh.getName()) }))
    .filter(x => x.month)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(x => {
      const r = readLegacyMonth_(ss, x.month, true);
      return {
        month: x.month, sheet: r.sheet, ok: r.ok, status: r.status, reason: r.reason,
        mapping: r.mapping, count: r.rows.length, sample: r.sample,
        stats: diagnoseLegacyStats_(ss, x.month)
      };
    });
}


/*******************************************************
 * 실적 매핑 확인 (진단 전용, 읽기 전용)
 * - 선택한 월의 기존 장표 1개만 읽음
 * - 담당 직원 / 실적유형 후보 헤더와 실제 값·건수를 보여줌
 * - 분류규칙은 아직 확정 전이므로 실적사항 집계에는 반영하지 않음
 *******************************************************/
const STAT_STAFF_RE = /(직원|담당|작업자|판매자|개통자|영업자)/;
const STAT_TYPE_RE = /(유형|구분|실적|상품|가입|동판|요금제|순신규|신동|약갱)/;
const STAT_EXCLUDE_RE = /(번호|연락처|핸드폰|휴대폰|고객명|명의자|사은품|고객혜택|발송|수령|금액|예산|합계|비고|메모)/;

/*
 * 헤더 영역 분석: '접속번호' 행 기준 위 1행 + 해당 행 + (하위 제목이면) 아래 1행
 */
function legacyHeaderColumns_(sh, dataStart) {
  const lastCol = sh.getLastColumn();
  const scan = Math.min(LEGACY_HEADER_SCAN_ROWS, Math.max(dataStart - 1, 1), sh.getLastRow());
  const head = sh.getRange(1, 1, scan, lastCol).getDisplayValues();
  let hr = -1;
  for (let r = 0; r < head.length && hr < 0; r++) {
    if (head[r].some(v => LEGACY_MATCHERS.accessNo(normHeader_(v)))) hr = r;
  }
  if (hr < 0) return [];
  const rows = [hr - 1, hr, hr + 1].filter(r => r >= 0 && r < head.length);
  const cols = [];
  for (let c = 0; c < lastCol; c++) {
    const parts = rows.map(r => normHeader_(head[r][c])).filter(Boolean);
    if (parts.length) cols.push({ col: c + 1, parts: parts, text: parts.join(' / ') });
  }
  return cols;
}

function valueCounts_(sh, col, start, keepRows) {
  const vals = sh.getRange(start, col, keepRows.length ? keepRows[keepRows.length - 1] - start + 1 : 1, 1).getDisplayValues();
  const counts = {};
  keepRows.forEach(r => {
    const v = str_(vals[r - start][0]) || '(빈칸)';
    counts[v] = (counts[v] || 0) + 1;
  });
  return Object.keys(counts)
    .map(k => ({ value: k, count: counts[k] }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ko'))
    .slice(0, 30);
}

function diagnoseLegacyStats_(ss, month) {
  const sh = findLegacySheet_(ss, month);
  if (!sh || sh === 'MULTI') {
    return { month: month, sheet: '', ok: false, reason: sh ? '같은 달 시트가 여러 개' : '기존 장표 없음' };
  }
  const map = resolveLegacyMapping_(ss, sh, false);
  if (!map.ok) {
    return { month: month, sheet: str_(sh.getName()), ok: false, reason: '개통리스트 매핑 미확정: ' + map.reason };
  }

  // 개통건 행 = 접속번호 칸에 숫자 8자리 이상 (개통리스트와 동일 기준)
  const lastRow = sh.getLastRow();
  const start = map.dataStart;
  const keepRows = [];
  if (lastRow >= start) {
    sh.getRange(start, map.cols.accessNo, lastRow - start + 1, 1).getDisplayValues().forEach((r, i) => {
      if (digits_(r[0]).length >= 8) keepRows.push(start + i);
    });
  }

  const used = {};
  LEGACY_FIELDS.forEach(f => { used[map.cols[f.key]] = true; });
  const cols = legacyHeaderColumns_(sh, start).filter(c => !used[c.col]);

  const staff = cols
    .filter(c => c.parts.some(t => STAT_STAFF_RE.test(t) && !/(번호|연락처)/.test(t)))
    .map(c => ({ col: colLetter_(c.col), header: c.text, values: valueCounts_(sh, c.col, start, keepRows) }));

  const types = cols
    .filter(c => !c.parts.some(t => STAT_STAFF_RE.test(t)))
    .filter(c => c.parts.some(t => STAT_TYPE_RE.test(t) && !STAT_EXCLUDE_RE.test(t)))
    .map(c => ({ col: colLetter_(c.col), header: c.text, values: valueCounts_(sh, c.col, start, keepRows) }));

  // 실적 열 직접 집계 결과 (실적사항에 반영되는 기존 장표 숫자와 동일 로직)
  const webKeys = {};
  const rsh = ss.getSheetByName(SHEET_REPORT);
  if (rsh) readReports_(rsh, month).forEach(r => { const k = digits_(r.accessNo); if (k) webKeys[k] = true; });
  const legacyStats = readLegacyStats_(sh, map, webKeys, resolveLegacyStatCols_(ss, sh, false));

  const newSubDiag = diagnoseNewSubLines_(sh, start, keepRows, used);

  return {
    month: month,
    sheet: str_(sh.getName()),
    ok: true,
    rows: keepRows.length,
    staff: staff,
    types: types,
    legacyStats: legacyStats,
    newSubDiag: newSubDiag,
    reason: (!staff.length ? '담당 직원 헤더 후보를 찾지 못함. ' : '') + (!types.length ? '실적유형 헤더 후보를 찾지 못함.' : '')
  };
}

/*
 * [실적 매핑 확인] 버튼: 선택한 월만
 */
function getLegacyStatsDiag(month) {
  resetHeadCache_();
  if (!validMonth_(month)) throw new Error('적용월을 확인해주세요.');
  return diagnoseLegacyStats_(ss_(), str_(month));
}


/*******************************************************
 * 기존 장표 실적 집계 (실적 열 직접 합산, 읽기 전용)
 * - 열 번호 고정 없음: 헤더명이 정확히 일치하는 열을 찾음
 *   판매자: 판매자/직원명/담당자
 *   순신규실적: 순신규 / 신동: 신동
 *   순신규동판: 동판순신규/순신규동판 / 약갱동판: 동판약갱/약갱동판
 * - 항목마다 정확히 1개 열이 있어야 연동, 아니면 오류 표시 (추측 안 함)
 * - 셀 숫자를 그대로 합산 (빈칸/'-' = 0)
 * - 같은 접속번호가 유선_개통보고(같은 월)에 있으면 기존 장표 건은 제외
 *******************************************************/
const LEGACY_STAT_FIELDS = [
  { key: 'worker',    title: '판매자',     names: ['판매자', '직원명', '담당자'] },
  { key: 'newSub',    title: '순신규',     names: ['순신규'] },
  { key: 'newLine',   title: '동판순신규', names: ['동판순신규', '순신규동판'] },
  { key: 'newDong',   title: '신동',       names: ['신동'] },
  { key: 'renewLine', title: '동판약갱',   names: ['동판약갱', '약갱동판'] }
];

/*
 * 헤더 영역의 열별 제목 조각 (개통리스트 자동감지와 같은 헤더행 규칙)
 */
function legacyStatHeaderParts_(sh) {
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return null;
  const scan = Math.min(LEGACY_HEADER_SCAN_ROWS, lastRow);
  const head = headValues_(sh, scan, lastCol);
  let hr = -1;
  for (let r = 0; r < head.length && hr < 0; r++) {
    if (head[r].some(v => LEGACY_MATCHERS.accessNo(normHeader_(v)))) hr = r;
  }
  if (hr < 0) return null;
  const accCols = head[hr].map((v, i) => LEGACY_MATCHERS.accessNo(normHeader_(v)) ? i : -1).filter(i => i >= 0);
  const below = hr + 1 < head.length ? head[hr + 1] : null;
  const belowIsHeader = below && accCols.every(i => digits_(below[i]).length < 8) &&
    below.some(v => /[가-힣A-Za-z]/.test(str_(v)) && digits_(v).length < 8);
  const headerRows = [hr - 1, hr, belowIsHeader ? hr + 1 : -1].filter(r => r >= 0 && r < head.length);
  const out = [];
  for (let c = 0; c < lastCol; c++) {
    out.push(headerRows.map(r => normHeader_(head[r][c])).filter(Boolean));
  }
  return out;
}

function statNumber_(v) {
  if (typeof v === 'number') return isFinite(v) ? { n: v, ok: true } : { n: 0, ok: false };
  const s = str_(v).replace(/[,\s]/g, '');
  if (!s || s === '-') return { n: 0, ok: true };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { n: Number(s), ok: true };
  return { n: 0, ok: false };
}

/*
 * 실적 열 헤더 자동감지 (헤더명 정확 일치, 항목마다 1개 열)
 */
function detectLegacyStatCols_(sh) {
  const parts = legacyStatHeaderParts_(sh);
  if (!parts) return { ok: false, reason: "'접속번호' 헤더 행을 찾지 못함", cols: {} };
  const cols = {};
  const problems = [];
  LEGACY_STAT_FIELDS.forEach(f => {
    const hits = [];
    parts.forEach((ps, i) => { if (ps.some(t => f.names.indexOf(t) >= 0)) hits.push(i + 1); });
    if (hits.length === 1) cols[f.key] = hits[0];
    else if (!hits.length) problems.push(f.title + ' 헤더 없음');
    else problems.push(f.title + ' 헤더가 여러 개(' + hits.map(colLetter_).join(', ') + ')');
  });
  return problems.length ? { ok: false, reason: problems.join(' / '), cols: cols } : { ok: true, reason: '', cols: cols };
}

const LEGACY_STAT_MAP_HEADERS = ['시트명', '판매자열', '순신규열', '동판순신규열', '신동열', '동판약갱열', '상태', '확인내용', '갱신일시'];

function ensureLegacyStatMapSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_LEGACY_STAT_MAP);
  if (!sh) {
    sh = ss.insertSheet(SHEET_LEGACY_STAT_MAP);
    sh.getRange(1, 1, 1, LEGACY_STAT_MAP_HEADERS.length).setValues([LEGACY_STAT_MAP_HEADERS]).setFontWeight('bold');
    sh.getRange(1, LEGACY_STAT_MAP_HEADERS.length + 2, 3, 1).setValues([
      ['[안내] 기존 장표 실적 열(판매자/순신규/동판순신규/신동/동판약갱)'],
      ['상태 자동/감지실패 : 헤더명으로 매번 확인 · 상태 확정 : 입력한 열 문자를 그대로 사용(헤더 탐색 안 함)'],
      ['헤더 후보 — 판매자: 판매자·직원명·담당자 / 순신규 / 신동 / 동판순신규·순신규동판 / 동판약갱·약갱동판']
    ]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/*
 * 실적 열 결정: '확정' 행이 있으면 그 열 그대로, 아니면 헤더 자동감지(write 시 기록)
 */
function resolveLegacyStatCols_(ss, sh, write) {
  const name = str_(sh.getName());
  const mapSheet = write ? ensureLegacyStatMapSheet_(ss) : ss.getSheetByName(SHEET_LEGACY_STAT_MAP);
  let saved = null;
  if (mapSheet && mapSheet.getLastRow() >= 2) {
    mapSheet.getRange(2, 1, mapSheet.getLastRow() - 1, LEGACY_STAT_MAP_HEADERS.length).getDisplayValues()
      .forEach((r, i) => { if (str_(r[0]) === name) saved = { row: i + 2, values: r }; });
  }
  if (saved && str_(saved.values[6]) === '확정') {
    const cols = {};
    LEGACY_STAT_FIELDS.forEach((f, i) => { cols[f.key] = colIndex_(saved.values[i + 1]); });
    const bad = LEGACY_STAT_FIELDS.filter(f => !cols[f.key]).map(f => f.title);
    return bad.length
      ? { ok: false, status: '확정', reason: '확정 행 입력 확인 필요: ' + bad.join(', ') + ' 열', cols: {} }
      : { ok: true, status: '확정', reason: '', cols: cols };
  }
  const det = detectLegacyStatCols_(sh);
  det.status = det.ok ? '자동' : '감지실패';
  if (write && mapSheet) {
    const rowVals = [name].concat(LEGACY_STAT_FIELDS.map(f => det.cols[f.key] ? colLetter_(det.cols[f.key]) : ''))
      .concat([det.status, det.reason]);
    const prev = saved ? saved.values.slice(0, 8).map(str_).join('\u0001') : null;
    if (prev !== rowVals.map(x => str_(x)).join('\u0001')) {
      const row = saved ? saved.row : Math.max(mapSheet.getLastRow() + 1, 2);
      mapSheet.getRange(row, 1, 1, LEGACY_STAT_MAP_HEADERS.length).setValues([
        rowVals.concat([Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss')])
      ]);
    }
  }
  return det;
}

function readLegacyStats_(sh, map, webKeys, statMap) {
  const sheet = str_(sh.getName());
  if (!statMap.ok) {
    return { ok: false, sheet: sheet, status: statMap.status, reason: statMap.reason, excluded: 0 };
  }
  const cols = statMap.cols;

  const lastRow = sh.getLastRow();
  const start = map.dataStart;
  const result = {
    ok: true,
    sheet: sheet,
    status: statMap.status,
    reason: '',
    cols: LEGACY_STAT_FIELDS.map(f => ({ field: f.title, col: colLetter_(cols[f.key]) })),
    rows: 0,
    excluded: 0,
    nonNumeric: 0,
    byWorker: []
  };
  if (lastRow < start) return result;

  const n = lastRow - start + 1;
  const acc = sh.getRange(start, map.cols.accessNo, n, 1).getDisplayValues();
  const cust = sh.getRange(start, map.cols.customerName, n, 1).getDisplayValues();
  const seller = sh.getRange(start, cols.worker, n, 1).getDisplayValues();
  const mvals = {};
  METRICS.forEach(m => { mvals[m.key] = sh.getRange(start, cols[m.key], n, 1).getValues(); });

  const by = {};
  const order = [];
  for (let i = 0; i < n; i++) {
    const name = str_(seller[i][0]);
    const total = /^(합계|소계|총계|계)$/;
    if (total.test(str_(cust[i][0]).replace(/\s/g, '')) || total.test(name.replace(/\s/g, ''))) continue;

    const nums = {};
    let any = false;
    METRICS.forEach(m => {
      const x = statNumber_(mvals[m.key][i][0]);
      if (!x.ok) result.nonNumeric++;
      nums[m.key] = x.n;
      if (x.n) any = true;
    });

    const key = digits_(acc[i][0]);
    const isCase = key.length >= 8;
    if (!isCase && !(name && any)) continue;          // 개통건/실적 행이 아니면 제외
    if (isCase && webKeys && webKeys[key]) {          // 웹앱 보고와 같은 접속번호 → 웹앱 우선
      result.excluded++;
      continue;
    }

    const w = name || '미지정';
    if (!by[w]) {
      by[w] = { worker: w };
      METRICS.forEach(m => { by[w][m.key] = 0; });
      order.push(w);
    }
    METRICS.forEach(m => { by[w][m.key] += nums[m.key]; });
    result.rows++;
  }
  result.byWorker = order.map(w => by[w]);
  return result;
}


/*******************************************************
 * 순신규 원본행 진단 (표시 전용 — 실적 계산에는 사용하지 않음)
 * - '구분 = 순신규' 실제 개통건 첫 5행의 값이 있는 모든 셀을
 *   열문자 / 헤더(병합 상위 + 하위) / 표시값 으로 보여줌
 * - 특정 헤더명으로 후보를 고르지 않음
 *******************************************************/

/*
 * 열별 헤더 이름: 헤더 영역(접속번호 행 기준 위 1행 ~ 하위 제목 행)의 글자를 위→아래로 이어붙임
 * 가로 병합 셀은 병합 범위의 모든 열에 같은 상위 제목을 채움
 */
function legacyHeaderLabels_(sh, dataStart) {
  const lastCol = sh.getLastColumn();
  const lastRow = sh.getLastRow();
  const scan = Math.min(LEGACY_HEADER_SCAN_ROWS, lastRow, Math.max(dataStart - 1, 1));
  const head = headValues_(sh, Math.min(LEGACY_HEADER_SCAN_ROWS, lastRow), lastCol).slice(0, scan).map(r => r.slice());
  sh.getRange(1, 1, scan, lastCol).getMergedRanges().forEach(m => {
    const v = head[m.getRow() - 1] ? head[m.getRow() - 1][m.getColumn() - 1] : '';
    for (let r = m.getRow(); r < m.getRow() + m.getNumRows() && r <= scan; r++) {
      for (let c = m.getColumn(); c < m.getColumn() + m.getNumColumns() && c <= lastCol; c++) {
        head[r - 1][c - 1] = v;
      }
    }
  });
  let hr = -1;
  for (let r = 0; r < head.length && hr < 0; r++) {
    if (head[r].some(v => LEGACY_MATCHERS.accessNo(normHeader_(v)))) hr = r;
  }
  const rows = hr < 0 ? [] : [hr - 1, hr].concat(hr + 1 < scan ? [hr + 1] : []).filter(r => r >= 0 && r < head.length);
  const labels = [];
  for (let c = 0; c < lastCol; c++) {
    const parts = [];
    rows.forEach(r => {
      const t = str_(head[r][c]);
      if (t && parts.indexOf(t) < 0) parts.push(t);
    });
    labels.push(parts.join(' > '));
  }
  return labels;
}

function diagnoseNewSubLines_(sh, start, keepRows, used) {
  const labels = legacyHeaderLabels_(sh, start);
  const lastCol = sh.getLastColumn();

  const gubunCols = [];
  const sellerCols = [];
  labels.forEach((l, i) => {
    const ps = l.split(' > ').map(normHeader_);
    if (ps.indexOf('구분') >= 0) gubunCols.push(i + 1);
    if (ps.some(t => ['판매자', '직원명', '담당자'].indexOf(t) >= 0)) sellerCols.push(i + 1);
  });

  const out = {
    gubun: gubunCols.map(c => ({ col: colLetter_(c), header: labels[c - 1] })),
    seller: sellerCols.map(c => ({ col: colLetter_(c), header: labels[c - 1] })),
    samples: [],
    note: ''
  };
  if (!gubunCols.length) {
    out.note = "'구분' 헤더를 찾지 못해 순신규 행을 고를 수 없음";
    return out;
  }
  const gubunCol = gubunCols[0];
  if (gubunCols.length > 1) out.note = "'구분' 헤더가 여러 개 — " + colLetter_(gubunCol) + '열 기준으로 선택';

  if (!keepRows.length) return out;
  const g = sh.getRange(start, gubunCol, keepRows[keepRows.length - 1] - start + 1, 1).getDisplayValues();
  const picked = keepRows.filter(r => str_(g[r - start][0]).replace(/\s/g, '') === '순신규').slice(0, 5);

  picked.forEach(r => {
    const vals = sh.getRange(r, 1, 1, lastCol).getDisplayValues()[0];
    out.samples.push({
      row: r,
      seller: sellerCols.length ? str_(vals[sellerCols[0] - 1]) : '',
      gubun: str_(vals[gubunCol - 1]),
      cells: vals
        .map((v, i) => ({ col: colLetter_(i + 1), header: labels[i] || '', value: str_(v) }))
        .filter(x => x.value !== '')
    });
  });
  if (!picked.length) out.note = (out.note ? out.note + ' / ' : '') + "'구분 = 순신규' 개통건이 없음";
  return out;
}


/*******************************************************
 * 웹앱 보고 실적 분류
 *
 * [2026-08 이전] classifyReportV11_ : v11 그대로
 *   유선_설정의 동판유형 규칙만 사용 (미분류/0/1/회선수)
 *
 * [2026-09 이후] classifyReportV2_ : 원문보고에서 구분·가입 회선을 읽어 아래 순서로 판정
 *   1) 약정갱신 동판: 동판유형에 '약동'/'약갱' 포함 → 약갱동판 1, 순신규·순신규동판·신동 0
 *      (고객 1건 = 1, 인터넷·TV 회선 수와 무관)
 *      단, 유선_설정에 그 동판유형의 해당 항목이 명시돼 있으면 설정값 우선
 *   2) 순신규: 구분이 약정갱신(또는 1번 유형)이면 0
 *      구분 = 순신규이고 가입 회선(인터넷 I / TV T / GTT)을 읽을 수 있으면 회선 수 합계
 *      그 외에는 유선_설정 값, 설정도 없으면 미분류
 *   3) 순신규동판·신동·약갱동판: 1번에 해당하지 않으면 유선_설정 값, 없으면 미분류
 *   판별할 수 없는 항목은 추측하지 않고 미분류로 남김
 * 기존 장표 실적(실적 열 직접 집계)은 이 분류와 무관하게 v9 로직 그대로
 *******************************************************/
const V2_START = { y: 2026, m: 9 };

function isV2Month_(month) {
  const mt = str_(month).match(/^(\d{4})-(\d{2})$/);
  if (!mt) return false;
  const y = Number(mt[1]);
  const m = Number(mt[2]);
  return y > V2_START.y || (y === V2_START.y && m >= V2_START.m);
}

function isRenewDongType_(type) {
  return /약동|약갱/.test(str_(type).replace(/\s/g, ''));
}

function classifyReportV11_(rep, rules) {
  const rule = rules[str_(rep.lineType)];
  let missing = !rule;
  const values = {};
  METRICS.forEach(m => {
    values[m.key] = 0;
    const v = rule ? rule[m.key] : null;
    if (v === null || v === undefined) {
      missing = true;
      return;
    }
    values[m.key] = v === 'lines' ? (Number(rep.lineCount) || 0) : v;
  });
  return { values: values, missing: missing };
}

/*
 * 회선 수 값 해석: 숫자/N회선 → N, O·Y·있음 → 1, 빈칸·-·X·없음 → 0, 그 외 → null(판별 불가)
 */
function lineCountValue_(v) {
  const s = str_(v).replace(/\s/g, '');
  if (!s || /^(-|x|X|없음|무|0회선)$/.test(s)) return 0;
  const m = s.match(/^(\d{1,2})(회선|개|대)?$/);
  if (m) return Number(m[1]);
  if (/^(o|O|y|Y|있음|유|가입|신규)$/.test(s)) return 1;
  return null;
}

/*
 * 원문보고에서 구분 / 가입 회선(인터넷·TV·GTT) 읽기 (없으면 빈 값)
 */
function parseExtraFromRaw_(raw) {
  const out = { gubun: '', internet: null, tv: null, gtt: null, product: '', has: {} };
  String(raw || '').replace(/\r\n?/g, '\n').split('\n').forEach(line0 => {
    const line = line0.replace(/：/g, ':').trim();
    const m = line.match(/^([^:]{1,30}):(.*)$/);
    if (!m) return;
    const label = normLabel_(m[1]);
    const value = cleanValue_(m[2]);
    if (label === '구분' || label === '가입구분') { out.gubun = value; return; }
    if (label === '가입상품' || label === '상품') { out.product = value; return; }
    // 빈 값 줄(양식에 늘 있는 'GTT :' 등)은 기재로 보지 않음
    if (!value) return;
    if (label === '인터넷' || label === 'i' || label === '인터넷회선') { out.has.internet = true; out.internet = lineCountValue_(value); return; }
    if (label === 'tv' || label === 't' || label === '티비' || label === 'tv회선') { out.has.tv = true; out.tv = lineCountValue_(value); return; }
    if (label === 'gtt') { out.has.gtt = true; out.gtt = lineCountValue_(value); }
  });
  // 가입상품 '인터넷 + TV (+ GTT)' 표기 → 회선별 1 (개별 항목이 따로 적혀 있으면 그 값 우선)
  if (out.product) {
    const toks = out.product.split(/[+,/·&]|그리고/).map(t => t.replace(/\s/g, '').toUpperCase()).filter(Boolean);
    const cnt = k => toks.filter(t => k.test(t)).length;
    if (!out.has.internet) out.internet = cnt(/^(인터넷|I|인터넷\d*회선)$/);
    if (!out.has.tv) out.tv = cnt(/^(TV|T|티비)$/);
    if (!out.has.gtt && toks.some(t => /GTT/.test(t))) out.gtt = cnt(/GTT/);
    out.has.product = true;
  }
  return out;
}

function classifyReportV2_(rep, rules) {
  const type = str_(rep.lineType);
  const rule = rules[type] || null;
  const ruleVal = k => {
    const v = rule ? rule[k] : null;
    if (v === null || v === undefined) return null;
    return v === 'lines' ? (Number(rep.lineCount) || 0) : v;
  };
  const extra = parseExtraFromRaw_(rep.rawText);
  const gubun = str_(extra.gubun).replace(/\s/g, '');
  const renewType = isRenewDongType_(type);
  const renewGubun = /약정갱신|약갱|재약정/.test(gubun);
  const values = {};
  let missing = false;

  // 1) 약정갱신 동판 자동 분류 (설정에 명시된 항목은 설정 우선)
  ['newLine', 'newDong', 'renewLine'].forEach(k => {
    const rv = ruleVal(k);
    if (rv !== null) values[k] = rv;
    else if (renewType) values[k] = k === 'renewLine' ? 1 : 0;
    else { values[k] = 0; missing = true; }
  });

  // 2) 순신규: 약정갱신이면 0, 구분=순신규면 가입 회선 수
  if (renewType || renewGubun) {
    values.newSub = 0;
  } else if (gubun === '순신규') {
    // 회선 항목이 하나라도 적혀 있으면 적히지 않은 항목은 0, 적혔지만 읽을 수 없는 값(null)이 있으면 판별 불가
    const anyGiven = extra.has.internet || extra.has.tv || extra.has.gtt || extra.has.product;
    const parts = [
      extra.has.internet || extra.has.product ? extra.internet : 0,
      extra.has.tv || extra.has.product ? extra.tv : 0,
      extra.has.gtt || (extra.has.product && extra.gtt !== null) ? extra.gtt : 0
    ];
    const known = anyGiven && parts.every(x => x !== null);
    if (known) {
      values.newSub = parts.reduce((a, x) => a + (x || 0), 0);
    } else {
      const rv = ruleVal('newSub');
      if (rv !== null) values.newSub = rv;
      else { values.newSub = 0; missing = true; }
    }
  } else {
    const rv = ruleVal('newSub');
    if (rv !== null) values.newSub = rv;
    else { values.newSub = 0; missing = true; }
  }

  return { values: values, missing: missing };
}

