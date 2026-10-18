// Read-only preview: run the opportunity radar once against the public OKX API and print what it would report.
// No Telegram, no secrets, no state file. Usage: node radar-service/opportunity/preview-cli.mjs [--top N]
import { runOpportunitySafe } from './step.mjs';

const args = process.argv.slice(2), top = args.includes('--top') ? args[args.indexOf('--top') + 1] : '20';
const state = {};
const out = await runOpportunitySafe({ now: Date.now(), state, env: { RADAR_OPPORTUNITY: 'preview', RADAR_OPPORTUNITY_TOP: top }, send: null, save: async () => {}, force: true, log: () => {} });
const { preview, ...rest } = out;
console.log('OPPORTUNITY ' + JSON.stringify(rest));
if (preview) {
  if (preview.note) console.log('NOTE ' + preview.note);
  console.log('--- per-coin state ---'); preview.lines.forEach(l => console.log(l));
  console.log('--- messages that would be sent (' + preview.messages.length + ') ---'); preview.messages.forEach((m, i) => console.log('[' + (i + 1) + ']\n' + m + '\n'));
}
