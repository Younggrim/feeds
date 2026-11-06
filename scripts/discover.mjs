// Discover: searches YouTube for each topic in topics.json and returns filtered videos.
// Needs YT_API_KEY. Reuses the live site's discover.json if it is fresh, to save API quota.
const API = 'https://www.googleapis.com/youtube/v3';

export async function discover({ key, topics, blocked, blockedChannels, subscribed, isShort, liveUrl }) {
  const refreshMs = (topics.refreshHours || 6) * 3600000;
  try {
    const r = await fetch(liveUrl + '?t=' + Date.now());
    if (r.ok) {
      const prev = await r.json();
      if (prev.updated && Date.now() - Date.parse(prev.updated) < refreshMs) return { ...prev, reused: true };
    }
  } catch { /* site not reachable yet: refresh */ }
  if (!key) return null;

  const get = async (path, params) => {
    const u = new URL(API + path);
    for (const [k, v] of Object.entries({ ...params, key })) u.searchParams.set(k, v);
    const r = await fetch(u);
    if (!r.ok) throw new Error(`${path} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };

  const after = new Date(Date.now() - 7 * 86400000).toISOString();
  const found = new Map();
  for (const t of topics.topics) {
    const s = await get('/search', {
      part: 'snippet', type: 'video', q: t.query, safeSearch: 'strict', order: 'relevance',
      publishedAfter: after, relevanceLanguage: 'en', regionCode: 'US', maxResults: 25,
    });
    for (const it of s.items || []) {
      const id = it.id.videoId, sn = it.snippet;
      if (!id || found.has(id)) continue;
      if (subscribed.has(sn.channelId) || blockedChannels.has(sn.channelId)) continue;
      const text = `${sn.title}\n${sn.description}`;
      if (blocked.some(re => re.test(text))) continue;
      found.set(id, { id, title: decode(sn.title), published: sn.publishedAt, channel: decode(sn.channelTitle),
        channelId: sn.channelId, topic: t.name, category: 'Discover', discover: true });
    }
  }

  // Drop small channels and anything YouTube marks as made for kids or age-restricted.
  const vids = [...found.values()];
  const chanIds = [...new Set(vids.map(v => v.channelId))];
  const subs = new Map();
  for (let i = 0; i < chanIds.length; i += 50) {
    const c = await get('/channels', { part: 'statistics', id: chanIds.slice(i, i + 50).join(',') });
    for (const ch of c.items || []) subs.set(ch.id, ch.statistics.hiddenSubscriberCount ? 0 : Number(ch.statistics.subscriberCount));
  }
  const restricted = new Set();
  for (let i = 0; i < vids.length; i += 50) {
    const v = await get('/videos', { part: 'contentDetails', id: vids.slice(i, i + 50).map(x => x.id).join(',') });
    for (const it of v.items || []) if (it.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted') restricted.add(it.id);
  }
  let keep = vids.filter(v => (subs.get(v.channelId) || 0) >= (topics.minSubscribers || 10000) && !restricted.has(v.id));
  const shorts = await Promise.all(keep.map(v => isShort(v.id)));
  keep = keep.map((v, i) => ({ ...v, short: shorts[i] }))
    .sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
  return { updated: new Date().toISOString(), videos: keep };
}

function decode(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}
