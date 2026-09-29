/*******************************************************
 * 관저중로점 AI 외부활동 관리
 *******************************************************/

const CFG = {
  STORE_NAME: '관저중로점',
  STORE_ADDRESS: '대전 서구 관저중로 98',

  // QR① 최종 이동 페이지
  PROMO_URL: 'https://naver.me/Fm2I607T',

  // QR② 단골등록 - 카운팅 안 함
  REGULAR_URL: 'https://su.kt.co.kr/SlRIQr5',

  // 담당자
  STAFF: ['전명석', '김소명', '유병규', '황윤주'],

  SHEETS: {
    APT: '아파트DB',
    ACT: '활동기록',
    QR: 'QR접속기록',
    SETTING: '설정'
  }
};


/*******************************************************
 * 웹앱 진입
 *******************************************************/
function doGet(e) {

  if (e && e.parameter && e.parameter.qr === 'promo') {
    recordPromoQr_();

    return HtmlService
      .createHtmlOutput(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport"
                content="width=device-width,initial-scale=1">
          <meta http-equiv="refresh"
                content="0;url=${CFG.PROMO_URL}">
          <script>
            location.replace('${CFG.PROMO_URL}');
          </script>
        </head>
        <body></body>
        </html>
      `);
  }

  ensureSheets_();

  return HtmlService
    .createTemplateFromFile('index')
    .evaluate()
    .setTitle('관저중로점 AI 외부활동')
    .addMetaTag(
      'viewport',
      'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no'
    )
    .setXFrameOptionsMode(
      HtmlService.XFrameOptionsMode.ALLOWALL
    );
}


/*******************************************************
 * 최초 세팅
 *******************************************************/
function setup() {

  ensureSheets_();
  seedApartments_();

  return {
    success: true,
    message: '세팅 완료'
  };
}


/*******************************************************
 * 필요한 시트 자동 생성
 *******************************************************/
function ensureSheets_() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  createSheetIfNeeded_(
    ss,
    CFG.SHEETS.APT,
    [
      'ID',
      '아파트명',
      '주소',
      '총세대수',
      '전체동수',
      '동목록',
      '아파트형식',
      '공동현관',
      '메모',
      '최근활동일',
      '누적활동동수',
      '사용여부'
    ]
  );

  createSheetIfNeeded_(
    ss,
    CFG.SHEETS.ACT,
    [
      '활동ID',
      '활동일',
      '담당자',
      '아파트ID',
      '아파트명',
      '완료동',
      '활동동수',
      '아파트형식',
      '공동현관',
      '메모',
      '등록일시'
    ]
  );

  createSheetIfNeeded_(
    ss,
    CFG.SHEETS.QR,
    [
      '접속ID',
      '접속일',
      '접속시간',
      'QR구분',
      '등록일시'
    ]
  );

  createSheetIfNeeded_(
    ss,
    CFG.SHEETS.SETTING,
    [
      '설정항목',
      '설정값'
    ]
  );

  setupSettings_();
}


/*******************************************************
 * 시트 생성
 *******************************************************/
function createSheetIfNeeded_(ss, name, headers) {

  let sh = ss.getSheetByName(name);

  if (!sh) {
    sh = ss.insertSheet(name);
  }

  if (sh.getLastRow() === 0) {

    sh.getRange(
      1,
      1,
      1,
      headers.length
    ).setValues([headers]);

    sh.setFrozenRows(1);

    sh.getRange(
      1,
      1,
      1,
      headers.length
    )
      .setFontWeight('bold')
      .setHorizontalAlignment('center');
  }
}


/*******************************************************
 * 설정
 *******************************************************/
function setupSettings_() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.SETTING);

  if (sh.getLastRow() > 1) {
    return;
  }

  sh.getRange(2, 1, 7, 2).setValues([
    ['매장명', CFG.STORE_NAME],
    ['매장주소', CFG.STORE_ADDRESS],
    ['홍보페이지', CFG.PROMO_URL],
    ['단골등록', CFG.REGULAR_URL],
    ['홍보QR 카운팅', '사용'],
    ['단골등록 카운팅', '미사용'],
    ['개인정보수집', '미사용']
  ]);
}


/*******************************************************
 * 초기 아파트 DB
 *******************************************************/
function seedApartments_() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CFG.SHEETS.APT);

  // 기존 DB가 있으면 절대 덮어쓰지 않음
  if (sh.getLastRow() > 1) {
    return;
  }

  const data = [
    ['APT001','원앙마을1단지','대전 서구 관저동',660,7,'','계단형','미확인','','',0,'사용'],
    ['APT002','원앙마을2단지','대전 서구 관저동',1734,13,'','혼합형','미확인','','',0,'사용'],
    ['APT003','원앙마을4단지','대전 서구 관저동','','','','미확인','미확인','','',0,'사용'],

    ['APT004','구봉마을5단지','대전 서구 관저동',1000,13,'','혼합형','미확인','','',0,'사용'],
    ['APT005','구봉마을7단지','대전 서구 관저동',1188,9,'','혼합형','미확인','','',0,'사용'],
    ['APT006','구봉마을8-1단지','대전 서구 관저동',1563,14,'','혼합형','미확인','','',0,'사용'],
    ['APT007','구봉마을9단지','대전 서구 관저동',1030,12,'','혼합형','미확인','','',0,'사용'],

    ['APT008','느리울마을11단지','대전 서구 관저동',940,'','','미확인','미확인','','',0,'사용'],
    ['APT009','느리울마을12단지','대전 서구 관저동',750,'','','미확인','미확인','','',0,'사용'],

    ['APT010','대자연마을','대전 서구 관저동','','','','미확인','미확인','','',0,'사용'],
    ['APT011','신선마을','대전 서구 관저동','','','','미확인','미확인','','',0,'사용'],

    ['APT012','다온숲3단지','대전 서구 관저동',1401,16,'','미확인','미확인','','',0,'사용'],

    ['APT013','관저더샵','대전 서구 관저동','','','','미확인','미확인','','',0,'사용'],
    ['APT014','관저리슈빌','대전 서구 관저동','','','','미확인','미확인','','',0,'사용'],
    ['APT015','관저예미지','대전 서구 관저동','','','','미확인','미확인','','',0,'사용'],
    ['APT016','중흥S-클래스 프라디움','대전 서구 관저동','','','','미확인','미확인','','',0,'사용']
  ];

  sh.getRange(
    2,
    1,
    data.length,
    12
  ).setValues(data);
}


/*******************************************************
 * 앱 시작 데이터
 *******************************************************/
function getAppData() {

  ensureSheets_();
  seedApartments_();

  return {
    storeName: CFG.STORE_NAME,
    storeAddress: CFG.STORE_ADDRESS,
    staff: CFG.STAFF,
    promoUrl: CFG.PROMO_URL,
    regularUrl: CFG.REGULAR_URL,
    apartments: getApartments_(),
    recent: getRecentActivities_(30),
    stats: getStats_()
  };
}


/*******************************************************
 * 아파트 조회
 *******************************************************/
function getApartments_() {

  const sh = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(CFG.SHEETS.APT);

  if (!sh || sh.getLastRow() < 2) {
    return [];
  }

  const values = sh.getRange(
    2,
    1,
    sh.getLastRow() - 1,
    12
  ).getValues();

  return values
    .filter(r => r[1] && r[11] !== '미사용')
    .map(r => ({
      id: String(r[0] || ''),
      name: String(r[1] || ''),
      address: String(r[2] || ''),
      households: r[3] || '',
      buildingCount: r[4] || '',
      buildings: String(r[5] || ''),
      type: String(r[6] || '미확인'),
      entrance: String(r[7] || '미확인'),
      memo: String(r[8] || ''),
      lastActivity: formatDate_(r[9]),
      totalBuildingActivity: Number(r[10]) || 0
    }));
}


/*******************************************************
 * 아파트 추가
 *******************************************************/
function addApartment(data) {

  ensureSheets_();

  if (!data || !String(data.name || '').trim()) {
    throw new Error('아파트명을 입력해주세요.');
  }

  const sh = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(CFG.SHEETS.APT);

  const id =
    'APT-' +
    Utilities.getUuid()
      .substring(0, 8)
      .toUpperCase();

  sh.appendRow([
    id,
    String(data.name || '').trim(),
    String(data.address || '').trim(),
    toNumberOrBlank_(data.households),
    toNumberOrBlank_(data.buildingCount),
    normalizeBuildings_(data.buildings),
    data.type || '미확인',
    data.entrance || '미확인',
    String(data.memo || '').trim(),
    '',
    0,
    '사용'
  ]);

  return getAppData();
}


/*******************************************************
 * 아파트 수정
 *******************************************************/
function updateApartment(data) {

  ensureSheets_();

  if (!data || !data.id) {
    throw new Error('아파트 정보가 없습니다.');
  }

  const sh = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(CFG.SHEETS.APT);

  const row = findApartmentRow_(sh, data.id);

  if (!row) {
    throw new Error('아파트를 찾을 수 없습니다.');
  }

  sh.getRange(row, 2, 1, 8).setValues([[
    String(data.name || '').trim(),
    String(data.address || '').trim(),
    toNumberOrBlank_(data.households),
    toNumberOrBlank_(data.buildingCount),
    normalizeBuildings_(data.buildings),
    data.type || '미확인',
    data.entrance || '미확인',
    String(data.memo || '').trim()
  ]]);

  return getAppData();
}


/*******************************************************
 * 활동 저장
 *******************************************************/
function saveActivity(data) {

  ensureSheets_();

  if (!data) {
    throw new Error('활동정보가 없습니다.');
  }

  if (!data.date) {
    throw new Error('활동일을 선택해주세요.');
  }

  if (!data.staff) {
    throw new Error('담당자를 선택해주세요.');
  }

  if (!CFG.STAFF.includes(String(data.staff))) {
    throw new Error('등록되지 않은 담당자입니다.');
  }

  if (!data.apartmentId) {
    throw new Error('아파트를 선택해주세요.');
  }

  const buildings =
    Array.isArray(data.buildings)
      ? data.buildings
          .map(v => String(v).trim())
          .filter(Boolean)
      : [];

  if (!buildings.length) {
    throw new Error('완료한 동을 선택해주세요.');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const aptSh = ss.getSheetByName(CFG.SHEETS.APT);
  const actSh = ss.getSheetByName(CFG.SHEETS.ACT);

  const aptRow = findApartmentRow_(
    aptSh,
    data.apartmentId
  );

  if (!aptRow) {
    throw new Error('아파트를 찾을 수 없습니다.');
  }

  const apt = aptSh
    .getRange(aptRow, 1, 1, 12)
    .getValues()[0];

  const now = new Date();

  const activityDate =
    new Date(data.date + 'T12:00:00');

  const activityId =
    'ACT-' +
    Utilities.formatDate(
      now,
      Session.getScriptTimeZone(),
      'yyyyMMddHHmmss'
    ) +
    '-' +
    Utilities.getUuid()
      .substring(0, 5)
      .toUpperCase();

  const aptType =
    data.type ||
    apt[6] ||
    '미확인';

  const entrance =
    data.entrance ||
    apt[7] ||
    '미확인';

  actSh.appendRow([
    activityId,
    activityDate,
    data.staff,
    apt[0],
    apt[1],
    buildings.join(', '),
    buildings.length,
    aptType,
    entrance,
    String(data.memo || '').trim(),
    now
  ]);

  // 아파트 최신 현장정보 업데이트
  aptSh.getRange(aptRow, 7).setValue(aptType);
  aptSh.getRange(aptRow, 8).setValue(entrance);

  if (String(data.memo || '').trim()) {
    aptSh
      .getRange(aptRow, 9)
      .setValue(String(data.memo).trim());
  }

  aptSh
    .getRange(aptRow, 10)
    .setValue(activityDate);

  const oldTotal =
    Number(
      aptSh
        .getRange(aptRow, 11)
        .getValue()
    ) || 0;

  aptSh
    .getRange(aptRow, 11)
    .setValue(
      oldTotal + buildings.length
    );

  SpreadsheetApp.flush();

  return getAppData();
}


/*******************************************************
 * 최근 활동
 *******************************************************/
function getRecentActivities_(limit) {

  const sh = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(CFG.SHEETS.ACT);

  if (!sh || sh.getLastRow() < 2) {
    return [];
  }

  const values = sh.getRange(
    2,
    1,
    sh.getLastRow() - 1,
    11
  ).getValues();

  return values
    .filter(r => r[0])
    .map(r => ({
      id: String(r[0]),
      date: formatDate_(r[1]),
      staff: String(r[2] || ''),
      apartmentId: String(r[3] || ''),
      apartmentName: String(r[4] || ''),
      buildings: String(r[5] || ''),
      buildingCount: Number(r[6]) || 0,
      type: String(r[7] || ''),
      entrance: String(r[8] || ''),
      memo: String(r[9] || ''),
      createdAt: formatDateTime_(r[10])
    }))
    .reverse()
    .slice(0, Number(limit) || 30);
}


/*******************************************************
 * 전체 통계
 *******************************************************/
function getStats_() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const actSh = ss.getSheetByName(CFG.SHEETS.ACT);
  const qrSh = ss.getSheetByName(CFG.SHEETS.QR);

  const daily = {};

  let totalActivities = 0;
  let totalBuildings = 0;
  let totalQr = 0;

  if (actSh && actSh.getLastRow() >= 2) {

    const rows = actSh.getRange(
      2,
      1,
      actSh.getLastRow() - 1,
      11
    ).getValues();

    rows.forEach(r => {

      if (!r[1]) return;

      const key = formatDate_(r[1]);

      if (!daily[key]) {
        daily[key] = {
          date: key,
          activityCount: 0,
          buildingCount: 0,
          qrCount: 0
        };
      }

      daily[key].activityCount++;
      daily[key].buildingCount +=
        Number(r[6]) || 0;

      totalActivities++;
      totalBuildings +=
        Number(r[6]) || 0;
    });
  }

  if (qrSh && qrSh.getLastRow() >= 2) {

    const rows = qrSh.getRange(
      2,
      1,
      qrSh.getLastRow() - 1,
      5
    ).getValues();

    rows.forEach(r => {

      if (!r[1]) return;

      const key = formatDate_(r[1]);

      if (!daily[key]) {
        daily[key] = {
          date: key,
          activityCount: 0,
          buildingCount: 0,
          qrCount: 0
        };
      }

      daily[key].qrCount++;
      totalQr++;
    });
  }

  const dailyList = Object
    .values(daily)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date)
    )
    .map(v => ({
      date: v.date,
      activityCount: v.activityCount,
      buildingCount: v.buildingCount,
      qrCount: v.qrCount,
      qrPerBuilding:
        v.buildingCount > 0
          ? Number(
              (
                v.qrCount /
                v.buildingCount
              ).toFixed(2)
            )
          : 0
    }));

  return {
    totalActivities: totalActivities,
    totalBuildings: totalBuildings,
    totalQr: totalQr,

    qrPerBuilding:
      totalBuildings > 0
        ? Number(
            (
              totalQr /
              totalBuildings
            ).toFixed(2)
          )
        : 0,

    daily: dailyList
  };
}


/*******************************************************
 * 직원별 월간 활동 현황
 *
 * 해당 월 활동 횟수
 * + 해당 직원 전체 기간 가장 최근 활동일
 *******************************************************/
function getStaffMonthlyStats(year, month) {

  ensureSheets_();

  year = Number(year);
  month = Number(month);

  if (
    !year ||
    !month ||
    month < 1 ||
    month > 12
  ) {
    throw new Error(
      '조회할 연월이 올바르지 않습니다.'
    );
  }

  const sh = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(CFG.SHEETS.ACT);

  const result = {};

  CFG.STAFF.forEach(name => {
    result[name] = {
      staff: name,
      count: 0,
      lastActivity: ''
    };
  });

  if (sh && sh.getLastRow() >= 2) {

    const rows = sh.getRange(
      2,
      1,
      sh.getLastRow() - 1,
      11
    ).getValues();

    rows.forEach(r => {

      const activityDate = r[1];

      const staff =
        String(r[2] || '').trim();

      if (
        !activityDate ||
        !result[staff]
      ) {
        return;
      }

      const d = new Date(activityDate);

      if (isNaN(d.getTime())) {
        return;
      }

      // 선택한 월의 활동 횟수
      if (
        d.getFullYear() === year &&
        d.getMonth() + 1 === month
      ) {
        result[staff].count++;
      }

      // 해당 직원의 전체 기간 최근 활동일
      const formatted =
        formatDate_(d);

      if (
        !result[staff].lastActivity ||
        formatted >
          result[staff].lastActivity
      ) {
        result[staff].lastActivity =
          formatted;
      }
    });
  }

  // 반드시 지정한 직원 순서 유지
  const staff = CFG.STAFF.map(
    name => result[name]
  );

  const total = staff.reduce(
    (sum, item) =>
      sum + item.count,
    0
  );

  return {
    year: year,
    month: month,
    total: total,
    staff: staff
  };
}


/*******************************************************
 * 홍보 QR 접속 카운팅
 *******************************************************/
function recordPromoQr_() {

  ensureSheets_();

  const lock =
    LockService.getScriptLock();

  try {

    lock.waitLock(5000);

    const sh = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(CFG.SHEETS.QR);

    const now = new Date();

    const id =
      'QR-' +
      Utilities.formatDate(
        now,
        Session.getScriptTimeZone(),
        'yyyyMMddHHmmssSSS'
      ) +
      '-' +
      Utilities.getUuid()
        .substring(0, 5)
        .toUpperCase();

    sh.appendRow([
      id,
      now,
      now,
      '홍보QR',
      now
    ]);

    SpreadsheetApp.flush();

  } finally {

    try {
      lock.releaseLock();
    } catch (err) {}

  }
}


/*******************************************************
 * QR 정보
 *******************************************************/
function getQrInfo() {

  const webAppUrl =
    ScriptApp.getService().getUrl() || '';

  return {
    promoTrackingUrl:
      webAppUrl
        ? webAppUrl + '?qr=promo'
        : '',

    promoDestination:
      CFG.PROMO_URL,

    regularUrl:
      CFG.REGULAR_URL
  };
}


/*******************************************************
 * 아파트 행 찾기
 *******************************************************/
function findApartmentRow_(sh, id) {

  if (!sh || sh.getLastRow() < 2) {
    return 0;
  }

  const ids = sh.getRange(
    2,
    1,
    sh.getLastRow() - 1,
    1
  ).getValues();

  for (let i = 0; i < ids.length; i++) {

    if (
      String(ids[i][0]) ===
      String(id)
    ) {
      return i + 2;
    }
  }

  return 0;
}


/*******************************************************
 * 동 목록 정리
 *******************************************************/
function normalizeBuildings_(value) {

  if (Array.isArray(value)) {

    return value
      .map(
        v => String(v).trim()
      )
      .filter(Boolean)
      .join(', ');
  }

  return String(value || '')
    .split(/[,/\n]+/)
    .map(
      v => v.trim()
    )
    .filter(Boolean)
    .join(', ');
}


/*******************************************************
 * 숫자 또는 빈칸
 *******************************************************/
function toNumberOrBlank_(value) {

  if (
    value === '' ||
    value === null ||
    typeof value === 'undefined'
  ) {
    return '';
  }

  const n = Number(
    String(value).replace(/,/g, '')
  );

  return isNaN(n)
    ? ''
    : n;
}


/*******************************************************
 * 날짜 포맷
 *******************************************************/
function formatDate_(value) {

  if (!value) return '';

  try {

    return Utilities.formatDate(
      new Date(value),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd'
    );

  } catch (e) {

    return String(value);

  }
}


/*******************************************************
 * 날짜시간 포맷
 *******************************************************/
function formatDateTime_(value) {

  if (!value) return '';

  try {

    return Utilities.formatDate(
      new Date(value),
      Session.getScriptTimeZone(),
      'yyyy-MM-dd HH:mm:ss'
    );

  } catch (e) {

    return String(value);

  }
}