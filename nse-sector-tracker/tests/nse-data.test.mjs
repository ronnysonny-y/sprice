import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { parseCsv, parseDate, normaliseHistory, sampleHistory, offsetDate, todayIST, number, extractMcap, getStockHistory, getSectorStocks, sectorDefinitions } from '../lib/nse-data.mjs';

function zipCsv(csv) {
  const name=Buffer.from('mcap21102026.csv'), data=Buffer.from(csv), compressed=deflateRawSync(data);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(8,8);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(8,10);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(local.length+name.length+compressed.length,16);
  return Buffer.concat([local,name,compressed,central,name,end]);
}
test('CSV handles NSE headers, quoted numbers, commas and newlines',()=>{
  const rows=parseCsv('\uFEFFSymbol,Market Cap(Rs.),Company Name\r\nTCS,"1,234.50","Test, company\nLtd"\r\n');
  assert.equal(rows[0].symbol,'TCS');assert.equal(number(rows[0].marketcaprs),1234.5);assert.equal(rows[0].companyname,'Test, company\nLtd');
  assert.equal(number('—'),null);assert.equal(number(''),null);assert.throws(()=>parseCsv('Symbol,Close\nTCS,"123'));
});
test('NSE midnight timestamps are interpreted as Indian trading dates',()=>{
  assert.equal(parseDate('2026-10-20T18:30:00.000Z'),'2026-10-21');
  assert.equal(parseDate('21-Oct-2026'),'2026-10-21');assert.equal(parseDate('31-Feb-2026'),null);
  assert.equal(todayIST(new Date('2026-10-21T19:00:00Z')),'2026-10-22');
});
test('history filters non-EQ series, deduplicates and uses reported previous close',()=>{
  const row={CH_SERIES:'EQ',mTIMESTAMP:'21-Oct-2026',CH_TIMESTAMP:'2026-10-20T18:30:00.000Z',CH_CLOSING_PRICE:110,CH_PREVIOUS_CLS_PRICE:100};
  const prices=normaliseHistory([row,row,{...row,CH_SERIES:'BE',CH_CLOSING_PRICE:999},{...row,mTIMESTAMP:'19-Oct-2026',CH_CLOSING_PRICE:90,CH_PREVIOUS_CLS_PRICE:null}]);
  assert.equal(prices.length,2);assert.equal(prices[1].date,'2026-10-21');assert.ok(Math.abs(prices[1].change-10)<1e-8);assert.equal(prices[0].change,null);
});
test('all timelines stay at 30 prices, retain the latest and preserve daily changes',()=>{
  const end='2026-10-22',prices=Array.from({length:365},(_,i)=>({date:offsetDate(end,i-364),close:100+i,previousClose:99+i,change:100/(99+i)}));
  for(const days of [1,7,30,31,60,61,90,180,365]){
    const result=sampleHistory(prices,days,end);assert.ok(result.prices.length<=30);assert.equal(result.latest.date,end);assert.equal(result.prices.at(-1).date,end);assert.equal(result.interval,Math.ceil(days/30));
    assert.deepEqual(result.prices.at(-1),prices.at(-1));
    if(days>1)assert.equal(result.periodChange,(result.latest.close/result.first.close-1)*100);
  }
});
test('one-day view uses the latest completed session and weekend ranges can be empty',()=>{
  const prices=[{date:'2026-10-16',close:105,previousClose:100,change:5}];
  assert.equal(sampleHistory(prices,1,'2026-10-18').latest.date,'2026-10-16');assert.equal(sampleHistory(prices,1,'2026-10-18').periodChange,5);
  assert.equal(sampleHistory(prices,2,'2026-10-18').latest,null);
});
test('extracts only the market-cap CSV from the official archive structure',()=>{
  const csv='Symbol,Series,Market Cap(Rs.)\nTCS,EQ,12345\n';assert.equal(extractMcap(zipCsv(csv)),csv);assert.throws(()=>extractMcap(Buffer.from('not a zip')));
});
test('rejects unsupported sectors, timelines and unsafe symbols before requests',async()=>{
  assert.equal(Object.keys(sectorDefinitions).length,32);
  await assert.rejects(getSectorStocks('__proto__'),/valid sector/);await assert.rejects(getSectorStocks('unknown'),/valid sector/);
  await assert.rejects(getStockHistory('../TCS',30),/Invalid NSE symbol/);await assert.rejects(getStockHistory('TCS',999),/supported timeline/);
});
test('live-data pipeline ranks rupee market caps and requests EQ history in bounded date windows',async t=>{
  const m=await import('../lib/nse-data.mjs?integration-test');const end=todayIST();let historyRequests=0;
  t.mock.method(globalThis,'fetch',async url=>{
    url=String(url);
    if(url.includes('IndexConstituent/'))return new Response('Company Name,Industry,Symbol,Series\nCompany A,Information Technology,AAA,EQ\nCompany B,Information Technology,BBB,EQ\nCompany C,Power,CCC,EQ\n');
    if(url.endsWith('.zip'))return new Response(zipCsv('Symbol,Series,Market Cap(Rs.)\nAAA,EQ,100000000\nBBB,EQ,500000000\nCCC,EQ,999000000\n'));
    const p=new URL(url).searchParams;assert.equal(p.get('series'),'EQ');historyRequests++;
    const from=p.get('from').split('-').reverse().join('-'),to=p.get('to').split('-').reverse().join('-');
    assert.ok((Date.parse(to)-Date.parse(from))/86400000<=89);
    return Response.json({data:[{CH_SERIES:'EQ',mTIMESTAMP:to,CH_CLOSING_PRICE:110,CH_PREVIOUS_CLS_PRICE:100}]});
  });
  const ranked=await m.getSectorStocks('it');assert.equal(ranked.stocks.length,2);assert.equal(ranked.stocks[0].symbol,'BBB');assert.equal(ranked.stocks[0].marketCap,500000000);assert.equal(ranked.missingCaps,0);
  const history=await m.getStockHistory('AAA',365);assert.equal(historyRequests,5);assert.equal(history.latest.date,end);assert.equal(history.prices.length,1);assert.equal(history.observations,5);
  await m.getStockHistory('AAA',365);assert.equal(historyRequests,5,'successful data is cached');
});
