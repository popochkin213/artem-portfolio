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
    track: 'vibe-track',
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
    let prevScroll = 0;
    let stopTimer = 0;

    const DARK_COLORS = ['rgba(255, 255, 255, ALPHA)', 'rgba(246, 250, 255, ALPHA)'];
    const LIGHT_COLORS = ['rgba(112, 120, 178, ALPHA)', 'rgba(86, 96, 158, ALPHA)'];

    const palette = () => (light ? LIGHT_COLORS : DARK_COLORS);
    const paint = (template, alpha) => template.replace('ALPHA', alpha.toFixed(2));
    const vw = () => window.innerWidth;
    const vh = () => window.innerHeight;

    function makeFlake(screenY) {
      const radius = 1.5 + Math.random() * 3.6;
      const alpha = light ? 0.3 + Math.random() * 0.35 : 0.55 + Math.random() * 0.45;
      const y = typeof screenY === 'number' ? screenY : Math.random() * vh();

      return {
        x: Math.random() * vw(),
        y: window.scrollY + y,
        r: radius,
        vy: (16 + Math.random() * 32 + radius * 6) * (reduceMotion.matches ? 0.6 : 1),
        amp: (6 + Math.random() * 22) * (reduceMotion.matches ? 0.35 : 1),
        phase: Math.random() * Math.PI * 2,
        speed: 0.25 + Math.random() * 0.6,
        alpha,
        color: paint(palette()[Math.random() < 0.7 ? 0 : 1], alpha),
      };
    }

    function targetCount() {
      const base = Math.min(420, Math.max(80, vw() / 5));
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
      const w = vw();
      const h = vh();
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function frame(now) {
      if (!running) return;

      const dt = Math.min((now - last) / 1000 || 0.016, 0.06);
      last = now;

      const w = vw();
      const h = vh();
      const scroll = window.scrollY;
      const jump = Math.abs(scroll - prevScroll);
      prevScroll = scroll;

      ctx.clearRect(0, 0, w, h);

      for (const flake of flakes) {
        flake.y += flake.vy * dt;
        flake.phase += flake.speed * dt;
        flake.x += Math.cos(flake.phase) * flake.amp * dt;

        if (flake.x < -12) flake.x = w + 12;
        else if (flake.x > w + 12) flake.x = -12;

        const screenY = flake.y - scroll;

        // Уехала за нижний край — возвращаем сверху.
        if (screenY > h + 24) {
          flake.y = scroll - 10 - Math.random() * 40;
          flake.x = Math.random() * w;
        } else if (screenY < -24) {
          // Прокрутили мимо: при быстром рывке рассыпаем по экрану,
          // при плавном — возвращаем снизу, как новую порцию снега.
          const y = jump > h * 0.4 ? Math.random() * h : h + 10 + Math.random() * 40;
          flake.y = scroll + y;
          flake.x = Math.random() * w;
        }

        const drawY = flake.y - scroll;
        if (drawY < -30 || drawY > h + 30) continue;

        ctx.globalAlpha = flake.alpha;
        ctx.fillStyle = flake.color;
        ctx.beginPath();
        ctx.arc(flake.x, drawY, flake.r, 0, Math.PI * 2);
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

        prevScroll = window.scrollY;
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
        chordEvery: 7,
        padLength: 11,
        padGain: 0.085,
        bassGain: 0.13,
        punch: 0,
        filterHz: 1500,
        bells: [880.0, 1046.5, 1318.5, 1568.0, 1975.5],
        bellEvery: [9, 18],
        bellDecay: 4.5,
        bellGain: 0.05,
      },
      bass: {
        label: 'Басс',
        chords: [
          { bass: 73.42, notes: [146.83, 174.61, 220.0, 261.63] }, // Dm7
          { bass: 58.27, notes: [116.54, 146.83, 174.61, 220.0] }, // Bbmaj7
          { bass: 55.0, notes: [110.0, 138.59, 164.81, 196.0] }, // A7
          { bass: 49.0, notes: [98.0, 116.54, 146.83, 174.61] }, // Gm7
        ],
        chordEvery: 8,
        padLength: 12,
        padGain: 0.065,
        bassGain: 0.26,
        punch: 0.09,
        filterHz: 850,
        bells: [440.0, 523.25, 659.25],
        bellEvery: [16, 28],
        bellDecay: 3.4,
        bellGain: 0.032,
      },
      sad: {
        label: 'Грустный',
        chords: [
          { bass: 110.0, notes: [220.0, 261.63, 329.63, 392.0] }, // Am7
          { bass: 87.31, notes: [174.61, 220.0, 261.63, 329.63] }, // Fmaj7
          { bass: 73.42, notes: [146.83, 174.61, 220.0, 261.63] }, // Dm7
          { bass: 82.41, notes: [164.81, 207.65, 246.94, 293.66] }, // E7
        ],
        chordEvery: 9,
        padLength: 13,
        padGain: 0.075,
        bassGain: 0.08,
        punch: 0,
        filterHz: 1150,
        bells: [1046.5, 1174.66, 1318.51, 1567.98],
        bellEvery: [6, 12],
        bellDecay: 6,
        bellGain: 0.045,
      },
    };

    let ctx = null;
    let master = null;
    let padBus = null;
    let wet = null;
    let probe = null;
    let timer = 0;
    let nextChordAt = 0;
    let nextBellAt = 0;
    let lastTickAt = 0;
    let chordIndex = 0;
    let on = false;
    let trackId = store.get(KEYS.track, 'calm');
    if (!TRACKS[trackId]) trackId = 'calm';
    let volume = Math.min(1, Math.max(0, Number(store.get(KEYS.volume, '45')) / 100));
    const listeners = new Set();

    const track = () => TRACKS[trackId] || TRACKS.calm;

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
      wet.gain.value = 0.5;

      const reverb = makeReverb(ctx);

      padBus = ctx.createGain();
      padBus.gain.value = 0.9;

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

      // У «басового» трека — мягкий удар на смене аккорда
      if (t.punch > 0) {
        const punch = ctx.createOscillator();
        punch.type = 'sine';
        punch.frequency.value = chord.bass * 2;

        const punchLevel = ctx.createGain();
        punchLevel.gain.setValueAtTime(0.0001, at);
        punchLevel.gain.linearRampToValueAtTime(t.punch, at + 0.5);
        punchLevel.gain.linearRampToValueAtTime(0.0001, at + 2.4);

        punch.connect(punchLevel).connect(padBus);
        punch.start(at);
        punch.stop(at + 2.6);
      }
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

    function tick() {
      if (!on || !ctx || ctx.state !== 'running') return;

      const now = ctx.currentTime;
      const t = track();
      lastTickAt = now;

      // Если вкладка «спала», не догоняем упущенное пачкой аккордов.
      if (nextChordAt < now) nextChordAt = now + 0.05;
      if (nextBellAt < now) nextBellAt = now + 2;

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
      if (!on) return;
      try {
        sessionStorage.setItem(
          MUSIC_KEY,
          JSON.stringify({
            at: Date.now(),
            track: trackId,
            index: chordIndex % track().chords.length,
          }),
        );
      } catch {
        // Приватный режим — просто начнём с первого аккорда.
      }
    }

    function readState() {
      try {
        const raw = sessionStorage.getItem(MUSIC_KEY);
        if (!raw) return null;

        const data = JSON.parse(raw);
        if (!data || typeof data.index !== 'number') return null;
        if (Date.now() - data.at > 5 * 60 * 1000) return null;

        const len = track().chords.length;
        return ((data.index % len) + len) % len;
      } catch {
        return null;
      }
    }

    // Смена трека: мягко гасим текущий звук и запускаем новый
    let switchToken = 0;

    function setTrack(id) {
      if (!TRACKS[id] || id === trackId) return;

      trackId = id;
      store.set(KEYS.track, id);
      emit();

      if (!on) return;

      const token = (switchToken += 1);
      stopScheduling();

      try {
        fadeTo(0.0001, 0.45);
      } catch {
        // Контекст мог закрыться — не страшно.
      }

      window.setTimeout(() => {
        if (token !== switchToken || !on) return;

        const dying = ctx;
        ctx = null;
        master = null;
        padBus = null;
        wet = null;
        probe = null;
        if (dying) dying.close().catch(() => {});

        init();
        chordIndex = 0;

        if (ctx.state === 'running') {
          fadeTo(volume, 1.1);
          ensureScheduling();
        } else {
          armGesture();
        }
      }, 550);
    }

    async function enable() {
      if (on) return;
      if (!ctx) init();

      const saved = readState();

      on = true;
      chordIndex = saved === null ? 0 : saved;
      store.set(KEYS.sound, '1');
      emit();

      try {
        if (ctx.state === 'suspended') await ctx.resume();
      } catch {
        // Браузер подождёт действия человека — включим звук по клику.
      }

      if (ctx.state === 'running') {
        // Если музыка уже играла на прошлой странице — входим мягко и быстро
        fadeTo(volume, saved === null ? 1.6 : 0.7);
        ensureScheduling();
      } else {
        armGesture();
      }
    }

    // Планировщик запускаем только на «живом» контексте: иначе аккорды
    // копятся и после разблокировки звука играют все разом.
    function ensureScheduling() {
      if (!on || !ctx || ctx.state !== 'running') return;
      stopScheduling();
      nextChordAt = ctx.currentTime + 0.15;
      nextBellAt = ctx.currentTime + 2.2;
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
      enable().catch(() => {});
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
      getTrack: () => trackId,
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
        if (next) enable().catch(() => {});
        else disable();
      },
      setTrack,
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
      '<div class="vibe-panel__row">' +
      '<span class="vibe-panel__label">Трек</span>' +
      '<select class="vibe-select" data-vibe="track" aria-label="Музыкальный трек">' +
      '<option value="calm">Спокойный</option>' +
      '<option value="bass">Басс</option>' +
      '<option value="sad">Грустный</option>' +
      '</select>' +
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
    const trackSelect = panel.querySelector('[data-vibe="track"]');
    const trackRow = trackSelect.closest('.vibe-panel__row');
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

      // Без музыки выбор трека бессмысленен — блокируем его
      trackSelect.value = Music.getTrack();
      trackSelect.disabled = !playing;
      trackRow.classList.toggle('vibe-panel__row--disabled', !playing);
      trackRow.title = playing ? '' : 'Сначала включите музыку';
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

    trackSelect.addEventListener('change', () => {
      Music.setTrack(trackSelect.value);
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
