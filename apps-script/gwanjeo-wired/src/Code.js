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
  { key: 'gttProcess',    title: 'GTT처리방식' }
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
 * 유선판매보고 저장
 *******************************************************/
function saveReport(x) {

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw new Error('다른 저장이 진행 중입니다. 잠시 후 다시 저장해주세요.');
  }

  try {

    if (!x) throw new Error('저장할 내용이 없습니다.');

    const month = str_(x.month);
    if (!validMonth_(month)) throw new Error('적용월을 확인해주세요.');

    const worker = str_(x.worker);
    const lineType = str_(x.lineType);
    const accessNo = str_(x.accessNo);
    const customerName = str_(x.customerName);

    if (!worker) throw new Error('작업자를 선택해주세요.');
    if (!lineType) throw new Error('동판유형을 선택해주세요.');
    if (!accessNo) throw new Error('접속번호를 입력해주세요.');
    if (!customerName) throw new Error('인터넷 명의자명을 입력해주세요.');

    const lineCount = Number(x.lineCount);
    if (!Number.isInteger(lineCount) || lineCount < 0 || lineCount > 20) {
      throw new Error('동판회선수를 확인해주세요.');
    }

    const ctns = (Array.isArray(x.lineCtns) ? x.lineCtns : [])
      .slice(0, lineCount)
      .map(formatPhone_)
      .filter(Boolean);

    const nameMatch = str_(x.nameMatch) === '불일치' ? '불일치' : '일치';
    const mismatch = nameMatch === '불일치';

    const ss = ss_();
    const sh = ensureSheets_(ss).report;

    /*
     * 중복 확인: 같은 적용월 + 같은 접속번호(숫자 기준)
     */
    const accessKey = digits_(accessNo) || accessNo;
    const last = sh.getLastRow();
    if (last >= 2) {
      const keys = sh.getRange(2, 3, last - 1, 4).getValues(); // C 적용월 ~ F 접속번호
      const dup = keys.some(r =>
        monthOf_(r[0]) === month &&
        (digits_(r[3]) || str_(r[3])) === accessKey
      );
      if (dup) {
        return {
          saved: false,
          duplicate: true,
          message: '동일한 접속번호의 개통보고가 이미 존재합니다.'
        };
      }
    }

    const now = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
    const rec = {
      id: 'W' + Utilities.formatDate(new Date(), TZ, 'yyyyMMddHHmmss') + '-' +
        Math.random().toString(36).slice(2, 6),
      createdAt: now,
      month: month,
      worker: worker,
      lineType: lineType,
      accessNo: accessNo,
      holderPhone: formatPhone_(x.holderPhone),
      lineCount: lineCount,
      lineCtns: ctns.join(' / '),
      customerName: customerName,
      nameMatch: nameMatch,
      guideMethod: mismatch ? str_(x.guideMethod) : '',
      mismatchNote: mismatch ? str_(x.mismatchNote) : '',
      mismatchPhone: mismatch ? formatPhone_(x.mismatchPhone) : '',
      gift: str_(x.gift),
      giftPhone: formatPhone_(x.giftPhone),
      giftKind: str_(x.giftKind),
      giftProcess: str_(x.giftProcess),
      gtt: str_(x.gtt),
      gttProcess: str_(x.gttProcess)
    };

    const row = Math.max(sh.getLastRow() + 1, 2);
    if (row > sh.getMaxRows()) {
      sh.insertRowsAfter(sh.getMaxRows(), 50);
    }

    /*
     * 문자열 열은 값을 쓰기 전에 텍스트 서식 지정 (앞자리 0 보존)
     */
    REPORT_COLUMNS.forEach((c, i) => {
      if (c.text) sh.getRange(row, i + 1).setNumberFormat('@');
    });

    sh.getRange(row, 1, 1, REPORT_COLUMNS.length)
      .setValues([REPORT_COLUMNS.map(c => rec[c.key])]);

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
