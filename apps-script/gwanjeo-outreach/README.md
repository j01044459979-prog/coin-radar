# 관저중로점 AI 외부활동 (Apps Script)

`관저중로점 AI 외부활동` 시트에 연결된 **기존 운영 중인** Apps Script 프로젝트를 clasp로 관리합니다.

- Spreadsheet ID: `1_5tW8XirqDuw_tc10JE5gL4e8ME5j9-8lNOls9TV2DU`
- Script ID: `.clasp.json` 참고
- 소스 위치: `src/` (Code.gs, index.html 등 — `clasp pull`로 가져옴)

## 새 세션에서 시작
```bash
cd apps-script/gwanjeo-outreach
./setup.sh        # clasp 설치 + CLASPRC_JSON 으로 로그인 정보 복원
clasp pull        # 항상 수정 전에 최신 원본을 먼저 가져오기
```

## 원칙
- 새 Apps Script 프로젝트를 만들지 않는다 (`clasp create` 금지).
- 수정 전 반드시 `clasp pull` → 원본을 git에 커밋해 백업.
- `clasp push`는 사용자 요청이 있을 때만. 배포(`clasp deploy`/`undeploy`)는 임의로 하지 않는다.
- 로그인 정보(`.clasprc.json`)는 절대 커밋하지 않는다.
