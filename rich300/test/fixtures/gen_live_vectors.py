# 실제 Apps Script V8에서 Node와 같은 결과가 나오는지 확인하는 고정 벡터(독립 기준값: Python Fraction/hmac). 생성: python3 rich300/test/fixtures/gen_live_vectors.py > rich300/lib/livevectors.mjs
import json, random
from fractions import Fraction as F
random.seed(300)
def rhaz(x):                       # half away from zero
    n, d = x.numerator, x.denominator
    q, r = divmod(abs(n), d); q += 1 if 2*r >= d else 0
    return q if n >= 0 else -q
hm = json.load(open('rich300/test/fixtures/hmac-vectors.json'))[:30]
pnl = json.load(open('rich300/test/fixtures/pnl-exact-oracle.json'))[:40]
# 고정 소수점 연산 벡터: 입력은 12자리 소수 문자열, 기대값은 정확 유리수 계산 후 half-away 반올림(1e-12 단위)
def fs(x):  # 12자리 소수 문자열
    v = rhaz(x * 10**12); s = '-' if v < 0 else ''; v = abs(v); return f"{s}{v // 10**12}.{v % 10**12:012d}"
vec = []
for i in range(24):
    a = F(random.randint(1, 10**11), 10**random.randint(2, 9)); b = F(random.randint(1, 10**9), 10**random.randint(1, 7))
    A, B = fs(a), fs(b); a, b = F(A), F(B)
    vec.append({"a": A, "b": B, "mul": str(rhaz(a*b*10**12)), "div": str(rhaz(a/b*10**12)), "micro": str(rhaz(a*10**6))})
ideal = []; cur = F(300)
for n in range(1, 366):
    cur *= F(105, 100)
    if n <= 30 or n in (60, 90, 180, 365): ideal.append([n, str(rhaz(cur * 10**6))])
print('// 자동 생성 파일 — 수정하지 마세요. 생성: python3 rich300/test/fixtures/gen_live_vectors.py')
print('// 실제 Apps Script V8에서 BigInt·고정소수점·손익·복리·HMAC 계산이 독립 기준값과 같은지 확인하는 벡터(S0 이후 실환경 검증용).')
print('export const LIVE_DEC_VECTORS = ' + json.dumps(vec, ensure_ascii=False) + ';')
print('export const LIVE_IDEAL_VECTORS = ' + json.dumps(ideal) + ';   // [일수, 300 USDT × 1.05^n 의 마이크로 USDT]')
print('export const LIVE_PNL_VECTORS = ' + json.dumps(pnl, ensure_ascii=False) + ';')
print('export const LIVE_HMAC_VECTORS = ' + json.dumps([{k: h[k] for k in ("key","v","ts","nonce","body","canonical","sig")} for h in hm], ensure_ascii=False) + ';')
