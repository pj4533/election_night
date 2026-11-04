import { connect } from './data.js';
import { createDirector } from './director.js';
import { startAutoFit } from './fit.js';

// Load each module independently so one missing/broken module never blanks the whole broadcast.
const load = async (path, name) => { try { return (await import(path))[name]; } catch (e) { console.error(path, e); fetch('/api/clientlog', { method: 'POST', body: JSON.stringify({ kind: 'import', path, error: String(e?.stack || e) }) }).catch(() => {}); return null; } };
const [createScene, createOverlay, createChyron, createAlerts, createBattleground, createSenate, createWave, createAhead, createHistory, createFun] = await Promise.all([
  load('./scene/scene.js', 'createScene'), load('./overlay.js', 'createOverlay'),
  load('./chyron.js', 'createChyron'), load('./alerts.js', 'createAlerts'), load('./battleground.js', 'createBattleground'), load('./senate.js', 'createSenate'), load('./wave.js', 'createWave'), load('./ahead.js', 'createAhead'), load('./insights.js', 'createInsights'), load('./fun.js', 'createFun'),
]);

function report(kind, e) {
  console.error(kind, e);
  fetch('/api/clientlog', { method: 'POST', body: JSON.stringify({ kind, error: String(e?.stack || e?.message || e) }) }).catch(() => {});
}
window.addEventListener('error', (e) => report('window.error', e.error || e.message));
window.addEventListener('unhandledrejection', (e) => report('unhandledrejection', e.reason));

const safe = (name, fn) => { try { return fn(); } catch (e) { report(name, e); return null; } };
const scene = createScene && safe('scene', () => createScene(document.getElementById('stage')));
const overlay = createOverlay && safe('overlay', () => createOverlay(document.getElementById('overlay')));
const chyron = createChyron && safe('chyron', () => createChyron(document.getElementById('chyron')));
const alerts = createAlerts && safe('alerts', () => createAlerts(document.getElementById('alerts')));
const battle = createBattleground && safe('battle', () => createBattleground(document.getElementById('battle')));
if (battle) battle.__bg = true;
if (scene) scene.__scene = true;
const senate = createSenate && safe('senate', () => createSenate(document.getElementById('senate')));
if (senate) senate.__senate = true;
const wave = createWave && safe('wave', () => createWave(document.getElementById('wave')));
if (wave) wave.__wave = true;
const fun = createFun && safe('fun', () => createFun(document.getElementById('fun')));
if (fun) fun.__fun = true;
const ahead = createAhead && safe('ahead', () => createAhead(document.getElementById('ahead')));
if (ahead) ahead.__ahead = true;
// 'history' segment = HOMETOWN INSIGHTS takeover (insights.js); the old history.js board is retired
const hist = createHistory && safe('insights', () => createHistory(document.getElementById('insights')));
if (hist) hist.__hist = true;
const modules = [scene, overlay, chyron, alerts, battle, hist, senate, wave, fun, ahead].filter(Boolean);
const director = createDirector([scene, overlay, battle, hist, senate, wave, fun, ahead].filter(Boolean));

startAutoFit();
// clicking a watchlist tile / control panel cuts the broadcast to that segment
window.addEventListener('broadcast:jump', (e) => director.jumpTo(e.detail));
let latest = null;
connect({
  onState(s) {
    latest = s;
    window.__state = s;
    for (const m of modules) safe('update', () => m.update?.(s));
    director.update(s);
  },
  onEvent(ev) {
    for (const m of modules) safe('onEvent', () => m.onEvent?.(ev, latest));
    // big moments in watched races: cut the broadcast to that race
    // hometown results: cut to that race IMMEDIATELY (user wants to see it right away)
    if (['pineplains', 'stanford-council'].includes(ev.raceKey) && ['first', 'votes', 'lead', 'call'].includes(ev.type)) director.jumpTo(ev.raceKey);
    else if (ev.priority >= 3 && ['mi-sen', 'tx-sen', 'ia-gov'].includes(ev.raceKey)) setTimeout(() => director.jumpTo(ev.raceKey), 6000);
  },
  onStatus(ok) { document.getElementById('conn').classList.toggle('show', !ok); },
});

// heartbeat so the server log shows the screen is alive (and fps)
let frames = 0; (function f() { frames++; requestAnimationFrame(f); })();
setInterval(() => {
  fetch('/api/clientlog', { method: 'POST', body: JSON.stringify({ kind: 'heartbeat', fps: Math.round(frames / 60), segment: director.current?.id, stateAge: latest ? Date.now() - latest.now : null }) }).catch(() => {});
  frames = 0;
}, 60_000);
