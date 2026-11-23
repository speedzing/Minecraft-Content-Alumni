// Finds a title's videos on YouTube with the YouTube Data API (needs YOUTUBE_API_KEY).
// A video only counts as official when its title names the production AND its channel
// matches someone credited on the title (director, writer, creator, cast, studio) or a
// channel already in the title's links. Everything else is returned as a suggestion to review.
const API = 'https://www.googleapis.com/youtube/v3/';
const SEARCH_RESULTS = 15;
const MAX_SUGGESTIONS = 5;
const FILM_MIN_SECONDS = 15 * 60;
const NOT_OFFICIAL = /unofficial|fan[\s-]?made|fan film|reaction|reacts?\b|review|parody|edit\b|animatic/i;

export const hasYouTubeKey = () => Boolean(process.env.YOUTUBE_API_KEY);

export const linkType = title => /trailer/i.test(title) ? 'trailer'
  : /teaser/i.test(title) ? 'teaser'
  : /soundtrack|\bost\b/i.test(title) ? 'soundtrack'
  : /behind|making of|commentary|interview|bts|blooper/i.test(title) ? 'extra'
  : 'video';

export const normalize = s => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

const seconds = iso => {
  const m = (iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0) : 0;
};

async function api(endpoint, params) {
  const url = new URL(API + endpoint);
  for (const [k, v] of Object.entries({ ...params, key: process.env.YOUTUBE_API_KEY })) url.searchParams.set(k, v);
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(`YouTube API: ${body.error?.message || `HTTP ${res.status}`}`);
  return body;
}

// Names whose channels count as official for this title.
export function officialNames(title) {
  const people = ['directors', 'writers', 'creators', 'stars', 'cast', 'studios'].flatMap(k => title[k] || []);
  const names = new Set(people.map(p => normalize(p.name)));
  for (const l of title.links || []) if (l.official !== false && l.channel) names.add(normalize(l.channel));
  names.delete('');
  return names;
}

// Splits YouTube video resources (videos.list items) into official links and suggestions.
export function sortVideos(title, videos) {
  const wanted = normalize(title.title);
  const names = officialNames(title);
  const official = [], suggestions = [];
  for (const v of videos) {
    const { title: videoTitle, channelTitle, channelId } = v.snippet;
    if (!wanted || !normalize(videoTitle).includes(wanted)) continue;
    let type = linkType(videoTitle);
    if (type === 'video' && seconds(v.contentDetails?.duration) >= FILM_MIN_SECONDS) type = 'film';
    const isOfficial = names.has(normalize(channelTitle)) && !NOT_OFFICIAL.test(videoTitle);
    (isOfficial ? official : suggestions).push({
      type, label: videoTitle, url: `https://www.youtube.com/watch?v=${v.id}`, platform: 'youtube',
      youtubeId: v.id, channel: channelTitle, channelId, official: isOfficial, source: 'youtube-search',
    });
  }
  const channels = new Map(official.map(l => [l.channelId, l.channel]));
  for (const [channelId, channel] of channels) {
    official.push({ type: 'channel', label: channel, url: `https://www.youtube.com/channel/${channelId}`, platform: 'youtube',
      youtubeId: null, channel, channelId, official: true, source: 'youtube-search' });
  }
  return { official, suggestions: suggestions.slice(0, MAX_SUGGESTIONS) };
}

// Two API calls per title: search (100 quota units) + videos (1 unit). The free quota is 10,000/day.
export async function findYouTubeLinks(title) {
  const search = await api('search', { part: 'snippet', type: 'video', maxResults: SEARCH_RESULTS, q: title.title });
  const ids = search.items.map(i => i.id?.videoId).filter(Boolean);
  if (!ids.length) return { official: [], suggestions: [] };
  const details = await api('videos', { part: 'snippet,contentDetails', id: ids.join(',') });
  return sortVideos(title, details.items);
}

// Adds links that aren't stored yet; channels are matched by name so a @handle link isn't duplicated.
export function mergeLinks(existing = [], incoming = []) {
  const merged = [...existing];
  for (const link of incoming) {
    const dupe = merged.some(l => l.url === link.url
      || (link.youtubeId && l.youtubeId === link.youtubeId)
      || (link.type === 'channel' && l.type === 'channel' && normalize(l.channel) === normalize(link.channel)));
    if (!dupe) merged.push(link);
  }
  return merged.slice(existing.length);
}
