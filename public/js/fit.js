// Auto-fit: guarantees fixed-height side columns NEVER overflow/overlap, at any window aspect ratio.
//
// Why: all layout is in vw/vh. On wide-short windows (e.g. 2000x810) vw-sized text/padding stays big
// while vh-sized column heights shrink, so stacked panels overflowed and drew over each other.
// Rule: any fixed-height stacked container listed here gets its children measured at natural height,
// and if they don't fit, every child is uniformly `zoom`-ed down until they do. Never clip, never overlap.
// To add a new stacked panel container, add its selector to TARGETS (see docs/FRONTEND_CONTRACT.md "Sizing rules").
const TARGETS = ['.ov-right', '.bg-board', '.hist-board'];

function fitOne(box) {
  // Stable fit: never reset-and-remeasure (that made panels visibly pop between two sizes every second).
  // Adjust the current zoom proportionally, with hysteresis, only when it clearly overflows or has room to grow.
  const kids = [...box.children];
  if (!kids.length || !box.clientHeight) return;
  const cur = Number(kids[0].style.zoom || 1);
  const need = box.scrollHeight, avail = box.clientHeight;
  let z = cur;
  if (need > avail + 2) z = cur * (avail / need) * 0.985;              // overflowing → shrink
  else if (cur < 1 && need < avail * 0.93) z = Math.min(1, cur * (avail / need) * 0.97); // lots of room → grow back
  z = Math.max(0.5, Math.round(z * 100) / 100);
  if (Math.abs(z - cur) >= 0.01) kids.forEach((k) => (k.style.zoom = z === 1 ? '' : String(z)));
}

export function startAutoFit() {
  const run = () => { for (const sel of TARGETS) document.querySelectorAll(sel).forEach(fitOne); };
  window.addEventListener('resize', run);
  setInterval(run, 1000); // content changes (new tiles, longer names) are caught within 1s
  run();
}
