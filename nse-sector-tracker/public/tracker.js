(() => {
  'use strict';
  const page = document.getElementById('page');
  const initialMarkup = page.innerHTML;
  const sectors = Array.from(page.querySelectorAll('[data-sector]'), card => ({
    id: card.dataset.sector,
    name: card.querySelector('h3').textContent,
    kind: card.dataset.kind,
  }));
  const byId = new Map(sectors.map(sector => [sector.id, sector]));
  const dialog = document.getElementById('about-dialog');
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const periods = [
    ['1','1 day','Latest completed trading session'],
    ['7','1 week','A closer look at recent moves'],
    ['30','1 month','Every trading session'],
    ['90','3 months','A broader perspective'],
    ['180','6 months','See the medium-term trend'],
    ['365','1 year','A full year in perspective'],
  ];
  let filter = 'all';
  let currentSector = null;
  let currentStep = 1;
  let selectedPeriod = '30';

  function navigate(hash) {
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function progress(step) {
    currentStep = step;
    document.querySelectorAll('[data-step]').forEach(button => {
      const number = Number(button.dataset.step);
      button.classList.toggle('current', number === step);
      button.classList.toggle('done', number < step);
      button.disabled = number > step;
      if (number === step) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    document.getElementById('breadcrumb').textContent = ['Sector explorer','Select a timeline','Explore stocks'][step - 1];
  }

  function filterCards() {
    const query = document.getElementById('sector-search').value.trim().toLowerCase();
    let visible = 0;
    page.querySelectorAll('[data-sector]').forEach(card => {
      const sector = byId.get(card.dataset.sector);
      card.hidden = !(filter === 'all' || sector.kind === filter) || !card.textContent.toLowerCase().includes(query);
      if (!card.hidden) visible++;
    });
    document.getElementById('sector-count').textContent = `Showing ${visible} of ${filter === 'all' ? 32 : filter === 'sector' ? 22 : 10} ${filter === 'industry' ? 'industry groups' : filter === 'sector' ? 'sectors' : 'sectors & industry groups'}`;
    document.getElementById('sector-empty').hidden = visible > 0;
    page.querySelectorAll('[data-filter]').forEach(button => {
      const active = button.dataset.filter === filter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function render() {
    window.SectorMarket?.cancel();
    const route = location.hash.slice(1).split('/');
    const sector = byId.get(route[1]);
    if ((route[0] === 'timeline' || route[0] === 'stocks') && sector) {
      currentSector = sector;
      if (periods.some(period => period[0] === route[2])) selectedPeriod = route[2];
      if (route[0] === 'timeline') {
        progress(2);
        page.innerHTML = `<button type="button" class="back" data-action="sectors">← Back to sectors</button><div class="selected-chip">${escape(sector.name)}</div><div class="intro"><div><span class="eyebrow">PUT TIME ON YOUR SIDE</span><h1 id="page-title" tabindex="-1">Choose your <em>timeline.</em></h1><p>How far back would you like to look?<br>Select a period from 1 day to 1 year.</p></div></div><div class="timeline-grid" role="group" aria-label="Price timeline">${periods.map(([days,title,description])=>`<button type="button" class="timeline-card${days === selectedPeriod ? ' selected' : ''}" data-period="${days}" aria-pressed="${days === selectedPeriod}"><span class="radio" aria-hidden="true"></span><h3>${title}</h3><p>${description}</p></button>`).join('')}</div><div class="continue-row"><p>Up to 30 closing prices per stock.<br>Longer periods use evenly spaced trading sessions.</p><button type="button" class="primary" data-action="stocks">Explore stocks →</button></div>`;
      } else {
        progress(3);
        const period = periods.find(item => item[0] === selectedPeriod);
        page.innerHTML = `<button type="button" class="back" data-action="timeline">← Change timeline</button><span class="selected-chip">${escape(sector.name)} · ${period[1]}</span><div class="intro"><div><span class="eyebrow">YOUR MARKET PERSPECTIVE</span><h1 id="page-title" tabindex="-1">Explore <em>${escape(sector.name)}.</em></h1><p>The sector’s leaders. The story behind every close.</p></div></div><section id="stock-results" aria-label="Stock closing prices"></section>`;
        void window.SectorMarket.load(sector,Number(selectedPeriod));
      }
    } else {
      currentSector = null;
      filter = 'all';
      progress(1);
      page.innerHTML = initialMarkup;
    }
    document.getElementById('page-title')?.focus({preventScroll:true});
    window.scrollTo({top:0,behavior:'instant'});
  }

  page.addEventListener('click', event => {
    const button = event.target.closest('button, a[data-action]');
    if (!button) return;
    if (button.dataset.sector) navigate(`#timeline/${button.dataset.sector}/${selectedPeriod}`);
    else if (button.dataset.filter) { filter = button.dataset.filter; filterCards(); }
    else if (button.dataset.period) navigate(`#timeline/${currentSector.id}/${button.dataset.period}`);
    else if (button.dataset.action === 'sectors') navigate('#sectors');
    else if (button.dataset.action === 'timeline') navigate(`#timeline/${currentSector.id}/${selectedPeriod}`);
    else if (button.dataset.action === 'stocks') navigate(`#stocks/${currentSector.id}/${selectedPeriod}`);
    else if (button.dataset.action === 'refresh-prices') void window.SectorMarket.load(currentSector,Number(selectedPeriod));
    else if (button.dataset.action === 'export-prices') window.SectorMarket.exportPrices();
    else if (button.dataset.retryStock) window.SectorMarket.retry(button.dataset.retryStock);
    else if (button.dataset.action === 'about') { event.preventDefault(); dialog.showModal(); }
  });
  page.addEventListener('input', event => { if (event.target.id === 'sector-search') filterCards(); });
  page.addEventListener('change', event => {
    if (event.target.id !== 'sector-sort') return;
    const cards = [...page.querySelectorAll('[data-sector]')];
    const sort = event.target.value;
    cards.sort((a,b) => sort === 'default' ? sectors.findIndex(s=>s.id===a.dataset.sector) - sectors.findIndex(s=>s.id===b.dataset.sector) : (sort === 'za' ? -1 : 1) * byId.get(a.dataset.sector).name.localeCompare(byId.get(b.dataset.sector).name));
    document.getElementById('sector-grid').append(...cards);
  });
  document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => {
    const step = Number(button.dataset.step);
    if (step === 1) navigate('#sectors');
    else if (step <= currentStep && currentSector) navigate(`#${step === 2 ? 'timeline' : 'stocks'}/${currentSector.id}/${selectedPeriod}`);
  }));
  ['how-nav','help-button'].forEach(id=>document.getElementById(id).addEventListener('click',()=>dialog.showModal()));
  dialog.querySelector('.close-dialog').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click', event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  const navIcons = {
    grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    book:'<path d="M12 5C8 2 4 3 2 4v16c4-2 7-1 10 1 3-2 6-3 10-1V4c-4-2-7-1-10 1Zm0 0v16"/>',
    globe:'<circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/>',
  };
  document.querySelectorAll('[data-icon]').forEach(node=>{node.setAttribute('aria-hidden','true');node.innerHTML=`<svg viewBox="0 0 24 24">${navIcons[node.dataset.icon] || ''}</svg>`;});
  window.addEventListener('hashchange', render);
  if (location.hash && location.hash !== '#sectors') render();
  else progress(1);
})();
