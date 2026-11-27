/* ============================================================
   Оформление сайта: тема, снег и фоновая музыка
   ------------------------------------------------------------
   Всё живёт в одном файле и подключается на каждой странице:
   - панель «Вид» в правом нижнем углу;
   - тёмная / светлая тема (хранится в localStorage);
   - снег на canvas (по желанию);
   - спокойная фоновая музыка на Web Audio API — без mp3,
     поэтому ничего не скачивается и не тормозит загрузку.

   Музыка включается только по действию человека: браузеры
   запрещают автозапуск звука. Если человек уже включал музыку,
   она стартует при первом касании страницы.
   ============================================================ */
(() => {
  'use strict';

  const root = document.documentElement;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const KEYS = {
    theme: 'vibe-theme',
    snow: 'vibe-snow',
    sound: 'vibe-sound',
    volume: 'vibe-volume',
  };

  const store = {
    get(key, fallback) {
      try {
        const value = localStorage.getItem(key);
        return value === null ? fallback : value;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Приватный режим — настройки просто не запомнятся.
      }
    },
  };

  /* ==========================================================
     Тема
     ========================================================== */
  const Theme = (() => {
    const THEMES = ['dark', 'light', 'system'];
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const listeners = new Set();

    let choice = store.get(KEYS.theme, 'dark');
    if (!THEMES.includes(choice)) choice = 'dark';

    let applied = null;
    let switchTimer = 0;

    function resolve() {
      if (choice === 'system') return media.matches ? 'light' : 'dark';
      return choice;
    }

    function apply() {
      const value = resolve();
      const changed = applied !== null && applied !== value;
      applied = value;

      if (value === 'light') root.dataset.theme = 'light';
      else delete root.dataset.theme;

      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', value === 'light' ? '#f7f7fb' : '#08080c');

      // Красиво перекрашиваем страницу, а не щёлкаем цветами
      if (changed) {
        root.classList.add('theme-switch');
        window.clearTimeout(switchTimer);
        switchTimer = window.setTimeout(() => root.classList.remove('theme-switch'), 420);
      }

      listeners.forEach((fn) => fn(value, choice));
    }

    function set(next) {
      if (!THEMES.includes(next)) return;
      choice = next;
      store.set(KEYS.theme, next);
      apply();
    }

    if (media.addEventListener) {
      media.addEventListener('change', () => {
        if (choice === 'system') apply();
      });
    }

    apply();

    return {
      get: resolve,
      getChoice: () => choice,
      set,
      onChange: (fn) => listeners.add(fn),
    };
  })();

  /* ==========================================================
     Снег
     ----------------------------------------------------------
     Снежинки живут в координатах страницы: при прокрутке они
     уезжают вместе с содержимым, а не висят на экране. Позиции
     запоминаются в sessionStorage, поэтому при переходе между
     страницами снег продолжается с того же места.
     ========================================================== */
  const Snow = (() => {
    const SESSION_KEY = 'vibe-snow-state';
    const FADE_MS = 600;

    let canvas = null;
    let ctx = null;
    let flakes = [];
    let raf = 0;
    let last = 0;
    let running = false; // анимация идёт, в том числе затухание
    let enabled = false; // снег включён человеком
    let light = Theme.get() === 'light';
    let stopTimer = 0;

    const DARK_COLORS = ['rgba(255, 255, 255, ALPHA)', 'rgba(246, 250, 255, ALPHA)'];
    const LIGHT_COLORS = ['rgba(112, 120, 178, ALPHA)', 'rgba(86, 96, 158, ALPHA)'];

    const palette = () => (light ? LIGHT_COLORS : DARK_COLORS);
    const paint = (template, alpha) => template.replace('ALPHA', alpha.toFixed(2));
    const vw = () => (canvas && canvas.clientWidth) || window.innerWidth;
    const vh = () => (canvas && canvas.clientHeight) || window.innerHeight;

    function makeFlake(screenY) {
      const radius = 1.2 + Math.random() * 2.8;
      const alpha = light ? 0.35 + Math.random() * 0.35 : 0.5 + Math.random() * 0.5;
      const y = typeof screenY === 'number' ? screenY : Math.random() * vh();

      return {
        x: Math.random() * vw(),
        y: window.scrollY + y,
        r: radius,
        vy: (14 + Math.random() * 30 + radius * 5) * (reduceMotion.matches ? 0.6 : 1),
        amp: (6 + Math.random() * 20) * (reduceMotion.matches ? 0.35 : 1),
        phase: Math.random() * Math.PI * 2,
        speed: 0.25 + Math.random() * 0.6,
        twinklePhase: Math.random() * Math.PI * 2,
        alpha,
        color: paint(palette()[Math.random() < 0.7 ? 0 : 1], alpha),
      };
    }

    function targetCount() {
      const base = Math.min(340, Math.max(70, vw() / 5.5));
      return Math.round(base * (reduceMotion.matches ? 0.65 : 1));
    }

    function repaintColors() {
      const colors = palette();
      flakes.forEach((flake, index) => {
        flake.color = paint(colors[index % 5 === 0 ? 1 : 0], flake.alpha);
      });
    }

    // Продолжаем снег с того места, где он был на прошлой странице
    function restore() {
      try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return null;

        const data = JSON.parse(raw);
        if (!data || !Array.isArray(data.f) || Date.now() - data.at > 12000) return null;

        const w = vw();
        const h = vh();
        const colors = palette();

        return data.f.map((item, index) => {
          const [nx, ny, r, vy, amp, phase, speed, alpha] = item;
          return {
            x: nx * w,
            y: window.scrollY + ny * h,
            r,
            vy,
            amp,
            phase,
            speed,
            alpha,
            twinklePhase: Math.random() * Math.PI * 2,
            color: paint(colors[index % 5 === 0 ? 1 : 0], alpha),
          };
        });
      } catch {
        return null;
      }
    }

    function persist() {
      if (!enabled || !flakes.length) return;
      try {
        const w = vw() || 1;
        const h = vh() || 1;
        const scroll = window.scrollY;
        const data = flakes.map((flake) => [
          Number((flake.x / w).toFixed(4)),
          Number(((flake.y - scroll) / h).toFixed(4)),
          Number(flake.r.toFixed(1)),
          Number(flake.vy.toFixed(1)),
          Number(flake.amp.toFixed(1)),
          Number(flake.phase.toFixed(2)),
          Number(flake.speed.toFixed(2)),
          Number(flake.alpha.toFixed(2)),
        ]);
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ at: Date.now(), f: data }));
      } catch {
        // Приватный режим — просто начнём с новых снежинок.
      }
    }

    function resize() {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Размер берём у самого элемента: так пиксели канваса всегда
      // совпадают с CSS-размером и снежинки остаются круглыми.
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function frame(now) {
      if (!running) return;

      const dt = Math.min((now - last) / 1000 || 0.016, 0.06);
      last = now;

      const w = vw();
      const h = vh();
      const scroll = window.scrollY;
      const period = h + 60;

      // Чистим в реальных пикселях, чтобы на краях не оставалось полос
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      for (const flake of flakes) {
        flake.y += flake.vy * dt;
        flake.phase += flake.speed * dt;
        flake.x += Math.cos(flake.phase) * flake.amp * dt;

        if (flake.x < -12) flake.x = w + 12;
        else if (flake.x > w + 12) flake.x = -12;

        // Бесконечное поле: позиция сворачивается по кругу, поэтому
        // снежинки не сбиваются в полосы у края экрана
        let rel = flake.y - scroll;
        rel = ((((rel + 30) % period) + period) % period) - 30;
        flake.y = scroll + rel;

        const twinkle = 0.82 + 0.18 * Math.sin(flake.phase * 1.7 + flake.twinklePhase);

        ctx.globalAlpha = Math.min(1, flake.alpha * twinkle);
        ctx.fillStyle = flake.color;
        ctx.beginPath();
        ctx.arc(flake.x, rel, flake.r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      raf = window.requestAnimationFrame(frame);
    }

    function start() {
      if (enabled) return;
      if (stopTimer) {
        window.clearTimeout(stopTimer);
        stopTimer = 0;
      }

      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.className = 'snow-layer';
        canvas.setAttribute('aria-hidden', 'true');
        document.body.appendChild(canvas);
        ctx = canvas.getContext('2d');
        resize();
      }

      if (!running) {
        const count = targetCount();
        const saved = restore();
        flakes = saved && saved.length ? saved.slice(0, count) : [];
        while (flakes.length < count) flakes.push(makeFlake());

        running = true;
        last = performance.now();
        raf = window.requestAnimationFrame(frame);
      }

      enabled = true;
      canvas.classList.add('snow-layer--on');
    }

    // Плавно гасим и убираем, состояние при этом запоминается
    function stop() {
      if (!enabled) return;
      enabled = false;
      if (canvas) canvas.classList.remove('snow-layer--on');

      stopTimer = window.setTimeout(() => {
        stopTimer = 0;
        if (enabled) return;
        running = false;
        window.cancelAnimationFrame(raf);
        raf = 0;
        if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }, FADE_MS);
    }

    window.addEventListener('resize', () => {
      if (!running) return;
      resize();
    });

    document.addEventListener('visibilitychange', () => {
      if (!canvas) return;
      if (document.hidden) {
        persist();
        window.cancelAnimationFrame(raf);
      } else if (running) {
        last = performance.now();
        raf = window.requestAnimationFrame(frame);
      }
    });

    window.addEventListener('pagehide', persist);

    Theme.onChange((value) => {
      light = value === 'light';
      if (running) repaintColors();
    });

    return {
      isOn: () => enabled,
      set(on) {
        if (on) start();
        else stop();
        store.set(KEYS.snow, on ? '1' : '0');
      },
      // Тихо возвращает снег после смены темы без записи в localStorage
      refresh() {
        if (running) repaintColors();
      },
    };
  })();

  /* ==========================================================
     Фоновая музыка
     ----------------------------------------------------------
     Генеративный эмбиент: медленные аккорды, мягкий бас и редкие
     колокольчики. Ни одного аудиофайла — всё синтезируется.
     ========================================================== */
  const Music = (() => {
    const MUSIC_KEY = 'vibe-music-state';

    // Три характера фоновой музыки. Всё синтезируется на месте.
    const TRACKS = {
      calm: {
        label: 'Спокойный',
        chords: [
          { bass: 110.0, notes: [220.0, 261.63, 329.63, 493.88] }, // Am9
          { bass: 87.31, notes: [174.61, 220.0, 261.63, 329.63] }, // Fmaj7
          { bass: 65.41, notes: [130.81, 164.81, 196.0, 246.94] }, // Cmaj7
          { bass: 98.0, notes: [196.0, 246.94, 293.66, 329.63] }, // G6
          { bass: 73.42, notes: [146.83, 174.61, 220.0, 329.63] }, // Dm9
        ],
        chordEvery: 8,
        padLength: 12,
        padGain: 0.08,
        bassGain: 0.12,
        filterHz: 1400,
        bells: [880.0, 1046.5, 1318.5, 1568.0, 1975.5],
        bellEvery: [12, 22],
        bellDecay: 5,
        bellGain: 0.038,
        arpEvery: 1.8,
        arpGain: 0.03,
        arpDecay: 2.8,
      },
    };

    // Ноты арпеджио — ля-минорная пентатоника, ложится на все аккорды
    const ARP_NOTES = [440.0, 523.25, 659.25, 783.99, 880.0];

    let ctx = null;
    let master = null;
    let padBus = null;
    let wet = null;
    let probe = null;
    let timer = 0;
    let nextChordAt = 0;
    let nextBellAt = 0;
    let nextArpAt = 0;
    let arpIndex = 0;
    let startedAt = 0;
    let lastTickAt = 0;
    let chordIndex = 0;
    let on = false;
    let volume = Math.min(1, Math.max(0, Number(store.get(KEYS.volume, '45')) / 100));
    const listeners = new Set();

    const track = () => TRACKS.calm;

    const emit = () => listeners.forEach((fn) => fn(on, volume));

    function makeReverb(context) {
      const seconds = 3.4;
      const rate = context.sampleRate;
      const length = Math.floor(rate * seconds);
      const buffer = context.createBuffer(2, length, rate);

      for (let channel = 0; channel < 2; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < length; i += 1) {
          data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.6;
        }
      }

      const convolver = context.createConvolver();
      convolver.buffer = buffer;
      return convolver;
    }

    function init() {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) throw new Error('Web Audio не поддерживается');

      ctx = new AudioCtx();

      // Если браузер сам усыпил звук (свернули вкладку, сменилось
      // устройство вывода) — продолжаем, как только он разрешит.
      const context = ctx;
      context.onstatechange = () => {
        if (ctx !== context || !on) return;
        if (context.state === 'running') {
          fadeTo(volume, 0.8);
          ensureScheduling();
          disarmGesture();
        } else if (context.state === 'suspended') {
          armGesture();
        }
      };

      master = ctx.createGain();
      master.gain.value = 0.0001;

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 24;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.05;
      compressor.release.value = 0.3;

      const dry = ctx.createGain();
      dry.gain.value = 0.85;

      wet = ctx.createGain();
      wet.gain.value = 0.56;

      const reverb = makeReverb(ctx);

      padBus = ctx.createGain();
      padBus.gain.value = 0.9;

      // Очень медленное «дыхание» громкости — звук кажется живым
      const breathe = ctx.createOscillator();
      breathe.frequency.value = 0.045;
      const breatheDepth = ctx.createGain();
      breatheDepth.gain.value = 0.07;
      breathe.connect(breatheDepth).connect(padBus.gain);
      breathe.start();

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = track().filterHz;
      filter.Q.value = 0.6;

      // Медленное «дыхание» фильтра — звук не стоит на месте
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.06;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = track().filterHz * 0.28;
      lfo.connect(lfoDepth).connect(filter.frequency);
      lfo.start();

      padBus.connect(filter);
      filter.connect(dry);
      filter.connect(reverb);
      reverb.connect(wet);
      dry.connect(master);
      wet.connect(master);

      // Тихий анализатор — чтобы можно было проверить, что звук реально идёт
      probe = ctx.createAnalyser();
      probe.fftSize = 2048;

      master.connect(probe);
      probe.connect(compressor);
      compressor.connect(ctx.destination);
    }

    function playPad(chord, at) {
      const t = track();
      const voice = ctx.createGain();
      // Длинные атака и спад: аккорды перекрываются, поэтому между ними
      // нет провала в тишину.
      const attack = 3;
      const release = 4.5;

      voice.gain.setValueAtTime(0, at);
      voice.gain.linearRampToValueAtTime(t.padGain, at + attack);
      voice.gain.setValueAtTime(t.padGain, at + t.padLength - release);
      voice.gain.linearRampToValueAtTime(0, at + t.padLength);
      voice.connect(padBus);

      chord.notes.forEach((freq) => {
        [
          { type: 'sine', detune: -6, gain: 0.9 },
          { type: 'triangle', detune: 7, gain: 0.32 },
        ].forEach(({ type, detune, gain }) => {
          const osc = ctx.createOscillator();
          osc.type = type;
          osc.frequency.value = freq;
          osc.detune.value = detune;

          const level = ctx.createGain();
          level.gain.value = gain;

          osc.connect(level).connect(voice);
          osc.start(at);
          osc.stop(at + t.padLength + 0.1);
        });
      });

      const bass = ctx.createOscillator();
      bass.type = 'sine';
      bass.frequency.value = chord.bass;

      const bassLevel = ctx.createGain();
      bassLevel.gain.setValueAtTime(0, at);
      bassLevel.gain.linearRampToValueAtTime(t.bassGain, at + attack);
      bassLevel.gain.setValueAtTime(t.bassGain, at + t.padLength - release);
      bassLevel.gain.linearRampToValueAtTime(0, at + t.padLength);

      bass.connect(bassLevel).connect(padBus);
      bass.start(at);
      bass.stop(at + t.padLength + 0.1);
    }

    function playBell(freq, at) {
      const t = track();
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const level = ctx.createGain();
      level.gain.setValueAtTime(0, at);
      level.gain.linearRampToValueAtTime(t.bellGain, at + 0.02);
      level.gain.exponentialRampToValueAtTime(0.0005, at + t.bellDecay);

      let tail = level;
      if (typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = Math.random() * 1.4 - 0.7;
        level.connect(panner);
        tail = panner;
      }

      osc.connect(level);
      tail.connect(padBus);
      osc.start(at);
      osc.stop(at + t.bellDecay + 0.2);
    }

    // Мягкие «капли» арпеджио — добавляют движение и воздух
    function playArp(at) {
      const t = track();
      const freq = ARP_NOTES[arpIndex % ARP_NOTES.length];
      const pan = arpIndex % 2 === 0 ? -0.45 : 0.45;
      arpIndex += 1;

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const level = ctx.createGain();
      level.gain.setValueAtTime(0.0001, at);
      level.gain.linearRampToValueAtTime(t.arpGain, at + 0.03);
      level.gain.exponentialRampToValueAtTime(0.0004, at + t.arpDecay);

      let tail = level;
      if (typeof ctx.createStereoPanner === 'function') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = pan;
        level.connect(panner);
        tail = panner;
      }

      osc.connect(level);
      tail.connect(padBus);
      osc.start(at);
      osc.stop(at + t.arpDecay + 0.1);
    }

    function tick() {
      if (!on || !ctx || ctx.state !== 'running') return;

      const now = ctx.currentTime;
      const t = track();
      lastTickAt = now;

      // Если вкладка «спала», не догоняем упущенное пачкой аккордов.
      if (nextChordAt < now) nextChordAt = now + 0.05;
      if (nextBellAt < now) nextBellAt = now + 2;
      if (nextArpAt < now) nextArpAt = now + 0.4;

      // Держим впереди ~12 секунд музыки. Если браузер притормозил
      // таймеры (фоновая вкладка), звук всё равно не прервётся.
      while (nextChordAt < now + 12) {
        playPad(t.chords[chordIndex % t.chords.length], Math.max(nextChordAt, now + 0.05));
        chordIndex += 1;
        nextChordAt += t.chordEvery;
      }

      while (nextBellAt < now + 12) {
        playBell(t.bells[Math.floor(Math.random() * t.bells.length)], Math.max(nextBellAt, now + 0.05));
        nextBellAt += t.bellEvery[0] + Math.random() * (t.bellEvery[1] - t.bellEvery[0]);
      }

      while (nextArpAt < now + 12) {
        playArp(Math.max(nextArpAt, now + 0.05));
        nextArpAt += t.arpEvery;
      }
    }

    function schedule() {
      window.clearInterval(timer);
      timer = window.setInterval(tick, 700);
    }

    function stopScheduling() {
      window.clearInterval(timer);
      timer = 0;
    }

    function fadeTo(value, seconds) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
      master.gain.linearRampToValueAtTime(Math.max(value, 0.0001), now + seconds);
    }

    // Позиция в прогрессии хранится в sessionStorage: на новой странице
    // музыка продолжается с того же аккорда, а не начинается сначала.
    function saveState() {
      if (!on || !startedAt) return;
      try {
        sessionStorage.setItem(MUSIC_KEY, JSON.stringify({ at: Date.now(), startedAt }));
      } catch {
        // Приватный режим — просто начнём с первого аккорда.
      }
    }

    // Возвращает время старта прогрессии (ms) или null, если она устарела
    function readState() {
      try {
        const raw = sessionStorage.getItem(MUSIC_KEY);
        if (!raw) return null;

        const data = JSON.parse(raw);
        const saved = Number(data && data.startedAt);
        if (!Number.isFinite(saved) || saved <= 0) return null;
        if (Date.now() - saved > 30 * 60 * 1000) return null;

        return saved;
      } catch {
        return null;
      }
    }

    // Смена трека: мягко гасим текущий звук и запускаем новый
    let switchToken = 0;

    function enable() {
      if (on) return;
      if (!ctx) init();

      const saved = readState();
      const fresh = saved === null;
      const t = track();

      // Продолжаем прогрессию с той же точки, а не с первого аккорда
      startedAt = fresh ? Date.now() : saved;
      chordIndex = fresh
        ? 0
        : Math.floor((Date.now() - startedAt) / 1000 / t.chordEvery) % t.chords.length;

      on = true;
      store.set(KEYS.sound, '1');
      emit();

      if (ctx.state === 'running') {
        fadeTo(volume, fresh ? 1.6 : 0.7);
        ensureScheduling();
        return;
      }

      // Браузер ещё не разрешил звук. resume() без действия человека может
      // «зависнуть» навсегда, поэтому не ждём его, а сразу вешаем обработчик
      // первого клика — он и запустит музыку.
      armGesture();
      ctx.resume().catch(() => {});
    }

    // Планировщик запускаем только на «живом» контексте: иначе аккорды
    // копятся и после разблокировки звука играют все разом.
    function ensureScheduling() {
      if (!on || !ctx || ctx.state !== 'running') return;
      // Уже играем и запас есть — второй раз не планируем
      if (timer && nextChordAt > ctx.currentTime + 0.5) return;
      stopScheduling();
      nextChordAt = ctx.currentTime + 0.15;
      nextBellAt = ctx.currentTime + 2.2;
      nextArpAt = ctx.currentTime + 1.1;
      arpIndex = 0;
      tick();
      schedule();
    }

    // Браузер запрещает автозапуск: после загрузки страницы и после
    // перехода на другую страницу звук ждёт первого действия человека.
    // Любой клик или клавиша продолжает музыку с этого места.
    let kick = null;

    function armGesture() {
      if (kick) return;
      kick = () => {
        if (!on || !ctx) return;
        const start = () => {
          if (!on || !ctx || ctx.state !== 'running') return;
          fadeTo(volume, 0.9);
          ensureScheduling();
          disarmGesture();
        };
        if (ctx.state === 'suspended') ctx.resume().then(start).catch(() => {});
        else start();
      };
      ['pointerdown', 'keydown', 'touchstart'].forEach((name) => {
        document.addEventListener(name, kick, { passive: true });
      });
    }

    function disarmGesture() {
      if (!kick) return;
      ['pointerdown', 'keydown', 'touchstart'].forEach((name) => {
        document.removeEventListener(name, kick);
      });
      kick = null;
    }

    // Любое действие человека — повод проверить, не уснул ли звук:
    // в фоновой вкладке таймеры тормозят, и буфер успевает кончиться.
    const wake = () => {
      if (!on || !ctx || ctx.state !== 'running') return;
      if (ctx.currentTime - lastTickAt < 9) return;
      fadeTo(volume, 0.6);
      ensureScheduling();
    };
    ['pointerdown', 'keydown', 'touchstart'].forEach((name) => {
      document.addEventListener(name, wake, { passive: true });
    });

    function disable() {
      if (!on) return;
      on = false;
      switchToken += 1;
      store.set(KEYS.sound, '0');
      emit();

      disarmGesture();
      stopScheduling();

      const dying = ctx;
      if (!dying) return;

      try {
        fadeTo(0.0001, 0.6);
      } catch {
        // Контекст уже мог закрыться — это не страшно.
      }

      window.setTimeout(() => {
        dying.close().catch(() => {});
      }, 800);

      ctx = null;
      master = null;
      padBus = null;
      wet = null;
      probe = null;
    }

    function setVolume(next) {
      volume = Math.min(1, Math.max(0, next));
      store.set(KEYS.volume, String(Math.round(volume * 100)));
      if (on && ctx) fadeTo(volume, 0.25);
      emit();
    }

    // Возврат музыки после перезагрузки или перехода по сайту:
    // если браузер разрешит — заиграет сразу, иначе по первому клику.
    function autostart() {
      if (on || store.get(KEYS.sound, '0') !== '1') return;
      enable();
    }

    // Запоминаем аккорд, чтобы на следующей странице продолжить с него
    window.addEventListener('pagehide', saveState);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) saveState();
    });

    // Вкладку свернули и вернули — звук мог уснуть, будим аккуратно.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden || !on || !ctx) return;

      if (ctx.state === 'suspended') {
        ctx
          .resume()
          .then(() => {
            if (!on || !ctx || ctx.state !== 'running') return;
            fadeTo(volume, 0.8);
            ensureScheduling();
          })
          .catch(() => {});
      } else if (ctx.state === 'running' && ctx.currentTime - lastTickAt > 9) {
        fadeTo(volume, 0.8);
        ensureScheduling();
      }
    });

    return {
      isOn: () => on,
      getVolume: () => volume,
      contextState: () => (ctx ? ctx.state : 'closed'),
      level() {
        if (!probe || !ctx) return 0;
        const data = new Float32Array(probe.fftSize);
        probe.getFloatTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i += 1) {
          const value = Math.abs(data[i]);
          if (value > peak) peak = value;
        }
        return peak;
      },
      setEnabled(next) {
        if (next) enable();
        else disable();
      },
      setVolume,
      onChange: (fn) => listeners.add(fn),
      autostart,
    };
  })();

  /* ==========================================================
     Панель «Вид»
     ========================================================== */
  function buildPanel() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vibe-toggle';
    button.id = 'vibe-toggle';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'vibe-panel');
    button.setAttribute('aria-label', 'Оформление сайта: тема, снег и музыка');
    button.innerHTML =
      '<svg class="vibe-toggle__icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">' +
      '<path fill="currentColor" d="M12 2.2l1.8 5.3 5.3 1.8-5.3 1.8L12 16.4l-1.8-5.3L4.9 9.3l5.3-1.8z"/>' +
      '<path fill="currentColor" d="M18.8 14.6l.9 2.5 2.5.9-2.5.9-.9 2.5-.9-2.5-2.5-.9 2.5-.9z"/>' +
      '</svg><span class="vibe-toggle__label">Вид</span>';

    const panel = document.createElement('section');
    panel.className = 'vibe-panel';
    panel.id = 'vibe-panel';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Оформление сайта');
    panel.innerHTML =
      '<div class="vibe-panel__head">' +
      '<h2 class="vibe-panel__title">Оформление</h2>' +
      '<button class="vibe-panel__close" type="button" aria-label="Закрыть">✕</button>' +
      '</div>' +
      '<div class="vibe-panel__row">' +
      '<span class="vibe-panel__label" id="vibe-theme-label">Тема</span>' +
      '<div class="vibe-seg" role="group" aria-labelledby="vibe-theme-label">' +
      '<button class="vibe-seg__btn" type="button" data-theme-value="dark" aria-pressed="false">Тёмная</button>' +
      '<button class="vibe-seg__btn" type="button" data-theme-value="light" aria-pressed="false">Светлая</button>' +
      '</div>' +
      '</div>' +
      '<div class="vibe-panel__row">' +
      '<span class="vibe-panel__label">Снег</span>' +
      '<button class="vibe-switch" type="button" role="switch" aria-label="Снег" aria-checked="false" data-vibe="snow">' +
      '<span class="vibe-switch__knob"></span></button>' +
      '</div>' +
      '<div class="vibe-panel__row">' +
      '<span class="vibe-panel__label">Музыка</span>' +
      '<button class="vibe-switch" type="button" role="switch" aria-label="Фоновая музыка" aria-checked="false" data-vibe="sound">' +
      '<span class="vibe-switch__knob"></span></button>' +
      '</div>' +
      '<label class="vibe-panel__row vibe-panel__row--volume">' +
      '<span class="vibe-panel__label">Громкость</span>' +
      '<input class="vibe-range" type="range" min="0" max="100" step="1" value="45" data-vibe="volume">' +
      '</label>' +
      '<p class="vibe-panel__hint">Настройки хранятся в этом браузере. Музыка включается по нажатию — так требуют браузеры.</p>';

    document.body.append(button, panel);

    const segButtons = [...panel.querySelectorAll('[data-theme-value]')];
    const snowSwitch = panel.querySelector('[data-vibe="snow"]');
    const soundSwitch = panel.querySelector('[data-vibe="sound"]');
    const volumeRange = panel.querySelector('[data-vibe="volume"]');
    const closeBtn = panel.querySelector('.vibe-panel__close');

    function syncTheme() {
      const current = Theme.getChoice();
      segButtons.forEach((btn) => {
        const active = btn.dataset.themeValue === current;
        btn.setAttribute('aria-pressed', String(active));
        btn.classList.toggle('is-active', active);
      });
    }

    function syncSnow() {
      snowSwitch.setAttribute('aria-checked', String(Snow.isOn()));
    }

    function syncSound() {
      const playing = Music.isOn();
      soundSwitch.setAttribute('aria-checked', String(playing));
      panel.classList.toggle('vibe-panel--playing', playing);
    }

    segButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        Theme.set(btn.dataset.themeValue);
        syncTheme();
        Snow.refresh();
      });
    });

    snowSwitch.addEventListener('click', () => {
      Snow.set(!Snow.isOn());
      syncSnow();
    });

    soundSwitch.addEventListener('click', () => {
      Music.setEnabled(!Music.isOn());
      // setEnabled асинхронный (ждёт resume) — синхронизируемся по событию
      syncSound();
      window.setTimeout(syncSound, 120);
    });

    volumeRange.value = String(Math.round(Music.getVolume() * 100));
    volumeRange.addEventListener('input', () => {
      Music.setVolume(Number(volumeRange.value) / 100);
    });

    Music.onChange(() => {
      syncSound();
    });

    let isOpen = false;

    function open() {
      isOpen = true;
      panel.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      button.classList.remove('vibe-toggle--hint');
      // Пересчёт, чтобы анимация появления сработала сразу и надёжно
      void panel.offsetHeight;
      panel.classList.add('vibe-panel--open');
      syncTheme();
      syncSnow();
      syncSound();
    }

    function close(returnFocus) {
      if (!isOpen) return;
      isOpen = false;
      panel.classList.remove('vibe-panel--open');
      button.setAttribute('aria-expanded', 'false');
      window.setTimeout(() => {
        if (!isOpen) panel.hidden = true;
      }, 200);
      if (returnFocus) button.focus();
    }

    button.addEventListener('click', () => {
      if (isOpen) close(false);
      else open();
    });

    closeBtn.addEventListener('click', () => close(true));

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && isOpen) close(true);
    });

    document.addEventListener('click', (event) => {
      if (!isOpen) return;
      if (panel.contains(event.target) || button.contains(event.target)) return;
      close(false);
    });

    // Панель не должна уезжать под уведомление о cookies
    const cookieBar = document.getElementById('cookie');
    function liftAboveCookie() {
      const visible = cookieBar && !cookieBar.hidden;
      const lift = visible ? cookieBar.offsetHeight + 26 : 0;
      root.style.setProperty('--vibe-lift', `${lift}px`);
    }
    liftAboveCookie();
    if (cookieBar) {
      const observer = new MutationObserver(liftAboveCookie);
      observer.observe(cookieBar, { attributes: true, attributeFilter: ['hidden'] });
    }
    window.addEventListener('resize', liftAboveCookie);

    // Мягкая подсказка: через пару секунд кнопка начинает «дышать»
    const hint = window.setTimeout(() => {
      if (!isOpen) button.classList.add('vibe-toggle--hint');
    }, 2600);
    const stopHint = window.setTimeout(() => button.classList.remove('vibe-toggle--hint'), 22000);

    window.addEventListener('beforeunload', () => {
      window.clearTimeout(hint);
      window.clearTimeout(stopHint);
    });

    // Начальное состояние элементов
    syncTheme();
    syncSnow();
    syncSound();
  }

  function boot() {
    buildPanel();

    if (store.get(KEYS.snow, '0') === '1') Snow.set(true);
    Music.autostart();
  }

  // Небольшой публичный доступ: удобно проверять состояние из консоли
  window.PortfolioVibe = { theme: Theme, snow: Snow, music: Music };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
