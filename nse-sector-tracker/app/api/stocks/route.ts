import { getSectorStocks, getStockHistory, MarketError } from '../../../lib/nse-data.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const symbol = params.get('symbol');
    const result = symbol
      ? await getStockHistory(symbol, Number(params.get('days') ?? 30))
      : await getSectorStocks(params.get('sector') ?? '');
    return Response.json(result, { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } });
  } catch (error) {
    const known = error instanceof MarketError;
    return Response.json({ error: known ? error.message : 'The official price service is temporarily unavailable. Please retry.' },
      { status: known && error.status === 400 ? 400 : 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
