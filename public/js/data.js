// SSE client with auto-reconnect and staleness watchdog.
export function connect({ onState, onEvent, onStatus }) {
  let es, lastMsg = Date.now();
  function open() {
    es = new EventSource('/events');
    es.addEventListener('state', (e) => { lastMsg = Date.now(); onStatus?.(true); onState(JSON.parse(e.data)); });
    es.addEventListener('event', (e) => { lastMsg = Date.now(); onEvent(JSON.parse(e.data)); });
    es.onopen = () => onStatus?.(true);
    es.onerror = () => onStatus?.(false);
  }
  open();
  setInterval(() => {
    if (Date.now() - lastMsg > 45_000) { onStatus?.(false); try { es.close(); } catch {} open(); lastMsg = Date.now(); }
  }, 10_000);
}
