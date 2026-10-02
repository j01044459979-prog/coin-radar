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
function computeStats_(reports, rules, workers) {

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
    const rule = rules[type];
    let missing = !rule;

    METRICS.forEach(m => {
      const v = rule ? rule[m.key] : null;
      if (v === null || v === undefined) {
        missing = true;
        return;
      }
      byWorker[w][m.key] += v === 'lines' ? (Number(rep.lineCount) || 0) : v;
    });

    if (missing) {
      unclassifiedCount++;
      const label = type || '(유형 없음)';
      unclassified[label] = (unclassified[label] || 0) + 1;
    }
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

  const m = validMonth_(month) ? str_(month) : currentMonth_();
  const ss = ss_();
  const sh = ensureSheets_(ss);

  const workers = readColumnList_(sh.lists, 1);
  const giftKinds = readColumnList_(sh.lists, 2);
  const ruleInfo = readRules_(sh.rules);
  const reports = readReports_(sh.report, m);

  const list = reports
    .slice()
    .sort((a, b) => str_(b.createdAt).localeCompare(str_(a.createdAt)) || b.row - a.row)
    .map(r => ({
      id: str_(r.id),
      customerName: str_(r.customerName),
      accessNo: str_(r.accessNo),
      gift: str_(r.gift),
      giftPhone: str_(r.giftPhone),
      worker: str_(r.worker),
      lineType: str_(r.lineType),
      createdAt: str_(r.createdAt)
    }));

  return {
    month: m,
    today: currentMonth_(),
    workers: workers.length ? workers : DEFAULT_WORKERS,
    lineTypes: ruleInfo.types,
    giftKinds: giftKinds,
    list: list,
    stats: computeStats_(reports, ruleInfo.rules, workers.length ? workers : DEFAULT_WORKERS)
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
function lookupWarnings_(ss, fields) {
  const sh = ensureSheets_(ss);
  const out = [];
  const workers = readColumnList_(sh.lists, 1);
  const types = readRules_(sh.rules).types;
  if (fields.worker && workers.length && workers.indexOf(fields.worker) < 0) {
    out.push("작업자 '" + fields.worker + "' 는 직원 목록에 없습니다. (실적표에 별도 행으로 표시)");
  }
  if (fields.lineType && types.indexOf(fields.lineType) < 0) {
    out.push("동판유형 '" + fields.lineType + "' 은 유선_설정에 없습니다. (미분류로 집계)");
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
  const lw = lookupWarnings_(ss, p.fields);
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
