# RICH300 focus UI + hourly follow-up: deployment runbook

> Status: **CODE ONLY / NOT DEPLOYED**. User approved the interface and opt-in hourly follow-up on 2026-11-05.
> Do not assert Telegram delivery, Apps Script trigger availability, or production activation from GitHub green checks.

## GitHub source boundaries

- UI + binary Telegram response PR: [#65](https://github.com/j01044459979-prog/coin-radar/pull/65), source branch `ui/rich300-focus-home-journal`, base `fix/tg-ack-diag`.
- Hourly follow-up PR: [#66](https://github.com/j01044459979-prog/coin-radar/pull/66), source branch `feature/rich300-hourly-position-follow`, base PR #65's branch.
- **Never merge either PR directly into main** without a full production/radar parity analysis. Main is not the same lineage as the Apps Script v13 branch.
- Existing RICH300 production deployment ID must be preserved:
  `AKfycbyWXaXXlsZduOIxO-dvelAbTwlLgdAhVhSf6r2DcbSwkgmbUhYb6woOWR83MFVr6_38`.
- Existing web app URL remains `https://script.google.com/macros/s/AKfycbyWXaXXlsZduOIxO-dvelAbTwlLgdAhVhSf6r2DcbSwkgmbUhYb6woOWR83MFVr6_38/exec`.
- No new Apps Script project, deployment, Sheets workbook, Cloudflare worker, bot, or GitHub Secret.

## Mandatory safe release sequence

1. **Read-only parity**: inspect live Apps Script v13 and its Deployment ID, Script ID, file contents, trigger count, Script Properties names (never expose values), and sheet schema. Compare with version-controlled base and record diffs.
2. **Backup**: export and checksum the actual live Apps Script source; retain current deployment version for rollback. Do not copy secret values into GitHub/logs.
3. **Green checks**: `node rich300/deploy/make-bundle.mjs` must pass GAS parser/compat tests; `node --test radar-service/test/rich300-buttons.test.mjs` and focused app/regression tests must pass. Verify 320/390px rendering in real browser (previous CI skipped Playwright).
4. **Source isolation**: integrate PR #65 UI and PR #66 `Follow.gs`+`follow.mjs` on top of the **verified current live code**, preserving unrelated production fixes and v13 HMAC/auth. If parity or merge is uncertain, **STOP and report**, do not overwrite production.
5. **Staging read-only**: with no outbound Telegram, verify `RICH300_HOURLY_FOLLOW=preview`, no new Fill, no imaginary PnL, no new state writes; confirm original recommendation reasons and 1h/4h market freshness logic.
6. **Update existing deployment only**: after successful staging and approved code parity, publish as a new Apps Script code version and update the same Deployment ID. Verify `/exec` URL unchanged and owner authentication intact.
7. **Activate**: set `RICH300_HOURLY_FOLLOW=on` **in existing project's Script Properties only after** confirming Bot gate and paired chat. Verify exactly one `rich300WatchTick` 5-min trigger exists; do not create a duplicate. Verify poll trigger for `rich300TgPoll`; do not change existing trigger topology without necessity.
8. **Smoke test** in isolated [TEST] context: `[진입했어]` creates Response and tracking state, not Fill; no hourly report before 60m; next eligible tick delivers one; message includes `[유지 중]`/`[정리했어]`; close stops further sends; no stale-market send; historical responses not auto-started. Never inject synthetic trades into production financial ledger.
9. **Evidence**: report actual script version, Deployment ID, trigger counts, effective flags, Telegram *server-acknowledged* send IDs (no token/content), and what remains unverified until user confirms receipt. Check first live 1-hour cycle before declaring active.
10. **Rollback**: on any regression disable `RICH300_HOURLY_FOLLOW` before rollback, then point existing Deployment ID at saved v13 code version and restore only deliberately modified properties. Keep Responses/Fills immutable.

## Runtime behavior

- `[진입했어]`: opt-in `tg:follow:<sid>` state; **does not create Fill**. `[안 했어]`: no tracking.
- The hourly runner is called only through the existing 5-minute `rich300WatchTick`, with `RICH300_HOURLY_FOLLOW` default **off**.
- After at least 60 minutes, send a concise assessment of ORIGINAL recommendation conditions and 1H/4H trend/volume, using current public market prices. Every hour thereafter, only while active.
- For source S strategy, if detailed original `📈 근거` lines are present they are persisted in `Signals.summary`; when absent use explicitly identified S-strategy rule summary rather than inventing price-zone evidence.
- `[유지 중]`: confirm continued holding; analysis cadence unchanged. `[정리했어]`: permanently stop future reports for that signal (does **not** forge exchange Fill or realized PnL).
- If user records an actual full close Fill, follow-up also stops. Old button clicks cannot reopen a closed follow record.
- When data is stale / unavailable, report is **withheld**; never claim profitability or exact exit execution from a quote.
- Budget: at most 12 positions processed per tick. Production Telegram reports/alerts must respect existing owner gate and never require private exchange credentials.

## Acceptance

| Requirement | Must verify |
|---|---|
| Main radar still scans and feeds | 3+ successive healthy runs and no source conflict |
| Apps Script deployment URL unchanged | Compare before/after Deployment ID and URL |
| 2-button initial Telegram UX | Both emitting radar and receiving Apps Script validated |
| Only real trades in PnL | Entry-button records kept as unconfirmed until Fill |
| Day goal exactly 5% of actual start | Day1 $300->$315, prev actual close $350 -> next $367.50 |
| Once-hourly fresh-market follow-up | 1H and 4H candles, source time, original reasoning |
| Stop/hold buttons | Owner-only, dedupe, irreversible stop from old cards |
| Alert configuration | RICH300_HOURLY_FOLLOW=on, existing watch tick present and single |
| User delivery check | Telegram recipient confirms actual message |

Do not mark the project **live** on the basis of CI or code merge alone.
