import { randomUUID } from 'node:crypto'

const text = value => typeof value === 'string' && value.trim() && value.length <= 256
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k))
export function validRidePreview(p) {
  const place = value => exact(value, ['handle', 'name', 'city', 'address', 'location']) && text(value.handle) && text(value.name) && text(value.city) && typeof value.address === 'string' && value.address.length <= 256 && exact(value.location, ['lng', 'lat']) && Number.isFinite(value.location.lng) && Math.abs(value.location.lng) <= 180 && Number.isFinite(value.location.lat) && Math.abs(value.location.lat) <= 90
  if (!exact(p, ['handle', 'status', 'from', 'to', 'expiresAt', 'measuredAt', 'items', 'sandbox', 'message']) || !['quoted', 'choose_places', 'needs_location'].includes(p.status) || Buffer.byteLength(JSON.stringify(p)) > 16384 || (p.sandbox !== undefined && typeof p.sandbox !== 'boolean')) return false
  if (p.status === 'needs_location' && p.handle === undefined) return typeof p.message === 'string' && p.message.length <= 256
  return text(p.handle) && Number.isFinite(p.expiresAt) && Number.isFinite(Date.parse(p.measuredAt)) && ['from', 'to'].every(k => Array.isArray(p[k]) && p[k].length <= 8 && p[k].every(place)) &&
    (p.items === undefined || (Array.isArray(p.items) && p.items.length > 0 && p.items.length <= 16 && p.items.every(i => exact(i, ['productName', 'productCategory', 'priceText']) && [i.productName, i.productCategory, i.priceText].every(text))))
}
const cityKey = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/市$/, '') : ''
/** Read-only discovery shares the reviewed transport, never the transaction's quote or confirmation turn. */
export function createRidePreview({ call, now = Date.now, ttlMs = 120000 }) {
  const previews = new Map()
  function prune() { for (const [id, p] of previews) if (p.expiresAt <= now() || !p.valid()) previews.delete(id) }
  function routeFrom(p, from, to) {
    const start = p.from.find(place => place.handle === from), end = p.to.find(place => place.handle === to)
    if (!start || !end) throw Error('Choose actual returned place handles')
    return { from_lng: String(start.location.lng), from_lat: String(start.location.lat), from_name: start.name, to_lng: String(end.location.lng), to_lat: String(end.location.lat), to_name: end.name }
  }
  return {
    async search({ city, from, to }, signal, valid = () => true) {
      if (![city, from, to].every(text)) throw Error('A city and both place names are required')
      prune()
      if (previews.size >= 16) throw Error('Ride preview limit reached')
      const search = async keywords => {
        signal?.throwIfAborted()
        const results = await call('maps_textsearch', { city, keywords })
        signal?.throwIfAborted()
        if (!valid()) throw Error('Intent changed')
        if (!Array.isArray(results) || results.length > 100) throw Error('Invalid place results')
        return results.filter(p => text(p.display_name) && text(p.city) && cityKey(p.city) === cityKey(city) && Number.isFinite(p.location?.lng) && Math.abs(p.location.lng) <= 180 && Number.isFinite(p.location?.lat) && Math.abs(p.location.lat) <= 90)
          .slice(0, 8).map(p => ({ handle: randomUUID(), name: p.display_name, city: p.city, address: typeof p.address_all === 'string' ? p.address_all.slice(0, 256) : typeof p.address === 'string' ? p.address.slice(0, 256) : '', location: { lng: p.location.lng, lat: p.location.lat } }))
      }
      const starts = await search(from), ends = await search(to)
      const p = { handle: randomUUID(), from: starts, to: ends, expiresAt: now() + ttlMs, valid }
      let items
      if (starts.length === 1 && ends.length === 1) {
        const quote = await call('taxi_estimate', routeFrom(p, starts[0].handle, ends[0].handle))
        signal?.throwIfAborted()
        if (!valid()) throw Error('Intent changed')
        if (!text(quote?.traceId) || !Array.isArray(quote.items) || quote.items.length < 1 || quote.items.length > 16 || !quote.items.every(i => text(i.productName) && text(i.productCategory) && text(i.priceText))) throw Error('Invalid ride estimate')
        items = quote.items.map(({ productName, productCategory, priceText }) => ({ productName, productCategory, priceText }))
      }
      if (!valid()) throw Error('Intent changed')
      const output = { handle: p.handle, status: items ? 'quoted' : starts.length && ends.length ? 'choose_places' : 'needs_location', from: starts, to: ends,
        expiresAt: p.expiresAt, measuredAt: new Date(now()).toISOString(), ...(items ? { items } : {}) }
      if (!validRidePreview(output)) throw Error('Ride preview exceeds the safe projection limits')
      previews.set(p.handle, p)
      return output
    },
    route({ handle, from, to }) {
      prune()
      const p = previews.get(handle)
      if (!p) throw Error('Ride preview expired or changed; search again')
      return routeFrom(p, from, to)
    },
    clear() { previews.clear() },
  }
}
