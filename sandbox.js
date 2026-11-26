/* sandbox.js — интерактивы страницы «Песочница» */

/* ============================================================
   Демо 1: расчёт цены в реальном времени
   ============================================================ */
(function () {
  const BASE = { landing: 15000, corporate: 30000, shop: 60000 };
  const PER_PAGE = 3000;
  // Цены опций привязаны к id чекбоксов, а не к value:
  // у чекбокса без атрибута value value === "on".
  const OPTIONS = {
    'demo-opt-responsive': 5000,
    'demo-opt-animation': 4000,
    'demo-opt-crm': 8000,
    'demo-opt-seo': 6000,
    'demo-opt-copy': 5000,
  };

  const els = {
    type: document.getElementById('demo-type'),
    pages: document.getElementById('demo-pages'),
    pagesVal: document.getElementById('pages-val'),
    opts: document.querySelectorAll('#demo-opts-row input[type="checkbox"]'),
    speed: document.getElementById('demo-speed'),
    speedVal: document.getElementById('speed-val'),
    total: document.getElementById('demo-total'),
  };

  if (!els.type || !els.pages || !els.total) return;

  function compute() {
    let sum = BASE[els.type.value] || 0;
    sum += Number(els.pages.value || 0) * PER_PAGE;

    els.opts.forEach((input) => {
      if (input.checked) sum += OPTIONS[input.id] || 0;
    });

    if (els.speed.checked) {
      sum += Math.round(sum * 0.3);
      els.speedVal.textContent = 'срочные';
    } else {
      els.speedVal.textContent = 'обычные';
    }

    els.pagesVal.textContent = els.pages.value;
    els.total.textContent = sum.toLocaleString('ru-RU') + ' ₽';
  }

  els.pages.addEventListener('input', compute);
  els.type.addEventListener('change', compute);
  els.speed.addEventListener('change', compute);
  els.opts.forEach((input) => input.addEventListener('change', compute));

  compute();
})();

/* ============================================================
   Демо 2: превью кейса в реальном времени
   ============================================================ */
(function () {
  const frame = document.getElementById('demo-frame');
  const slider = document.getElementById('demo-width');
  const valEl = document.getElementById('frame-width-val');

  if (!frame || !slider || !valEl) return;

  function apply() {
    const width = Number(slider.value);
    frame.style.width = `${width}px`;
    valEl.textContent = String(width);
  }

  slider.addEventListener('input', apply);
  apply();
})();
