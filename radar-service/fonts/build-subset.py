#!/usr/bin/env python3
"""차트용 글꼴 부분집합 재생성 (소스에 새 한글·기호를 추가했을 때만 실행).
사용: npm pack @expo-google-fonts/noto-sans-kr && tar xzf expo-google-fonts-noto-sans-kr-*.tgz  (→ ./package)
      pip install fonttools && python3 radar-service/fonts/build-subset.py ./package
글꼴: Noto Sans KR (SIL OFL 1.1, fonts/OFL.txt). 테스트가 소스의 모든 비ASCII 문자가 charset.txt에 있는지 검사한다."""
import glob, os, subprocess, sys
src = sys.argv[1] if len(sys.argv) > 1 else 'package'
here = os.path.dirname(os.path.abspath(__file__))
chars = set()
for f in glob.glob(os.path.join(here, '..', '*.mjs')):
    if os.path.basename(f) == 'probe-exchanges.mjs':
        continue
    chars |= {c for c in open(f, encoding='utf8').read() if ord(c) > 127 and ord(c) < 0x1F000}
open(os.path.join(here, 'charset.txt'), 'w', encoding='utf8').write(''.join(sorted(chars)) + '\n')
text = ''.join(sorted(chars)) + ''.join(chr(i) for i in range(32, 127))
tmp = os.path.join(here, '.text.tmp'); open(tmp, 'w', encoding='utf8').write(text)
for name, folder in (('Regular', '400Regular'), ('Bold', '700Bold')):
    subprocess.check_call(['pyftsubset', f'{src}/{folder}/NotoSansKR_{folder}.ttf', f'--text-file={tmp}', f'--output-file={here}/NotoSansKR-{name}.subset.ttf', '--layout-features=kern', '--no-hinting', '--desubroutinize'])
os.remove(tmp)
print(len(chars), '문자 부분집합 생성')
