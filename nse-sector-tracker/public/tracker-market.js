(() => {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => value == null ? '—' : new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(value);
  const date = value => value ? new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z')) : '—';
  const cap = value => `₹${new Intl.NumberFormat('en-IN',{maximumFractionDigits:0}).format(value / 1e7)} cr`;
  const pct = value => value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
  const direction = value => value == null || value === 0 ? '' : value > 0 ? 'positive' : 'negative';
  let controller = null, generation = 0, active = null;

  async function request(params, signal) {
    if (location.protocol === 'file:') throw new Error('Open the website through the application server (npm run dev:next). A downloaded HTML file cannot run the stock-data service.');
    const response = await fetch('/api/stocks?' + new URLSearchParams(params), {
      signal: AbortSignal.any([signal, AbortSignal.timeout(65000)]), headers:{Accept:'application/json'},
    });
    if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('The stock-data service is not available on this server. Deploy the updated application, including its API route.');
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || 'NSE could not supply this data. Please retry.');
    return json;
  }
  function points(prices, width, height, padding = 6) {
    const values = prices.map(row=>row.close), min = Math.min(...values), max = Math.max(...values), spread = max - min || 1;
    if (prices.length === 1) return `${padding},${height/2} ${width-padding},${height/2}`;
    return values.map((value,i)=>`${(padding+i*(width-padding*2)/(values.length-1)).toFixed(2)},${(height-padding-(value-min)/spread*(height-padding*2)).toFixed(2)}`).join(' ');
  }
  function chart(history) {
    const prices = history.prices;
    return `<div class="price-chart"><div class="chart-heading"><span>Closing price · INR</span><strong>${money(history.latest.close)}</strong></div><svg viewBox="0 0 800 135" role="img" aria-label="Closing prices from ${escape(date(prices[0].date))} to ${escape(date(prices.at(-1).date))}"><path class="chart-grid" d="M6 20h788M6 65h788M6 110h788"/><polyline class="chart-line" points="${points(prices,800,130,12)}"/></svg><div class="chart-dates"><span>${date(prices[0].date)}</span><span>${date(prices.at(-1).date)}</span></div></div>`;
  }
  function historyCard(stock, history, rank) {
    const isFirst = rank === 0;
    if (!history.latest) return `<div class="stock-unavailable"><strong>${escape(stock.name)}</strong><p>No completed equity sessions were reported for this period. Try a longer timeline.</p><small>${escape(stock.symbol)} · Market cap ${cap(stock.marketCap)}</small></div>`;
    return `<details ${isFirst?'open':''}><summary><span class="rank">${String(rank+1).padStart(2,'0')}</span><span class="stock-symbol">${escape(stock.symbol.slice(0,2))}</span><span class="stock-name"><strong>${escape(stock.name)}</strong><small>${escape(stock.symbol)} · M-cap ${cap(stock.marketCap)}</small></span><svg class="spark ${direction(history.periodChange)}" viewBox="0 0 100 30" aria-hidden="true"><polyline points="${points(history.prices,100,30)}"/></svg><span class="stock-price"><strong>${money(history.latest.close)}</strong><small>Close · ${date(history.latest.date)}</small></span><span class="change ${direction(history.periodChange)}">${pct(history.periodChange)}<small>${active.days===1?'Daily change':'Period change'}</small></span><span class="chevron" aria-hidden="true">⌄</span></summary><div class="history-wrap">${chart(history)}<p class="history-note">${history.prices.length} of ${history.observations} trading sessions shown${history.interval>1?` · Every ${history.interval} trading sessions, counted back from the latest close`:''}. Daily change always uses the previous trading session.${active.days>1&&history.first?` Period change starts at ${money(history.first.close)} on ${date(history.first.date)}.`:''}</p><table><caption class="sr-only">${escape(stock.name)} closing prices and daily percentage changes</caption><thead><tr><th scope="col">Trading date</th><th scope="col">Close (₹)</th><th scope="col">Previous close (₹)</th><th scope="col">Daily change</th></tr></thead><tbody>${history.prices.map(row=>`<tr><th scope="row">${date(row.date)}</th><td>${money(row.close)}</td><td>${money(row.previousClose)}</td><td class="${direction(row.change)}">${pct(row.change)}</td></tr>`).join('')}</tbody></table><p class="history-note">As reported by NSE; prices are not adjusted for corporate actions. <a href="${escape(history.sourceUrls[0])}" target="_blank" rel="noopener">Official historical source ↗</a></p></div></details>`;
  }
  function updateProgress() {
    const node = document.getElementById('price-progress'); if (!node || !active) return;
    const finished = active.results.size + active.errors.size;
    node.textContent = finished < active.metadata.stocks.length
      ? `Loading official history · ${finished} of ${active.metadata.stocks.length} stocks`
      : `${active.results.size} stock histories loaded${active.errors.size?` · ${active.errors.size} unavailable — retry below`:''}`;
    const exportButton = document.getElementById('export-prices');
    if (exportButton) exportButton.disabled = ![...active.results.values()].some(item=>item.prices.length);
  }
  async function loadStock(stock, rank, run, signal) {
    const target = document.getElementById('price-'+stock.symbol);
    if (!target) return;
    active.errors.delete(stock.symbol);
    target.innerHTML = `<div class="stock-loading"><span class="stock-symbol">${escape(stock.symbol.slice(0,2))}</span><div><strong>${escape(stock.name)}</strong><p>Loading NSE closing prices…</p></div><span class="loading-dot" aria-hidden="true"></span></div>`;
    try {
      const history = await request({symbol:stock.symbol,days:active.days},signal);
      if (run !== generation) return;
      active.results.set(stock.symbol,history);
      target.innerHTML = historyCard(stock,history,rank);
    } catch (error) {
      if (run !== generation || signal.aborted) return;
      active.errors.add(stock.symbol);
      target.innerHTML = `<div class="stock-unavailable"><strong>${escape(stock.name)} <small>${escape(stock.symbol)}</small></strong><p>${escape(error.name==='TimeoutError'?'The NSE request timed out. Please retry.':error.message)}</p><button type="button" class="secondary" data-retry-stock="${escape(stock.symbol)}">Retry this stock ↻</button></div>`;
    }
    if (run === generation) updateProgress();
  }
  function cancel() { generation++; controller?.abort(); controller=null; active=null; }
  async function load(sector, days) {
    cancel(); const run = generation; controller = new AbortController(); const signal = controller.signal;
    const target = document.getElementById('stock-results');
    target.innerHTML = `<div class="status-box" role="status"><span class="eyebrow">DIRECT FROM THE EXCHANGE</span><h2>Finding the leaders in ${escape(sector.name)}…</h2><p>Reading the official constituent list and latest available market-cap report.</p><div class="loading-line" aria-hidden="true"></div></div>`;
    try {
      const metadata = await request({sector:sector.id},signal);
      if (run !== generation) return;
      active = {sector,days,metadata,results:new Map(),errors:new Set()};
      target.innerHTML = `<div class="summary-grid"><div class="summary"><small>COMPANIES TO EXPLORE</small><strong>${metadata.stocks.length} <span>/ ${metadata.ranked} ranked</span></strong></div><div class="summary"><small>MARKET-CAP REPORT</small><strong>${date(metadata.asOf)}</strong></div><div class="summary"><small>YOUR PERSPECTIVE</small><strong>${days===1?'Latest session':days+' days'} <span>· Max 30 prices</span></strong></div></div><div class="inline-notice"><strong>Ranked by total market capitalisation.</strong> Coverage: ${escape(metadata.universe)}.${sector.kind==='industry'?' This industry button uses the named Nifty index as its stock universe.':''}${metadata.missingCaps?` ${metadata.missingCaps} constituents have no market-cap value in this report and are excluded.`:''} ${metadata.stocks.length<15?'Fewer than 15 companies are available in this universe.':''}<br>Closing prices are end-of-day values. Weekends and market holidays have no new closing price.</div><div class="results-toolbar"><div><h2>${metadata.stocks.length?'Sector leaders':'No eligible companies'}</h2><p id="price-progress" class="data-label" role="status" aria-live="polite">Loading official price history…</p></div><div class="result-actions"><button class="secondary" type="button" data-action="refresh-prices">Refresh ↻</button><button class="primary" id="export-prices" type="button" data-action="export-prices" disabled>Download CSV ↓</button></div></div><div class="stock-list">${metadata.stocks.map(stock=>`<article class="stock" id="price-${escape(stock.symbol)}"></article>`).join('')}</div><div class="data-sources"><span>OFFICIAL SOURCES</span>${metadata.sources.map(source=>`<a href="${escape(source.url)}" target="_blank" rel="noopener">${escape(source.title)} ↗</a>`).join('')}<small>Retrieved ${new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Kolkata'}).format(new Date(metadata.fetchedAt))} IST</small></div>`;
      // Load gradually so the first stocks appear while the remaining histories arrive.
      let next = 0;
      const worker = async () => {
        while (next < metadata.stocks.length && run === generation) {
          const rank = next++; await loadStock(metadata.stocks[rank],rank,run,signal);
        }
      };
      await Promise.all(Array.from({length:Math.min(3,metadata.stocks.length)},worker));
      if (run === generation) updateProgress();
    } catch (error) {
      if (run !== generation || signal.aborted) return;
      target.innerHTML = `<div class="status-box error-box" role="alert"><h2>We couldn’t reach the official data source</h2><p>${escape(error.name==='TimeoutError'?'The NSE request timed out. Please retry.':error.message)}</p><p>No estimated or sample prices have been substituted.</p><div class="status-actions"><button class="primary" type="button" data-action="refresh-prices">Try again ↻</button><a class="secondary" href="https://www.nseindia.com/market-data/live-equity-market" target="_blank" rel="noopener">Open NSE India ↗</a></div></div>`;
    }
  }
  function retry(symbol) {
    if (!active || !controller || controller.signal.aborted) return;
    const rank = active.metadata.stocks.findIndex(stock=>stock.symbol===symbol);
    if (rank >= 0) void loadStock(active.metadata.stocks[rank],rank,generation,controller.signal);
  }
  function exportPrices() {
    if (!active) return;
    const rows = [['Company','Symbol','Market cap (INR)','Market cap date','Trading date','Close (INR)','Previous close (INR)','Daily change (%)','Period change (%)','Sampling interval (sessions)','Source']];
    for (const stock of active.metadata.stocks) {
      const history = active.results.get(stock.symbol); if (!history) continue;
      for (const row of history.prices) rows.push([stock.name,stock.symbol,stock.marketCap,active.metadata.asOf,row.date,row.close,row.previousClose,row.change?.toFixed(4),history.periodChange?.toFixed(4),history.interval,history.sourceUrls[0]]);
    }
    const text = '\uFEFF' + rows.map(row=>row.map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a');link.href=url;link.download=`sectorlens-${active.sector.id}-${active.days}days.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  window.SectorMarket = { load, cancel, retry, exportPrices };
})();
