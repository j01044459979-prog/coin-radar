#!/usr/bin/env python3
"""독립 HMAC 기준값(Python hmac/json): 서명 문자열 = v.ts.nonce.canonical(body), canonical = 키 정렬·공백 없는 JSON(ensure_ascii=False).
body에는 부동소수가 없다(금액은 문자열) — JS/Python 정규화가 갈라지는 지점을 차단. 재생성: python3 rich300/test/fixtures/gen_hmac_vectors.py > rich300/test/fixtures/hmac-vectors.json"""
import hmac, hashlib, json, random
random.seed(5150)
def canon(o): return json.dumps(o, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
def rnd_str(n=12): return ''.join(random.choice('abcXYZ019 _-:./한글💹é') for _ in range(n))
def rnd_body(d=0):
    o = {}
    for _ in range(random.randint(1, 5)):
        k = random.choice(['sid', 'symbolId', 'entry', 'stop', 'tp1', 'dir', 'note', 'n', 'ok', 'list', 'obj', 'z', 'a', 'B'])
        t = random.choice(['s', 's', 'i', 'b', 'l', 'o', 'null']) if d < 2 else random.choice(['s', 'i', 'b'])
        o[k] = rnd_str() if t == 's' else random.randint(-10**12, 10**12) if t == 'i' else random.choice([True, False]) if t == 'b' else None if t == 'null' else [rnd_str(5), random.randint(0, 99)] if t == 'l' else rnd_body(d + 1)
    return o
out = []
for i in range(60):
    key = ''.join(random.choice('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_한') for _ in range(random.randint(32, 64)))
    body = rnd_body(); ts = random.randint(1700000000000, 1800000000000); nonce = ''.join(random.choice('abcdefghijklmnopqrstuvwxyz0123456789-_') for _ in range(random.randint(16, 40)))
    msg = f"1.{ts}.{nonce}.{canon(body)}"
    out.append({'key': key, 'v': 1, 'ts': ts, 'nonce': nonce, 'body': body, 'canonical': canon(body), 'signed': msg, 'sig': hmac.new(key.encode('utf-8'), msg.encode('utf-8'), hashlib.sha256).hexdigest()})
print(json.dumps(out, ensure_ascii=False))
