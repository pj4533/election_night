// RSS/Atom headline poller for the chyron.
import { NEWS } from '../config.mjs';
import { get } from '../http.mjs';

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;|&#8217;|&rsquo;/g, '’').replace(/&#8216;|&lsquo;/g, '‘').replace(/&#8220;|&ldquo;/g, '“')
  .replace(/&#8221;|&rdquo;/g, '”').replace(/&#8211;|&ndash;/g, '–').replace(/&#8212;|&mdash;/g, '—')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/\s+/g, ' ').trim();
const tag = (xml, t) => { const m = xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)); return m ? decode(m[1]) : ''; };

const ELECTION_WORDS = /elect|vote|ballot|poll|senat|governor|house|congress|race|win|lead|call|projected|midterm|campaign|democrat|republican|gop|turnout|precinct|count/i;

export function createNews(store) {
  let timer;
  async function feed(f) {
    const r = await get('news', f.url, { json: false, label: f.name + (f.tag ? `:${f.tag}` : ''), timeoutMs: 12_000 });
    if (!r.body) return [];
    const items = r.body.split(/<item[\s>]|<entry[\s>]/).slice(1);
    return items.slice(0, 25).map((it) => {
      let title = tag(it, 'title');
      let source = f.name;
      const src = tag(it, 'source');
      if (f.name === 'Google News') {
        const i = title.lastIndexOf(' - ');
        if (i > 0) { source = title.slice(i + 3); title = title.slice(0, i); }
        if (src) source = src;
      }
      const date = Date.parse(tag(it, 'pubDate') || tag(it, 'published') || tag(it, 'updated') || tag(it, 'dc:date')) || null;
      return { title, source, date, tag: f.tag || null, link: tag(it, 'link') };
    }).filter((x) => x.title && (f.tag || ELECTION_WORDS.test(x.title)));
  }
  async function tick() {
    const all = (await Promise.all(NEWS.feeds.map(feed))).flat();
    store.setNews(all);
    store.setSourceStatus('news', { ok: all.length > 0, lastPoll: Date.now(), count: all.length });
  }
  return { start() { tick(); timer = setInterval(tick, NEWS.intervalMs); }, stop() { clearInterval(timer); } };
}
