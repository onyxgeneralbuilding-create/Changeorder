// Address suggestions while typing (Google Places API New: Autocomplete + Place Details).
// The browser calls these; the API key never leaves the server.
module.exports = function placesRoutes(app, { requireLogin }) {
  const KEY = () => process.env.GOOGLE_PLACES_API_KEY;
  const g = async (url, opts = {}) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY(), ...(opts.headers || {}) } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error?.message || `Google returned ${res.status}`);
      return data;
    } finally { clearTimeout(t); }
  };

  app.get('/api/address/suggest', requireLogin, async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 120);
    if (!KEY() || q.length < 3) return res.json({ suggestions: [] });
    try {
      const data = await g('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: { 'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat' },
        body: JSON.stringify({
          input: q,
          includedRegionCodes: ['us'],
          includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
          // Prefer the San Fernando Valley / Los Angeles area.
          locationBias: { circle: { center: { latitude: 34.27, longitude: -118.5 }, radius: 50000 } },
          sessionToken: String(req.query.session || '').slice(0, 64) || undefined,
        }),
      });
      res.json({
        suggestions: (data.suggestions || []).map((s) => s.placePrediction).filter(Boolean).slice(0, 5).map((p) => ({
          id: p.placeId, main: p.structuredFormat?.mainText?.text || '', secondary: p.structuredFormat?.secondaryText?.text || '',
        })),
      });
    } catch (e) {
      console.error(`Address suggest: ${e.message}`);
      res.json({ suggestions: [], error: 'Address suggestions are unavailable right now.' });
    }
  });

  app.get('/api/address/details', requireLogin, async (req, res) => {
    const id = String(req.query.id || '').replace(/[^\w-]/g, '');
    if (!KEY() || !id) return res.status(400).json({});
    try {
      const session = String(req.query.session || '').slice(0, 64);
      const p = await g(`https://places.googleapis.com/v1/places/${id}${session ? `?sessionToken=${encodeURIComponent(session)}` : ''}`, {
        headers: { 'X-Goog-FieldMask': 'addressComponents' },
      });
      const comp = (type, short) => { const c = (p.addressComponents || []).find((x) => (x.types || []).includes(type)); return c ? (short ? c.shortText : c.longText) : ''; };
      const unit = comp('subpremise', true);
      const street = [comp('street_number', true), comp('route', true)].filter(Boolean).join(' ') + (unit ? `, ${/^\d/.test(unit) ? `#${unit}` : unit}` : '');
      const shown = String(req.query.city || '').trim().slice(0, 60);
      const city = shown || comp('locality') || comp('sublocality') || comp('postal_town') || comp('administrative_area_level_3');
      const cityStateZip = [city, [comp('administrative_area_level_1', true), comp('postal_code', true)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
      res.json({ street, cityStateZip });
    } catch (e) {
      console.error(`Address details: ${e.message}`);
      res.status(502).json({});
    }
  });
};
