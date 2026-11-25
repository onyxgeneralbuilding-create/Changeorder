// Live Google review rating and count, via the Google Places API (New).
// Needs GOOGLE_PLACES_API_KEY (env) and the business's Place ID (Settings).
// Results are cached for 6 hours, which stays well inside Google's free monthly usage.
const store = require('./store');

const TTL = 6 * 60 * 60 * 1000;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

function configured(settings = store.getSettings()) {
  return Boolean(process.env.GOOGLE_PLACES_API_KEY && settings.googlePlaceId);
}

async function fetchPlace(placeId) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: {
        'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'displayName,rating,userRatingCount,googleMapsUri',
      },
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error?.message || `Google returned ${res.status}`);
    return {
      name: data.displayName?.text || '',
      rating: typeof data.rating === 'number' ? data.rating : null,
      count: data.userRatingCount || 0,
      uri: data.googleMapsUri || '',
    };
  } finally {
    clearTimeout(timer);
  }
}

// Accepts a Place ID or a Google Maps link (including maps.app.goo.gl share links)
// and returns { placeId, name } using the Places API Text Search.
async function resolvePlace(input) {
  const raw = String(input || '').trim();
  if (/^ChIJ[\w-]{10,}$/.test(raw) || /^place_id:/.test(raw)) return { placeId: raw.replace(/^place_id:/, '') };
  if (!/^https?:\/\//.test(raw)) throw new Error('Paste a Google Maps link or a Place ID (starts with ChIJ).');
  if (!process.env.GOOGLE_PLACES_API_KEY) throw new Error('Add GOOGLE_PLACES_API_KEY in Render first, then paste the link again.');
  // Follow the share link to the full Google Maps address.
  let url = raw;
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } });
    const loc = res.headers.get('location');
    if (!loc) break;
    url = new URL(loc, url).toString();
  }
  const direct = /(ChIJ[\w-]{10,})/.exec(decodeURIComponent(url));
  if (direct) return { placeId: direct[1] };
  const m = /\/maps\/place\/([^/@]+)(?:\/@(-?[\d.]+),(-?[\d.]+))?/.exec(url);
  const q = new URL(url).searchParams.get('q');
  const name = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : q;
  if (!name) throw new Error('Couldn’t read the business from that link. Try copying the link again from Google Maps → Share.');
  const body = { textQuery: name, maxResultCount: 1 };
  if (m && m[2]) body.locationBias = { circle: { center: { latitude: Number(m[2]), longitude: Number(m[3]) }, radius: 2000 } };
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY, 'X-Goog-FieldMask': 'places.id,places.displayName' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Google returned ${res.status}`);
  const p = (data.places || [])[0];
  if (!p) throw new Error(`Google couldn’t find “${name}”.`);
  return { placeId: p.id, name: p.displayName?.text || name };
}

// Returns { configured, rating, count, uri, name, fetchedAt, monthGain, yearGain, error }
async function getReviews({ force = false } = {}) {
  const settings = store.getSettings();
  if (!configured(settings)) return { configured: false };
  let cache = settings.reviewsCache;
  const fresh = cache && cache.placeId === settings.googlePlaceId && Date.now() - Date.parse(cache.fetchedAt) < TTL;
  let error = null;
  if (!fresh || force) {
    try {
      const p = await fetchPlace(settings.googlePlaceId);
      cache = { ...p, placeId: settings.googlePlaceId, fetchedAt: new Date().toISOString() };
      // Keep one snapshot per day to show growth.
      const hist = (settings.reviewsHistory || []).filter((h) => h.placeId === settings.googlePlaceId && h.date !== today());
      hist.push({ date: today(), count: p.count, rating: p.rating, placeId: settings.googlePlaceId });
      store.updateSettings({ reviewsCache: cache, reviewsHistory: hist.slice(-800) });
    } catch (e) {
      error = e.name === 'AbortError' ? 'Google didn’t respond in time.' : e.message;
      console.error(`Google reviews: ${error}`);
    }
  }
  if (!cache || cache.placeId !== settings.googlePlaceId) return { configured: true, error: error || 'No data yet.' };
  const hist = (store.getSettings().reviewsHistory || []).filter((h) => h.placeId === settings.googlePlaceId);
  const d = today();
  // Gain = count now minus the first snapshot in this month/year (only if tracking started before then).
  const before = (prefix) => [...hist].reverse().find((h) => h.date < prefix);
  const gain = (prefix) => { const b = before(prefix); return b ? cache.count - b.count : null; };
  return {
    configured: true, ...cache, error,
    monthGain: gain(`${d.slice(0, 7)}-01`),
    yearGain: gain(`${d.slice(0, 4)}-01-01`),
    trackingSince: hist.length ? hist[0].date : null,
  };
}

module.exports = { getReviews, configured, resolvePlace };
