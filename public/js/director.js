// Broadcast "director": rotates segments like a TV rundown.
const PLAYLIST = [
  // Senate is decided (AP, 11:34 PM). Focus: the races still in doubt — MICHIGAN and MAINE above all.
  { id: 'mi-sen', durationMs: 20000 },
  { id: 'spotlight', pick: 'ME', durationMs: 20000 },   // Maine (falls back to closest Senate race)
  { id: 'ahead', durationMs: 16000 },
  { id: 'mi-sen', durationMs: 16000 },
  { id: 'spotlight', pick: 'ME', durationMs: 16000 },
  { id: 'spotlight', n: 1, durationMs: 14000 },          // next-closest (Nebraska / Minnesota / Alaska)
  { id: 'wave', durationMs: 15000 },
  { id: 'fun', durationMs: 22000 },
  { id: 'mi-sen', durationMs: 16000 },
  { id: 'spotlight', pick: 'ME', durationMs: 16000 },
  { id: 'senate', durationMs: 12000 },                   // victory-lap recap
  { id: 'spotlight', n: 2, durationMs: 12000 },
  { id: 'pineplains', durationMs: 8000 },
];
const KEY_IDS = ['pineplains', 'mi-sen', 'tx-sen', 'ia-gov', 'spotlight', 'balance', 'battleground', 'history', 'senate', 'wave', 'ahead', 'fun'];


export function createDirector(targets) {
  let spotN = 0, spotPick = null, histFlip = false;
  let state = null, idx = 0, timer = null, paused = false, current = null;

  function resolve(id) {
    if (!state) return null;
    if (id === 'balance' || id === 'battleground' || id === 'senate' || id === 'wave' || id === 'fun' || id === 'ahead') return null;
    if (id === 'history') return state.watch?.find((r) => r.key === 'pineplains') || null; // insights picks its town from seg.town
    if (id === 'spotlight') return (spotPick && state.spotlight?.find((r) => r.state === spotPick)) || state.spotlight?.[spotN] || state.spotlight?.[0] || null;
    return state.watch?.find((r) => r.key === id) || null;
  }
  function show(i, { hold, adhoc, force } = {}) {
    // adhoc: a segment not in the rotation (e.g. clicked tile); shown once, then the rotation resumes after idx
    if (!adhoc) idx = ((i % PLAYLIST.length) + PLAYLIST.length) % PLAYLIST.length;
    const p = adhoc || PLAYLIST[idx];
    spotN = p.n || 0; spotPick = p.pick || null;
    const seg = { ...p, race: resolve(p.id), index: idx, startedAt: Date.now() };
    if (p.id === 'history') { histFlip = !histFlip; seg.town = histFlip ? 'pineplains' : 'stanford'; } // alternate towns each pass
    if (p.id === 'spotlight' && !seg.race) return show(idx + 1);
    // decided races drop out of the ROTATION only (calls/clicks use force and always show): interesting > settled
    if (!adhoc && !force && ['mi-sen', 'tx-sen', 'ia-gov'].includes(p.id) && seg.race?.candidates?.some((c) => c.winner)) return show(idx + 1);
    current = seg;
    const bgSeg = p.id === 'battleground';
    for (const t of targets) {
      let s2 = seg;
      if (bgSeg && !t.__bg) s2 = { ...seg, id: 'balance', race: null };
      else if (p.id === 'senate' && !t.__senate) s2 = { ...seg, id: 'balance', race: null, titleOverride: 'SENATE WATCH' };
      else if (p.id === 'wave' && !t.__wave) s2 = { ...seg, id: 'balance', race: null, titleOverride: 'THE BIG PICTURE' };
      else if (p.id === 'fun' && !t.__fun) s2 = { ...seg, id: 'balance', race: null, titleOverride: 'MEANWHILE…' };
      else if (p.id === 'ahead' && !t.__ahead) s2 = { ...seg, id: 'balance', race: null, titleOverride: 'AHEAD OF THE NEWS' };
      else if (p.id === 'history' && !t.__hist && !t.__bg) {
        // 3D: hometown terrain in the normal stage window; overlay: a plain narrow card hidden under the history board
        // (giving the overlay 'pineplains' drew the WIDE hometown card, which poked out from under the board)
        s2 = t.__scene ? { ...seg, id: 'pineplains', stageRect: { x0: 0.26, x1: 0.71, y0: 0.08, y1: 0.79 } } : { ...seg, id: 'balance', race: null, titleOverride: 'HOMETOWN INSIGHTS' };
      }
      try { t.showSegment?.(s2); } catch (e) { report(e); }
    }
    clearTimeout(timer);
    if (!paused && !hold) timer = setTimeout(() => show(idx + 1), p.durationMs);
  }
  function report(e) { console.error(e); fetch('/api/clientlog', { method: 'POST', body: JSON.stringify({ kind: 'director', error: String(e.stack || e) }) }).catch(() => {}); }

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { paused = !paused; if (!paused) show(idx + 1); else clearTimeout(timer); }
    const n = Number(e.key);
    if (n >= 1 && n <= KEY_IDS.length) { jump(KEY_IDS[n - 1]); }
    if (e.key === 'ArrowRight') show(idx + 1);
    if (e.key === 'ArrowLeft') show(idx - 1);
  });

  function jump(id) {
    const i = PLAYLIST.findIndex((p) => p.id === id);
    if (i >= 0) show(i, { force: true });
    else show(idx, { adhoc: { id, durationMs: 20000 } }); // not in rotation: show it, then continue
  }
  return {
    update(s) {
      const first = !state;
      state = s;
      if (first) show(0);
      else if (current) { current.race = resolve(current.id); }
    },
    jumpTo(id) {
      const i = PLAYLIST.findIndex((p) => p.id === id);
      if (i >= 0) show(i, { force: true });
      else show(idx, { adhoc: { id, durationMs: 20000 } }); // not in rotation (e.g. Stanford Council): show it, then continue
    },
    get current() { return current; },
  };
}
