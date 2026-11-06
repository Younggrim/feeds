// Builds site/feed.json from each channel's public YouTube RSS feed.
// Run: node scripts/build.mjs   (Node 20+, no dependencies)
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const channels = JSON.parse(await readFile('channels.json', 'utf8'));
const filters = JSON.parse(await readFile('filters.json', 'utf8'));

const maxAgeMs = (filters.maxAgeDays || 21) * 86400000;
const perChannel = filters.maxPerChannel || 10;
const blockedChannels = new Set(filters.blockedChannels || []);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blocked = (filters.blockedWords || []).map(w => new RegExp(`\\b${escapeRe(w)}\\b`, 'i'));

const decode = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return m ? decode(m[1].trim()) : ''; };

async function fetchText(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'feeds-builder/1.0' } });
      if (r.ok) return await r.text();
      if (r.status === 404) return null;
    } catch (e) { /* retry */ }
    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
  return null;
}

// A Short answers /shorts/ID with 200; a normal video redirects to /watch.
async function isShort(id) {
  try {
    const r = await fetch(`https://www.youtube.com/shorts/${id}`, { method: 'HEAD', redirect: 'manual' });
    return r.status === 200;
  } catch { return false; }
}

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

const now = Date.now();
const problems = [];
const results = await pool(channels.filter(c => !blockedChannels.has(c.id)), 8, async ch => {
  const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`);
  if (!xml) { problems.push(ch.name); return []; }
  return xml.split('<entry>').slice(1).map(e => ({
    id: tag(e, 'yt:videoId'),
    title: tag(e, 'title'),
    published: tag(e, 'published'),
    views: Number((e.match(/<media:statistics views="(\d+)"/) || [])[1] || 0),
    channel: ch.name,
    category: ch.category || 'More',
    channelId: ch.id,
    handle: ch.handle,
  }))
    .filter(v => v.id && now - Date.parse(v.published) < maxAgeMs)
    .filter(v => !blocked.some(re => re.test(v.title)))
    .slice(0, perChannel);
});

let videos = results.flat().sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
const shortFlags = await pool(videos, 8, v => isShort(v.id));
videos = videos.map((v, i) => ({ ...v, short: shortFlags[i] }));

await mkdir('site', { recursive: true });
await writeFile('site/feed.json', JSON.stringify({
  updated: new Date().toISOString(),
  channelCount: channels.length,
  categories: [...new Set(channels.map(c => c.category || 'More'))],
  missing: problems,
  videos,
}));
console.log(`${videos.length} videos from ${channels.length - problems.length}/${channels.length} channels` +
  (problems.length ? `; no feed for: ${problems.join(', ')}` : ''));
