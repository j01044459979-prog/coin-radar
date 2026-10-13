// 참고 시나리오(진입·손절·목표)와 선물 리스크. 주문/레버리지 권고가 아니며 수수료·슬리피지·펀딩비는 반영하지 않는다.
const pct = (a, b) => Math.abs(a - b) / b * 100;

export function planOf(row, dir, mtf) {
  if (!['LONG', 'SHORT'].includes(dir) || !(row.atr > 0) || !Number.isFinite(row.price)) return null;
  const long = dir === 'LONG';
  const level = long ? row.high : row.low;
  const swing = long ? row.swingLow : row.swingHigh;
  if (!Number.isFinite(level) || !Number.isFinite(swing)) return null;
  const broken = long ? row.price >= level : row.price <= level;
  const entry = broken ? row.price : level;
  // 손절: 기준선 ∓ 1 ATR 과 최근 12봉 스윙 저점(고점) ∓ 0.1 ATR 중 더 먼 쪽(보수적 무효화)
  const stop = long ? Math.min(level - row.atr, swing - 0.1 * row.atr) : Math.max(level + row.atr, swing + 0.1 * row.atr);
  const r = long ? entry - stop : stop - entry;
  if (!(r > 0) || pct(entry, stop) > 8) return null;
  const tp1 = long ? entry + r : entry - r, tp2 = long ? entry + 2 * r : entry - 2 * r;
  const ok = long ? stop < entry && entry < tp1 && tp1 < tp2 : stop > entry && entry > tp1 && tp1 > tp2;
  if (!ok || [entry, stop, tp1, tp2].some(x => !(x > 0))) return null;
  // 1H 구조(스윙 고점/저점) 근거: 진입 쪽 다음 저항(지지)
  const h1 = mtf?.['1H'];
  const levels = (long ? h1?.resistance : h1?.support) ?? [];
  const ahead = levels.filter(x => (long ? x > entry : x < entry)).sort((a, b) => (long ? a - b : b - a))[0] ?? null;
  return {
    dir, mark: row.price, entry, conditional: !(row.strong && broken), entryNote: row.strong && broken ? '진입 참고가(현재가 기준)' : '조건부 진입 참고가',
    stop, tp1, tp2, stopPct: pct(entry, stop), tp1Pct: pct(tp1, entry), tp2Pct: pct(tp2, entry),
    rr1: 1, rr2: 2, structureAhead: ahead, tp1BeyondStructure: ahead !== null && (long ? ahead < tp1 : ahead > tp1),
    basis: `손절=기준선∓1ATR·12봉 스윙 중 먼 쪽, TP=진입∓1R/2R(저항·지지 확정가 아님)`,
    liquidation: '확인 불가', // 증거금·유지증거금·포지션 데이터 없음
  };
}

export function riskOf(row, dir, mtf, plan, btc) {
  const f = []; let pts = 0;
  const add = (p, text) => { pts += p; f.push(text); };
  const opposite = tf => { const t = mtf?.[tf]; return t && ((dir === 'LONG' && t.dir === 'DOWN') || (dir === 'SHORT' && t.dir === 'UP')); };
  if (opposite('4H')) add(2, '4시간 추세와 역행');
  if (opposite('1H')) add(1, '1시간 추세와 역행');
  const unknownTf = ['15m', '1H', '4H'].filter(tf => !mtf?.[tf] || mtf[tf].dir === 'UNKNOWN');
  if (unknownTf.length) add(1, `${unknownTf.join('/')} 추세 미확인`);
  if (btc && ((dir === 'LONG' && btc.change15 < -0.1) || (dir === 'SHORT' && btc.change15 > 0.1))) add(btc.change15 * (dir === 'LONG' ? -1 : 1) > 0.5 ? 3 : 2, 'BTC 단기 방향과 충돌');
  if (!btc) add(3, 'BTC 데이터 없음');
  if (row.oi15 >= 3) add(1, `15분 OI 급증 (${row.oi15.toFixed(2)}%)`);
  else if (row.oi15 < 0) add(1, `15분 OI 감소 (${row.oi15.toFixed(2)}%) · 신규 참여 약함`);
  const fa = Math.abs(row.funding);
  if (fa > 0.05) add(2, `펀딩 과열 (${row.funding.toFixed(4)}%)`); else if (fa > 0.03) add(1, `펀딩 높음 (${row.funding.toFixed(4)}%)`);
  if (row.atrPct > 2.5) add(2, `높은 변동성 (ATR ${row.atrPct.toFixed(2)}%)`); else if (row.atrPct > 1.5) add(1, `변동성 큼 (ATR ${row.atrPct.toFixed(2)}%)`);
  if (row.volume < 1) add(1, `거래대금 부족 (${row.volume.toFixed(2)}배)`);
  const level = dir === 'LONG' ? row.high : row.low;
  if (Number.isFinite(level) && row.atr > 0 && Math.abs(row.price - level) > row.atr) add(1, '돌파 기준선에서 1 ATR 이상 이격');
  if (plan) {
    if (plan.stopPct > 3) add(2, `손절까지 거리 ${plan.stopPct.toFixed(1)}%`); else if (plan.stopPct > 2) add(1, `손절까지 거리 ${plan.stopPct.toFixed(1)}%`);
    if (plan.tp1BeyondStructure) add(1, '1시간 구조 저항/지지가 TP1보다 가까움');
  } else add(1, '손절·목표 계산 불가');
  const age = row.collectedAt - row.priceAt;
  if (age > 120000) add(1, `가격 데이터 ${Math.round(age / 1000)}초 지연`);
  const levelName = pts >= 5 ? '높음' : pts >= 2 ? '보통' : '낮음';
  if (levelName !== '낮음' || f.length) f.push('레버리지 사용 시 손실 확대 주의 (배수·청산가는 계정 데이터가 없어 확인 불가)');
  else f.push('특별한 경고 요인 없음 (위험이 없다는 뜻은 아님)');
  return { level: levelName, points: pts, factors: f };
}
