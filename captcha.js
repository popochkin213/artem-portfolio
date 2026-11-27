/* ============================================================
   Двухэтапная капча
   ------------------------------------------------------------
   1. Сетка 4×4: нужно выбрать все квадраты с заданной фигурой.
      Фигуры и фон рисуются на canvas случайным образом.
   2. Искажённый текст: символы генерируются на месте.

   Публичный интерфейс:
     await PortfolioCaptcha.verify()  // true, если человек прошёл
   ============================================================ */
(() => {
  'use strict';

  const SHAPES = {
    star: 'звезда',
    circle: 'круг',
    triangle: 'треугольник',
    square: 'квадрат',
    heart: 'сердце',
  };

  const COLORS = ['#7c5cff', '#22d3ee', '#f472b6', '#fbbf24', '#34d399', '#c084fc'];
  const CHARS = '23456789ABEKMHPRSTXY';

  let modal = null;
  let resolveVerify = null;
  let stage = 1;

  // Данные первой ступени
  let gridCells = [];
  let gridTarget = 'star';
  let gridAnswer = new Set();
  let gridSelected = new Set();
  let attempts = 0;

  // Данные второй ступени
  let textCode = '';
  let textInput = null;
  let textCanvas = null;

  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  /* ==========================================================
     Рисование фигур
     ========================================================== */
  function shapePath(ctx, kind, size) {
    ctx.beginPath();

    if (kind === 'circle') {
      ctx.arc(0, 0, size * 0.42, 0, Math.PI * 2);
      return;
    }

    if (kind === 'square') {
      const s = size * 0.38;
      ctx.rect(-s, -s, s * 2, s * 2);
      return;
    }

    if (kind === 'triangle') {
      const s = size * 0.46;
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.92, s * 0.68);
      ctx.lineTo(-s * 0.92, s * 0.68);
      ctx.closePath();
      return;
    }

    if (kind === 'diamond') {
      const s = size * 0.44;
      ctx.moveTo(0, -s);
      ctx.lineTo(s * 0.8, 0);
      ctx.lineTo(0, s);
      ctx.lineTo(-s * 0.8, 0);
      ctx.closePath();
      return;
    }

    if (kind === 'heart') {
      const s = size * 0.36;
      ctx.moveTo(0, s * 0.9);
      ctx.bezierCurveTo(-s * 1.5, -s * 0.15, -s * 0.55, -s * 1.05, 0, -s * 0.42);
      ctx.bezierCurveTo(s * 0.55, -s * 1.05, s * 1.5, -s * 0.15, 0, s * 0.9);
      ctx.closePath();
      return;
    }

    // звезда
    const spikes = 5;
    const outer = size * 0.48;
    const inner = outer * 0.44;
    for (let i = 0; i < spikes * 2; i += 1) {
      const radius = i % 2 === 0 ? outer : inner;
      const angle = (Math.PI / spikes) * i - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function drawShape(ctx, kind, cx, cy, size, color, rotation) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);

    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    shapePath(ctx, kind, size);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.lineWidth = Math.max(1.5, size * 0.045);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.stroke();

    ctx.restore();
  }

  function drawTile(canvas, kind, seed) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = canvas.clientWidth || 72;

    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Фон: мягкий градиент + шумовые точки
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, seed % 2 ? '#161622' : '#191926');
    gradient.addColorStop(1, seed % 3 ? '#0f0f18' : '#141420');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    for (let i = 0; i < 12; i += 1) {
      ctx.fillStyle = `rgba(255, 255, 255, ${rand(0.03, 0.1).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(rand(2, size - 2), rand(2, size - 2), rand(0.6, 1.6), 0, Math.PI * 2);
      ctx.fill();
    }

    // Ровно одна фигура по центру — без двусмысленности
    drawShape(
      ctx,
      kind,
      size / 2,
      size / 2,
      size * rand(0.62, 0.72),
      pick(COLORS),
      kind === 'square' ? rand(-0.12, 0.12) : rand(-0.35, 0.35),
    );
  }

  function drawLegend(kind) {
    const canvas = modal.querySelector('.captcha__legend');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 46;

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    drawShape(ctx, kind, size / 2, size / 2, size * 0.82, '#a78bfa', 0);
  }

  /* ==========================================================
     Вёрстка модального окна
     ========================================================== */
  function buildModal() {
    modal = document.createElement('div');
    modal.className = 'captcha';
    modal.hidden = true;
    modal.innerHTML =
      '<div class="captcha__backdrop" data-captcha-close></div>' +
      '<div class="captcha__card" role="dialog" aria-modal="true" aria-labelledby="captcha-title">' +
      '<button class="captcha__close" type="button" aria-label="Закрыть капчу">✕</button>' +

      '<div class="captcha__step captcha__step--grid">' +
      '<p class="captcha__stage">Шаг 1 из 2</p>' +
      '<h2 class="captcha__title" id="captcha-title">Найдите все клетки с этой фигурой</h2>' +
      '<div class="captcha__task">' +
      '<canvas class="captcha__legend" width="46" height="46" aria-hidden="true"></canvas>' +
      '<span class="captcha__task-name"></span>' +
      '</div>' +
      '<p class="captcha__hint">Отметьте <strong>все</strong> подходящие клетки и нажмите «Подтвердить».</p>' +
      '<div class="captcha__grid"></div>' +
      '<p class="captcha__counter" aria-live="polite">Клетки не выбраны</p>' +
      '<div class="captcha__actions">' +
      '<button class="captcha__ghost" type="button" data-captcha-refresh>Другая сетка</button>' +
      '<button class="captcha__submit" type="button" data-captcha-check disabled>Подтвердить</button>' +
      '</div>' +
      '<p class="captcha__error" role="alert"></p>' +
      '</div>' +

      '<div class="captcha__step captcha__step--text" hidden>' +
      '<p class="captcha__stage">Шаг 2 из 2</p>' +
      '<h2 class="captcha__title">Введите символы с картинки</h2>' +
      '<p class="captcha__hint">Регистр не важен. Если плохо видно — обновите картинку.</p>' +
      '<canvas class="captcha__image" width="300" height="96"></canvas>' +
      '<div class="captcha__row">' +
      '<input class="captcha__input" type="text" autocomplete="off" spellcheck="false" ' +
      'inputmode="latin" maxlength="8" placeholder="Символы" aria-label="Символы с картинки">' +
      '<button class="captcha__ghost captcha__ghost--icon" type="button" data-captcha-refresh-text ' +
      'aria-label="Обновить картинку">↻</button>' +
      '</div>' +
      '<div class="captcha__actions">' +
      '<button class="captcha__submit" type="button" data-captcha-check-text>Подтвердить</button>' +
      '</div>' +
      '<p class="captcha__error" role="alert"></p>' +
      '</div>' +

      '</div>';

    document.body.append(modal);

    modal.querySelector('.captcha__close').addEventListener('click', () => finish(false));
    modal.querySelector('[data-captcha-close]').addEventListener('click', () => finish(false));
    modal.querySelector('[data-captcha-refresh]').addEventListener('click', () => buildGrid());
    modal.querySelector('[data-captcha-check]').addEventListener('click', checkGrid);
    modal.querySelector('[data-captcha-refresh-text]').addEventListener('click', () => buildText());
    modal.querySelector('[data-captcha-check-text]').addEventListener('click', checkText);

    textInput = modal.querySelector('.captcha__input');
    textCanvas = modal.querySelector('.captcha__image');

    textInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        checkText();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal && !modal.hidden) finish(false);
    });
  }

  /* ==========================================================
     Первая ступень — сетка
     ========================================================== */
  function buildGrid() {
    const grid = modal.querySelector('.captcha__grid');
    const error = modal.querySelector('.captcha__step--grid .captcha__error');
    const submit = modal.querySelector('[data-captcha-check]');
    const counter = modal.querySelector('.captcha__counter');
    const taskName = modal.querySelector('.captcha__task-name');

    gridTarget = pick(Object.keys(SHAPES));
    gridAnswer = new Set();
    gridSelected = new Set();
    gridCells = [];
    error.textContent = '';
    submit.disabled = true;
    counter.textContent = 'Клетки не выбраны';

    taskName.textContent = SHAPES[gridTarget];
    drawLegend(gridTarget);
    grid.innerHTML = '';

    const total = 16;
    const targets = new Set();
    const targetCount = 4 + Math.floor(Math.random() * 2); // 4–5
    while (targets.size < targetCount) targets.add(Math.floor(Math.random() * total));

    for (let i = 0; i < total; i += 1) {
      const isTarget = targets.has(i);
      if (isTarget) gridAnswer.add(i);

      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'captcha__tile';
      tile.setAttribute('aria-pressed', 'false');
      tile.dataset.index = String(i);

      const canvas = document.createElement('canvas');
      tile.append(canvas);
      grid.append(tile);

      const kind = isTarget ? gridTarget : pick(Object.keys(SHAPES).filter((name) => name !== gridTarget));
      const seed = Math.floor(Math.random() * 1000);

      // Размер канваса станет известен после вставки в DOM
      window.requestAnimationFrame(() => drawTile(canvas, kind, seed));

      gridCells.push({ kind, isTarget });

      tile.addEventListener('click', () => {
        if (gridSelected.has(i)) {
          gridSelected.delete(i);
          tile.classList.remove('is-picked');
          tile.setAttribute('aria-pressed', 'false');
        } else {
          gridSelected.add(i);
          tile.classList.add('is-picked');
          tile.setAttribute('aria-pressed', 'true');
        }
        submit.disabled = gridSelected.size === 0;
        counter.textContent =
          gridSelected.size === 0
            ? 'Клетки не выбраны'
            : `Отмечено клеток: ${gridSelected.size}`;
        error.textContent = '';
      });
    }
  }

  function checkGrid() {
    const error = modal.querySelector('.captcha__step--grid .captcha__error');
    const grid = modal.querySelector('.captcha__grid');

    if (gridSelected.size === 0) {
      error.textContent = 'Отметьте хотя бы одну клетку';
      return;
    }

    const correct =
      gridSelected.size === gridAnswer.size &&
      [...gridSelected].every((index) => gridAnswer.has(index));

    if (correct) {
      attempts = 0;
      showTextStage();
      return;
    }

    attempts += 1;
    error.textContent =
      attempts >= 3
        ? 'Всё ещё не то. Сверьтесь с образцом и попробуйте снова.'
        : 'Выбраны не все клетки или есть лишние. Проверьте выделение.';

    grid.classList.add('captcha__grid--wrong');
    window.setTimeout(() => grid.classList.remove('captcha__grid--wrong'), 420);
  }

  /* ==========================================================
     Вторая ступень — текст
     ========================================================== */
  function drawTextCaptcha() {
    const ctx = textCanvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = 300;
    const height = 96;

    textCanvas.width = width * dpr;
    textCanvas.height = height * dpr;
    textCanvas.style.width = `${width}px`;
    textCanvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Фон «бумага в клетку», как на образце
    ctx.fillStyle = '#f4f3ee';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(28, 34, 48, 0.12)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 18) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += 18) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Мелкие точки
    for (let i = 0; i < 90; i += 1) {
      ctx.fillStyle = `rgba(28, 34, 48, ${rand(0.08, 0.3).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(rand(0, width), rand(0, height), rand(0.4, 1.1), 0, Math.PI * 2);
      ctx.fill();
    }

    // Кривые линии-помехи
    for (let i = 0; i < 3; i += 1) {
      ctx.strokeStyle = `rgba(28, 34, 48, ${rand(0.18, 0.4).toFixed(2)})`;
      ctx.lineWidth = rand(1, 2);
      ctx.beginPath();
      const y0 = rand(10, height - 10);
      ctx.moveTo(-10, y0);
      ctx.bezierCurveTo(
        rand(60, 120), rand(-20, height + 20),
        rand(180, 240), rand(-20, height + 20),
        width + 10, rand(10, height - 10),
      );
      ctx.stroke();
    }

    // Символы
    textCode = '';
    const length = 5;
    const step = (width - 48) / length;
    const palette = ['#d92b2b', '#1d3fb5', '#1f1f28', '#e2711d', '#2c7a3f', '#7a2fbf'];

    for (let i = 0; i < length; i += 1) {
      const char = pick(CHARS.split(''));
      textCode += char;

      ctx.save();
      ctx.translate(24 + step * (i + 0.5), height / 2 + rand(-8, 8));
      ctx.rotate(rand(-0.34, 0.34));
      ctx.font = `800 ${Math.round(rand(36, 46))}px "Segoe UI", Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.strokeText(char, 0, 0);
      ctx.fillStyle = pick(palette);
      ctx.fillText(char, 0, 0);
      ctx.restore();
    }
  }

  function buildText() {
    const error = modal.querySelector('.captcha__step--text .captcha__error');
    error.textContent = '';
    textInput.value = '';
    drawTextCaptcha();
    window.requestAnimationFrame(() => textInput.focus({ preventScroll: true }));
  }

  function checkText() {
    const error = modal.querySelector('.captcha__step--text .captcha__error');
    const value = textInput.value.trim().toUpperCase();

    if (!value) {
      error.textContent = 'Введите символы с картинки';
      textInput.focus({ preventScroll: true });
      return;
    }

    if (value === textCode) {
      finish(true);
      return;
    }

    error.textContent = 'Не совпало. Попробуйте новый код.';
    window.setTimeout(buildText, 350);
  }

  /* ==========================================================
     Переключение ступеней и завершение
     ========================================================== */
  function showStage(next) {
    stage = next;
    modal.querySelector('.captcha__step--grid').hidden = next !== 1;
    modal.querySelector('.captcha__step--text').hidden = next !== 2;
  }

  function showTextStage() {
    showStage(2);
    buildText();
  }

  function finish(ok) {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.documentElement.classList.remove('captcha-open');

    const done = resolveVerify;
    resolveVerify = null;
    if (done) done(ok);
  }

  /* ==========================================================
     Публичный интерфейс
     ========================================================== */
  function verify() {
    if (!modal) buildModal();

    return new Promise((resolve) => {
      resolveVerify = resolve;
      modal.hidden = false;
      document.documentElement.classList.add('captcha-open');
      attempts = 0;
      showStage(1);
      buildGrid();
      // Перерисовываем после показа, чтобы размеры клеток были известны
      window.requestAnimationFrame(() => {
        const canvases = modal.querySelectorAll('.captcha__tile canvas');
        canvases.forEach((canvas, index) => {
          const cell = gridCells[index];
          if (cell) drawTile(canvas, cell.kind, Math.floor(Math.random() * 1000));
        });
      });
    });
  }

  window.PortfolioCaptcha = {
    verify,
    get passed() {
      return false;
    },
  };
})();
