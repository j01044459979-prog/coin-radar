#!/usr/bin/env python3
"""독립 기준값 생성기: Python Decimal로 평균가 원가 방식 실현손익을 계산해 JSON 픽스처를 만든다(엔진 코드와 무관).
재생성: python3 rich300/test/fixtures/gen_oracle.py > rich300/test/fixtures/pnl-oracle.json"""
import json, random
from decimal import Decimal, getcontext, ROUND_HALF_UP
getcontext().prec = 60
Q12, Q6 = Decimal('1e-12'), Decimal('1e-6')
q12 = lambda x: x.quantize(Q12, rounding=ROUND_HALF_UP)
q6 = lambda x: int(x.quantize(Q6, rounding=ROUND_HALF_UP) * 1000000)
random.seed(20261024)
def rnd_price():
    base = random.choice(['0.00001234', '0.35', '1.9', '27.45', '100', '2350.5', '68000.12'])
    return Decimal(base) * Decimal(random.randint(80, 120)) / Decimal(100)
out = []
for t in range(300):
    d = random.choice(['LONG', 'SHORT']); sign = 1 if d == 'LONG' else -1
    p0 = q12(rnd_price()); qty0 = Decimal(random.randint(1, 5000)) / Decimal(random.choice([1, 10, 100, 1000]))
    fills = [{'fillId': f't{t}-0', 'kind': 'entry', 'price': str(p0), 'qty': str(qty0)}]
    qty, cost = qty0, q12(p0 * qty0); events = [0]; step = 1
    for _ in range(random.randint(0, 3)):                      # 추가 진입
        p = q12(rnd_price()); q = Decimal(random.randint(1, 2000)) / Decimal(100)
        fills.append({'fillId': f't{t}-{step}', 'kind': 'add', 'price': str(p), 'qty': str(q)}); qty += q; cost += q12(p * q); events.append(0); step += 1
    while qty > 0:                                            # 부분 청산 → 전량 청산
        last = random.random() < 0.4
        q = qty if last else (qty * Decimal(random.randint(1, 9)) / Decimal(10)).quantize(Decimal('1e-8'), rounding=ROUND_HALF_UP)
        if q <= 0 or q > qty: q = qty; last = True
        if q == qty: last = True
        p = q12(rnd_price()); removed = cost if q == qty else q12(q12(cost * q) / qty)
        gross = (q12(p * q) - removed) * sign
        events.append(q6(gross)); fills.append({'fillId': f't{t}-{step}', 'kind': 'close' if last else 'reduce', 'price': str(p), 'qty': str(q)})
        qty -= q; cost -= removed; step += 1
    out.append({'dir': d, 'fills': fills, 'grossMicroPerEvent': events, 'grossMicroTotal': sum(events)})
print(json.dumps(out, ensure_ascii=False))
