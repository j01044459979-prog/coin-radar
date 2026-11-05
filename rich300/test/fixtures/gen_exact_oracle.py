#!/usr/bin/env python3
"""정확 유리수(Fraction) 기준값: 중간 반올림 없이 평균 원가 실현손익을 계산하고 체결마다 마이크로 USDT로 *한 번만* 반올림(0에서 먼 쪽).
동률 반올림이 자주 걸리도록 가격·수량 자릿수를 일부러 맞춘 케이스를 포함한다. 재생성: python3 rich300/test/fixtures/gen_exact_oracle.py > rich300/test/fixtures/pnl-exact-oracle.json"""
import json, random
from fractions import Fraction as Fr
from decimal import Decimal
random.seed(77031)
def micro(x):                                   # Fraction(USDT) → 마이크로 정수, half away from zero
    y = x * 1000000; n = y.numerator; d = y.denominator
    q, r = divmod(abs(n), d); q += 1 if 2 * r >= d else 0
    return q if n >= 0 else -q
def s(x):                                       # 정확한 십진 문자열(소수 12자리 이내여야 함)
    v = x * 10**12
    assert v.denominator == 1, x
    n = v.numerator; sign = '-' if n < 0 else ''; n = abs(n); i, f = divmod(n, 10**12)
    return f"{sign}{i}" + (('.' + str(f).rjust(12, '0').rstrip('0')) if f else '')
def price():                                      # 현실적 범위: 1e-8 ~ 약 1e5 USDT
    kind = random.random()
    if kind < 0.35: return Fr(random.randint(1, 2000000), 1000000)                      # 6자리(동률 유도)
    if kind < 0.55: return Fr(random.randint(1, 99999999), 10**12)                       # 12자리 초소형(1e-12 ~ 1e-4)
    if kind < 0.8: return Fr(random.randint(1, 10**7), 10**random.choice([2, 4, 6, 8]))
    return Fr(random.randint(10**4, 10**8), 10**random.choice([2, 3]))
def qty():                                        # 수량 상한 ~1e9
    kind = random.random()
    if kind < 0.4: return Fr(random.choice([1, 2, 3, 5, 25, 75]), random.choice([2, 4, 8, 10, 20, 100, 1000000]))   # 동률 유도
    if kind < 0.7: return Fr(random.randint(1, 10**7), 10**random.choice([0, 2, 4, 8]))
    return Fr(random.randint(1, 10**9), 10**random.choice([3, 6, 12]))
out = []
for t in range(600):
    d = random.choice(['LONG', 'SHORT']); sign = 1 if d == 'LONG' else -1
    fills = []; q0 = qty(); p0 = price(); cost = p0 * q0; q = q0; ev = [0]
    fills.append({'fillId': f'x{t}-0', 'kind': 'entry', 'price': s(p0), 'qty': s(q0)}); st = 1
    for _ in range(random.randint(0, 3)):
        p, qq = price(), qty(); fills.append({'fillId': f'x{t}-{st}', 'kind': 'add', 'price': s(p), 'qty': s(qq)}); cost += p * qq; q += qq; ev.append(0); st += 1
    while q > 0:
        last = random.random() < 0.35
        r = q if last else Fr(round(q * Fr(random.randint(1, 9), 10) * 10**12), 10**12)      # 12자리 십진수로 반올림한 부분 청산 수량
        if r <= 0 or r >= q: r = q; last = True
        p = price(); removed = cost * r / q
        ev.append(micro(sign * (p * r - removed))); fills.append({'fillId': f'x{t}-{st}', 'kind': 'close' if last else 'reduce', 'price': s(p), 'qty': s(r)})
        cost -= removed; q -= r; st += 1
    out.append({'dir': d, 'fills': fills, 'grossMicroPerEvent': [str(x) for x in ev]})     # 큰 정수는 문자열(JSON 숫자 정밀도 손실 방지)
print(json.dumps(out))
