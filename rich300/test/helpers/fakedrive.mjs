// R8 테스트용 가짜 Drive + 다중 스프레드시트(메모리). 사본은 깊은 복사, 휴지통 이동은 목록에서 제외, 고장 주입을 지원한다.
import { memEnv } from './memenv.mjs';
import { storeInit } from '../../lib/store.mjs';

export function cloneMem(src) {
  const c = memEnv({ fixedClock: true }); for (const [k, rows] of src.sheets) c.sheets.set(k, rows.map(r => [...r])); for (const [k, h] of src.headers) c.headers.set(k, [...h]); return c;
}
export function fakeDrive({ live } = {}) {
  const files = new Map(), st = { next: 1, copyFail: false, trashed: [], copies: 0, tamperNext: null, folders: new Map() };
  files.set('SRC', { id: 'SRC', name: 'RICH300 prod', folder: null, mem: live, trashed: false });
  const api = {
    sourceId: 'SRC',
    ensureFolder: () => { if (!st.folders.has('B')) st.folders.set('B', 'FOLDER-B'); return st.folders.get('B'); },
    list: fid => [...files.values()].filter(f => f.folder === fid && !f.trashed).map(f => ({ id: f.id, name: f.name, createdAt: f.created ?? 0 })),
    copy: (sourceId, name, fid) => { if (st.copyFail) throw new Error('copy failed'); const src = files.get(sourceId); const id = `F${st.next++}`; const mem = cloneMem(src.mem); st.copies++; if (st.tamperNext) { st.tamperNext(mem); st.tamperNext = null; } files.set(id, { id, name, folder: fid, mem, trashed: false, created: st.next }); return { id }; },
    openStore: id => { const f = files.get(id); if (!f) throw new Error('not found'); return f.mem.env; },
    trash: id => { files.get(id).trashed = true; st.trashed.push(files.get(id).name); },
  };
  return { files, st, drive: api, put: (id, name, folder, mem) => files.set(id, { id, name, folder, mem, trashed: false }) };
}
export function liveStore(fn) { const m = memEnv({ fixedClock: true }); storeInit(m.env); if (fn) fn(m); return m; }
