import { inflateRawSync } from 'node:zlib';

const DAY = 86400000;
const ARCHIVE = 'https://nsearchives.nseindia.com';
const INDEX = 'https://www.niftyindices.com/IndexConstituent/';
export const sectorDefinitions = {
  auto: { sector: 'Automobile and Auto Components' },
  'capital-goods': { sector: 'Capital Goods' }, chemicals: { sector: 'Chemicals' },
  construction: { sector: 'Construction' }, materials: { sector: 'Construction Materials' },
  durables: { sector: 'Consumer Durables' }, 'consumer-services': { sector: 'Consumer Services' },
  diversified: { sector: 'Diversified' }, fmcg: { sector: 'Fast Moving Consumer Goods' },
  financial: { sector: 'Financial Services' }, forest: { sector: 'Forest Materials' },
  healthcare: { sector: 'Healthcare' }, it: { sector: 'Information Technology' },
  media: { sector: 'Media, Entertainment & Publication' }, metals: { sector: 'Metals & Mining' },
  energy: { sector: 'Oil, Gas & Consumable Fuels' }, power: { sector: 'Power' },
  realty: { sector: 'Realty' }, services: { sector: 'Services' }, telecom: { sector: 'Telecommunication' },
  textiles: { sector: 'Textiles' }, utilities: { sector: 'Utilities' },
  banks: { file: 'ind_niftybanklist.csv', index: 'Nifty Bank' },
  insurance: { file: 'ind_niftyInsurance_list.csv', index: 'Nifty Insurance' },
  finance: { file: 'ind_niftyNBFC_list.csv', index: 'Nifty NBFC' },
  'capital-markets': { file: 'ind_niftyCapitalMarkets_list.csv', index: 'Nifty Capital Markets' },
  pharma: { file: 'ind_niftypharmalist.csv', index: 'Nifty Pharma' },
  'health-services': { file: 'ind_niftyHospitals_list.csv', index: 'Nifty Hospitals' },
  aerospace: { file: 'ind_niftyindiadefence_list.csv', index: 'Nifty India Defence' },
  cement: { file: 'ind_NiftyCement_list.csv', index: 'Nifty Cement' },
  transport: { file: 'ind_niftyCommercialTransportServices_list.csv', index: 'Nifty Commercial & Transport Services' },
  leisure: { file: 'ind_niftyindiatourism_list.csv', index: 'Nifty India Tourism' },
};

export class MarketError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'MarketError'; this.status = status; }
}
export function todayIST(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function offsetDate(date, days) { return new Date(Date.parse(date + 'T00:00:00Z') + days * DAY).toISOString().slice(0, 10); }
export function number(value) {
  const text = String(value ?? '').replace(/[,\s₹]/g, '');
  return text && text !== '-' && Number.isFinite(Number(text)) ? Number(text) : null;
}
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  text = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (quoted) throw new MarketError('NSE returned an incomplete CSV report.');
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new MarketError('NSE returned an empty CSV report.');
  const headers = rows.shift().map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  return rows.map(values => Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ''])));
}
export function parseDate(raw) {
  const s = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // mTIMESTAMP contains the exchange session date. CH_TIMESTAMP is UTC midnight
  // in IST (18:30 on the previous UTC date) and must never be sliced directly.
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s); return Number.isFinite(+d) ? todayIST(d) : null;
  }
  const m = s.match(/^(\d{1,2})[- /]([A-Za-z]{3})[- /](\d{4})$/);
  if (!m) return null;
  const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[2].toLowerCase()) + 1;
  if (!month) return null;
  const date = `${m[3]}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  const parsed = new Date(date + 'T00:00:00Z');
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0,10) === date ? date : null;
}
export function normaliseHistory(rows) {
  if (!Array.isArray(rows)) throw new MarketError('NSE returned an unexpected historical-price format.');
  const prices = new Map();
  for (const row of rows) {
    if (row.CH_SERIES !== 'EQ') continue;
    const date = parseDate(row.mTIMESTAMP ?? row.CH_TIMESTAMP);
    const close = number(row.CH_CLOSING_PRICE), previous = number(row.CH_PREVIOUS_CLS_PRICE);
    if (date && close > 0) prices.set(date, { date, close, previousClose: previous > 0 ? previous : null,
      change: previous > 0 ? (close / previous - 1) * 100 : null });
  }
  return [...prices.values()].sort((a,b) => a.date.localeCompare(b.date));
}
export function sampleHistory(prices, days, end) {
  const start = offsetDate(end, 1 - days);
  const all = prices.filter(p => p.date <= end && (days === 1 || p.date >= start));
  const selected = days === 1 ? all.slice(-1) : all;
  const interval = Math.max(1, Math.ceil(days / 30), Math.ceil(selected.length / 30));
  const displayed = [];
  for (let i = selected.length - 1; i >= 0; i -= interval) displayed.push(selected[i]);
  displayed.reverse();
  const first = selected[0], latest = selected.at(-1);
  return { start, end, interval, observations: selected.length, prices: displayed,
    first: first ?? null, latest: latest ?? null,
    periodChange: days === 1 ? latest?.change ?? null : selected.length > 1 ? (latest.close / first.close - 1) * 100 : null };
}

// A bounded, process-local cache shares in-flight downloads and never stores errors.
const cache = new Map(), pending = new Map();
async function cached(key, ttl, work) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (pending.has(key)) return pending.get(key);
  const promise = work().then(value => {
    cache.delete(key); if (cache.size >= 300) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: Date.now() + ttl }); return value;
  }).finally(() => pending.delete(key));
  pending.set(key, promise); return promise;
}
let active = 0;
const queue = [];
async function download(url) {
  if (active >= 6) await new Promise(resolve => queue.push(resolve));
  else active++;
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json,text/csv,application/zip,*/*', Referer: 'https://www.nseindia.com/' } });
    if (!response.ok) throw new MarketError(`NSE could not supply this report (HTTP ${response.status}).`, response.status === 404 ? 404 : 502);
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > 20_000_000) throw new MarketError('The NSE report exceeded the supported size.');
    return data;
  } catch (error) {
    if (error instanceof MarketError) throw error;
    throw new MarketError('NSE did not respond in time. Please retry in a moment.');
  } finally { const next = queue.shift(); if (next) next(); else active--; }
}

export function extractMcap(zip) {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new MarketError('NSE returned an invalid ZIP report.');
  let p = zip.readUInt32LE(end + 16);
  const entries = zip.readUInt16LE(end + 10);
  for (let i = 0; i < entries; i++) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== 0x02014b50) break;
    const method = zip.readUInt16LE(p + 10), size = zip.readUInt32LE(p + 20), expanded = zip.readUInt32LE(p + 24);
    const len = zip.readUInt16LE(p + 28), extra = zip.readUInt16LE(p + 30), comment = zip.readUInt16LE(p + 32);
    const name = zip.subarray(p + 46, p + 46 + len).toString();
    if (/^mcap\d{8}\.csv$/i.test(name)) {
      const offset = zip.readUInt32LE(p + 42);
      if (offset + 30 > zip.length || expanded > 10_000_000) break;
      const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28);
      if (start + size > zip.length) break;
      const data = zip.subarray(start, start + size);
      if (method === 0) return data.toString('utf8');
      if (method === 8) return inflateRawSync(data, { maxOutputLength: 10_000_000 }).toString('utf8');
      break;
    }
    p += 46 + len + extra + comment;
  }
  throw new MarketError('The NSE daily report did not contain a market-capitalisation CSV.');
}

export async function loadConstituents(file = 'ind_niftytotalmarket_list.csv') {
  return cached('universe:' + file, 6 * 3600000, async () => {
    let data; let source;
    for (const url of [INDEX + file, ARCHIVE + '/content/indices/' + file]) {
      try { data = parseCsv((await download(url)).toString('utf8')); source = url; break; } catch { /* Try the official archive mirror. */ }
    }
    if (!data) throw new MarketError('The official NSE constituent list is temporarily unavailable.');
    const stocks = data.filter(r => r.symbol && r.companyname && r.industry && (!r.series || r.series === 'EQ'))
      .map(r => ({ symbol: r.symbol, name: r.companyname, sector: r.industry }));
    if (!stocks.length) throw new MarketError('The NSE constituent list did not contain any equity stocks.');
    return { stocks, source, fetchedAt: new Date().toISOString() };
  });
}
export async function loadMarketCaps() {
  const today = todayIST();
  return cached('marketcaps:' + today, 30 * 60000, async () => {
    for (let back = 0; back < 12; back++) {
      const date = offsetDate(today, -back), d = new Date(date + 'T00:00:00Z');
      if ([0,6].includes(d.getUTCDay())) continue;
      const stamp = date.slice(8,10) + date.slice(5,7) + date.slice(2,4);
      const source = `${ARCHIVE}/archives/equities/bhavcopy/pr/PR${stamp}.zip`;
      let data;
      try { data = await download(source); } catch (error) { if (error.status === 404) continue; throw error; }
      const rows = parseCsv(extractMcap(data));
      const caps = new Map();
      // The official header "Market Cap(Rs.)" normalises to "marketcaprs".
      for (const row of rows) if (row.series === 'EQ' && number(row.marketcaprs) > 0) caps.set(row.symbol, number(row.marketcaprs));
      if (!caps.size) throw new MarketError('NSE returned no usable market-capitalisation values.');
      return { caps, asOf: date, source };
    }
    throw new MarketError('No official NSE market-cap report was available in the past 12 days.');
  });
}

function canonical(text) { return text.toLowerCase().replace(/and/g,'&').replace(/[^a-z0-9]/g,''); }
export async function getSectorStocks(id) {
  const definition = sectorDefinitions[id];
  if (!definition) throw new MarketError('Choose a valid sector.', 400);
  const [universe, report] = await Promise.all([loadConstituents(definition.file), loadMarketCaps()]);
  const candidates = definition.file ? universe.stocks : universe.stocks.filter(s => canonical(s.sector) === canonical(definition.sector));
  const ranked = candidates.filter(s => report.caps.has(s.symbol)).map(s => ({ ...s, marketCap: report.caps.get(s.symbol) }))
    .sort((a,b) => b.marketCap - a.marketCap || a.symbol.localeCompare(b.symbol));
  return { stocks: ranked.slice(0,15), candidates: candidates.length, ranked: ranked.length, missingCaps: candidates.length - ranked.length,
    universe: definition.index ? `${definition.index} index constituents` : 'Nifty Total Market constituents',
    asOf: report.asOf, fetchedAt: new Date().toISOString(),
    sources: [{ title: 'NSE constituent list', url: universe.source }, { title: 'NSE market-cap report', url: report.source }] };
}

function nseDate(date) { return date.slice(8,10) + '-' + date.slice(5,7) + '-' + date.slice(0,4); }
export async function getStockHistory(symbol, days) {
  if (!/^[A-Z0-9][A-Z0-9&.-]{0,29}$/.test(symbol)) throw new MarketError('Invalid NSE symbol.', 400);
  if (![1,7,30,90,180,365].includes(days)) throw new MarketError('Choose a supported timeline.', 400);
  const end = todayIST(), from = offsetDate(end, days === 1 ? -14 : 1 - days);
  return cached(`history:${symbol}:${from}:${end}`, 15 * 60000, async () => {
    const ranges = [];
    for (let start = from; start <= end;) {
      const to = offsetDate(start,89) < end ? offsetDate(start,89) : end;
      ranges.push([start,to]); start = offsetDate(to,1);
    }
    const sourceUrls = [];
    // Requests use series=EQ. NSE's series=ALL response ignores requested dates.
    const chunks = await Promise.all(ranges.map(async ([start,to]) => {
      const params = new URLSearchParams({ from:nseDate(start), to:nseDate(to), symbol, type:'priceVolumeDeliverable', series:'EQ' });
      const url = 'https://www.nseindia.com/api/historicalOR/generateSecurityWiseHistoricalData?' + params;
      sourceUrls.push(url);
      const body = await download(url);
      let json; try { json = JSON.parse(body.toString('utf8')); } catch { throw new MarketError('NSE returned a non-data response. Please retry.'); }
      if (!Array.isArray(json.data)) throw new MarketError('NSE returned an unexpected historical-price format.');
      // A changed upstream endpoint must not silently substitute a different range.
      if (json.data.some(row => row.CH_SERIES === 'EQ' && (parseDate(row.mTIMESTAMP ?? row.CH_TIMESTAMP) < start || parseDate(row.mTIMESTAMP ?? row.CH_TIMESTAMP) > to)))
        throw new MarketError('NSE returned prices outside the requested date range.');
      return json.data;
    }));
    const result = sampleHistory(normaliseHistory(chunks.flat()), days, end);
    return { symbol, ...result, fetchedAt: new Date().toISOString(), sourceUrls };
  });
}
