// Brainrot Grader — Mini App. Без сборки и библиотек: один файл, работает в Telegram.
(() => {
  'use strict';

  const TG = window.Telegram && window.Telegram.WebApp;
  const DEV_ID = new URLSearchParams(location.search).get('dev'); // только для локальной разработки
  const view = document.getElementById('view');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = { me: null, cfg: null, cases: null, timers: [], render: 0, busy: false };

  // ---------- Мелкие помощники ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const h = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 });
  const COIN = '<img class="coin" src="/img/coin.webp" alt="BG">';
  const price = (n) => `<span class="price">${COIN}${fmt(n)}</span>`;
  const itemImg = (src) => esc(src || '/img/unknown.svg');
  // «OG» нарисовано по пикселям: в пиксельном шрифте O похожа на ноль, а G на шестёрку
  const OG_PATH = 'M1 0h4v1h-4zM8 0h4v1h-4zM0 1h2v1h-2zM4 1h2v1h-2zM7 1h2v1h-2zM11 1h2v1h-2zM0 2h2v1h-2zM4 2h2v1h-2zM7 2h2v1h-2zM0 3h2v1h-2zM4 3h2v1h-2zM7 3h2v1h-2zM10 3h3v1h-3zM0 4h2v1h-2zM4 4h2v1h-2zM7 4h2v1h-2zM11 4h2v1h-2zM0 5h2v1h-2zM4 5h2v1h-2zM7 5h2v1h-2zM11 5h2v1h-2zM1 6h4v1h-4zM8 6h4v1h-4z';
  const ogSvg = (fill = 'currentColor') => `<svg viewBox="0 0 13 7" shape-rendering="crispEdges" aria-hidden="true"><path d="${OG_PATH}" fill="${fill}"/></svg>`;
  const ogTag = (it) => (it?.rarity === 'og' ? `<i class="og-tag" title="OG">${ogSvg()}</i>` : '');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const newKey = () =>
    (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9-]/g, '').slice(0, 60);
  const haptic = (t) => { try { TG?.HapticFeedback?.notificationOccurred(t); } catch {} };
  const tick = () => { try { TG?.HapticFeedback?.selectionChanged(); } catch {} };
  const mmss = (sec) => {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  const plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    return a > 10 && a < 20 ? many : b > 1 && b < 5 ? few : b === 1 ? one : many;
  };
  // Своё окно подтверждения (вместо системного Telegram): одно за раз, повторные нажатия не плодят окна
  let confirmOpen = null;
  const confirmBox = (text, { ok = 'Подтвердить', cancel = 'Отмена' } = {}) => {
    if (confirmOpen) return confirmOpen;
    confirmOpen = new Promise((res) => {
      const el = h(`<div class="confirm-ov" role="dialog" aria-modal="true">
          <div class="confirm-card"><p></p>
            <div class="btn-row"><button class="btn ghost" data-c="no"></button><button class="btn" data-c="yes"></button></div>
          </div></div>`);
      $('p', el).textContent = text;
      $('[data-c=no]', el).textContent = cancel;
      $('[data-c=yes]', el).textContent = ok;
      const done = (v) => {
        removeEventListener('keydown', onKey);
        el.classList.remove('show');
        setTimeout(() => el.remove(), 180);
        confirmOpen = null;
        res(v);
      };
      const onKey = (e) => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); };
      el.addEventListener('click', (e) => { if (e.target === el) done(false); });
      $('[data-c=no]', el).onclick = () => done(false);
      $('[data-c=yes]', el).onclick = () => { tick(); done(true); };
      addEventListener('keydown', onKey);
      document.body.append(el);
      requestAnimationFrame(() => el.classList.add('show'));
      $('[data-c=yes]', el).focus({ preventScroll: true });
    });
    return confirmOpen;
  };
  const every = (ms, fn) => state.timers.push(setInterval(fn, ms));
  const stopTimers = () => { state.timers.forEach(clearInterval); state.timers = []; };
  const newRender = () => ++state.render;

  // ---------- Настройки игрока на этом устройстве: кейсы за раз, быстрый прокрут, звук, режим стримера ----------
  const SM_IDS = ['balance', 'pay', 'prices', 'spin', 'images', 'words'];
  const prefs = (() => {
    let p = {};
    try { p = JSON.parse(localStorage.getItem('bg_prefs') || '{}') || {}; } catch {}
    const v = Number(p.volume);
    const sm = p.sm && typeof p.sm === 'object' ? p.sm : {};
    return {
      count: [1, 3, 5].includes(p.count) ? p.count : 1,
      fast: !!p.fast,
      sound: p.sound !== false,
      volume: Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 60,
      sm: {
        on: !!sm.on,
        hide: Object.fromEntries(SM_IDS.map((k) => [k, sm.hide?.[k] !== false])),
        blur: [1, 2, 3].includes(sm.blur) ? sm.blur : 2,
        hover: sm.hover !== false,
      },
    };
  })();
  const savePrefs = () => { try { localStorage.setItem('bg_prefs', JSON.stringify(prefs)); } catch {} };

  // ---------- Звуки: синтезируем на лету, без файлов. Мягкие щелчки ленты и короткие аккорды ----------
  const sfx = (() => {
    let ctx = null;
    let master = null;
    let lastTick = 0;
    let out = null;
    // Громкость стоит после компрессора, иначе он «съедает» разницу. 60% = как было, 100% ≈ +5 дБ
    const volGain = () => 1.8 * Math.pow(prefs.volume / 100, 1.15);
    const ensure = () => {
      if (!prefs.sound || prefs.volume <= 0) return null;
      try {
        if (!ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          ctx = new AC();
          master = ctx.createGain();
          master.gain.value = 0.55;
          const comp = ctx.createDynamicsCompressor();
          out = ctx.createGain();
          out.gain.value = volGain();
          // Ограничитель в конце: на максимальной громкости звук не хрипит
          const lim = ctx.createDynamicsCompressor();
          lim.threshold.value = -2;
          lim.knee.value = 0;
          lim.ratio.value = 20;
          lim.attack.value = 0.002;
          lim.release.value = 0.08;
          master.connect(comp).connect(out).connect(lim).connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
      } catch { return null; }
    };
    // Нота: синус + немного октавы выше, быстрая атака и плавное затухание
    const note = (freq, at, dur, vol = 0.18, type = 'sine') => {
      const o = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      const g = ctx.createGain();
      const g2 = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      o2.type = 'sine';
      o2.frequency.value = freq * 2;
      g2.gain.value = 0.18;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g);
      o2.connect(g2).connect(g);
      g.connect(master);
      o.start(at); o2.start(at);
      o.stop(at + dur + 0.05); o2.stop(at + dur + 0.05);
    };
    let noise = null;
    let lastClack = 0;
    let lastClick = 0;
    return {
      unlock: () => ensure(),
      // Нажатие любой кнопки: мягкий короткий «тук» с лёгким звоном. pitch > 1 — выше (включение), < 1 — ниже
      click(pitch = 1) {
        const now = performance.now();
        if (now - lastClick < 45 || !ensure()) return;
        lastClick = now;
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(1180 * pitch, t);
        o.frequency.exponentialRampToValueAtTime(760 * pitch, t + 0.06);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.11, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(g).connect(master);
        o.start(t);
        o.stop(t + 0.11);
        const o2 = ctx.createOscillator();
        const g2 = ctx.createGain();
        o2.type = 'triangle';
        o2.frequency.value = 2900 * pitch;
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.exponentialRampToValueAtTime(0.022, t + 0.002);
        g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
        o2.connect(g2).connect(master);
        o2.start(t);
        o2.stop(t + 0.04);
      },
      setVolume() {
        if (out && ctx) out.gain.setTargetAtTime(volGain(), ctx.currentTime, 0.02);
      },
      // Кейсы: щелчок «язычка» колеса фортуны — короткий пластиковый клац и мягкий деревянный стук
      clack() {
        const now = performance.now();
        if (now - lastClack < 32 || !ensure()) return;
        lastClack = now;
        const t = ctx.currentTime;
        if (!noise) {
          noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.03), ctx.sampleRate);
          const d = noise.getChannelData(0);
          for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
        }
        const src = ctx.createBufferSource();
        src.buffer = noise;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2600 + Math.random() * 600;
        bp.Q.value = 3.5;
        const g = ctx.createGain();
        g.gain.value = 0.32;
        src.connect(bp).connect(g).connect(master);
        src.start(t);
        const o = ctx.createOscillator();
        const og = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(430, t);
        o.frequency.exponentialRampToValueAtTime(240, t + 0.04);
        og.gain.setValueAtTime(0.0001, t);
        og.gain.exponentialRampToValueAtTime(0.11, t + 0.002);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        o.connect(og).connect(master);
        o.start(t);
        o.stop(t + 0.07);
      },
      // Щелчок ленты/стрелки: короткий «ток» с лёгким разбросом высоты
      tick(strength = 1) {
        const now = performance.now();
        if (now - lastTick < 28 || !ensure()) return;
        lastTick = now;
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const f = ctx.createBiquadFilter();
        o.type = 'triangle';
        o.frequency.setValueAtTime(1500 * (0.96 + Math.random() * 0.08), t);
        o.frequency.exponentialRampToValueAtTime(700, t + 0.035);
        f.type = 'lowpass';
        f.frequency.value = 3200;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.09 * strength, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
        o.connect(f).connect(g).connect(master);
        o.start(t);
        o.stop(t + 0.06);
      },
      // Мистери: «зарядка» — нарастающий гул с мерцанием
      charge(sec = 1) {
        if (!ensure()) return;
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        const lfo = ctx.createOscillator();
        const lg = ctx.createGain();
        const f = ctx.createBiquadFilter();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(110, t);
        o.frequency.exponentialRampToValueAtTime(440, t + sec);
        f.type = 'lowpass';
        f.Q.value = 6;
        f.frequency.setValueAtTime(300, t);
        f.frequency.exponentialRampToValueAtTime(2400, t + sec);
        lfo.frequency.setValueAtTime(6, t);
        lfo.frequency.linearRampToValueAtTime(18, t + sec);
        lg.gain.value = 0.035;
        lfo.connect(lg).connect(g.gain);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.07, t + sec * 0.8);
        g.gain.exponentialRampToValueAtTime(0.0001, t + sec + 0.12);
        o.connect(f).connect(g).connect(master);
        o.start(t); lfo.start(t);
        o.stop(t + sec + 0.15); lfo.stop(t + sec + 0.15);
      },
      // Мистери: звон колокольчика при смене картинки, всё выше к концу
      chime(p = 0) {
        if (!ensure()) return;
        const t = ctx.currentTime;
        const base = 880 * Math.pow(2, p * 0.9);
        [1, 2.76].forEach((k, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'sine';
          o.frequency.value = base * k;
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(i ? 0.025 : 0.07, t + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, t + (i ? 0.12 : 0.3));
          o.connect(g).connect(master);
          o.start(t);
          o.stop(t + 0.35);
        });
      },
      // Мягкий «пуф» в начале прокрута
      start() {
        if (!ensure()) return;
        const t = ctx.currentTime;
        note(392, t, 0.18, 0.08);
        note(523.25, t + 0.06, 0.22, 0.08);
      },
      // Выпал бреинрот: чем реже, тем выше и длиннее аккорд
      win(rarity = 'common') {
        if (!ensure()) return;
        const t = ctx.currentTime + 0.02;
        const chords = {
          common: [523.25, 659.25],
          rare: [523.25, 659.25, 783.99],
          epic: [587.33, 739.99, 880, 1174.66],
          legendary: [659.25, 830.61, 987.77, 1318.51, 1661.22],
          og: [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093],
        };
        (chords[rarity] || chords.common).forEach((fq, i) => note(fq, t + i * 0.075, 0.55 + i * 0.08, 0.16));
      },
      // Апгрейд: победа — восходящий аккорд, проигрыш — тихие две ноты вниз
      upWin() {
        if (!ensure()) return;
        const t = ctx.currentTime + 0.02;
        [523.25, 659.25, 783.99, 1046.5].forEach((fq, i) => note(fq, t + i * 0.08, 0.6 + i * 0.1, 0.17));
      },
      upLose() {
        if (!ensure()) return;
        const t = ctx.currentTime + 0.02;
        note(392, t, 0.35, 0.12, 'triangle');
        note(311.13, t + 0.14, 0.5, 0.11, 'triangle');
      },
      // OG едет к маркеру: нарастание. Сам звук — в og-sound.js
      ogRise(sec = 3) {
        if (!ensure() || !window.BGOgSound) return null;
        return window.BGOgSound.rise(ctx, master, ctx.currentTime + 0.01, sec);
      },
      // OG выпал: удар, взрыв, аккорд и искры
      ogBoom() {
        if (!ensure() || !window.BGOgSound) return;
        window.BGOgSound.boom(ctx, master, ctx.currentTime + 0.01);
      },
    };
  })();
  // Браузеры разрешают звук только после первого касания
  addEventListener('pointerdown', () => sfx.unlock(), { once: true, capture: true });
  // Звук нажатия на всё, что нажимается: кнопки, ссылки, карточки, переключатели
  const CLICKABLE = 'button, a[href], [role="button"], [role="switch"], label.chip, select';
  addEventListener('click', (e) => {
    const el = e.target.closest?.(CLICKABLE);
    if (!el || el.disabled || el.closest('[data-nosnd]')) return;
    const sw = el.matches('[role="switch"], .tgl');
    const wasOn = sw && (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true');
    if (prefs.sound) sfx.click(sw ? (wasOn ? 0.8 : 1.25) : 1);
    // включили звук этим нажатием — подтверждаем щелчком уже после включения
    else setTimeout(() => prefs.sound && sfx.click(1.25), 0);
  }, true);
  const SOUND_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  const SOUND_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6M22 9l-5 6"/></svg>';
  const SKIP_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 5l9 7-9 7zM13 5l9 7-9 7z"/></svg>';
  const FAST_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>';
  // Кнопки «Быстро» и «Звук» — одинаковые на кейсе и в апгрейдере
  function speedSoundHtml() {
    return `<button class="tgl ${prefs.fast ? 'on' : ''}" id="tFast" aria-pressed="${prefs.fast}" title="Быстрый прокрут">${FAST_ICON}<span>Быстро</span></button>
      <button class="tgl icon ${prefs.sound ? 'on' : ''}" id="tSound" aria-pressed="${prefs.sound}" aria-label="Звук">${prefs.sound ? SOUND_ON : SOUND_OFF}</button>`;
  }
  function bindSpeedSound(root) {
    $('#tFast', root).onclick = (e) => {
      prefs.fast = !prefs.fast;
      savePrefs();
      e.currentTarget.classList.toggle('on', prefs.fast);
      e.currentTarget.setAttribute('aria-pressed', prefs.fast);
      tick();
    };
    $('#tSound', root).onclick = (e) => {
      prefs.sound = !prefs.sound;
      savePrefs();
      const b = e.currentTarget;
      b.classList.toggle('on', prefs.sound);
      b.setAttribute('aria-pressed', prefs.sound);
      b.innerHTML = prefs.sound ? SOUND_ON : SOUND_OFF;
      if (prefs.sound) sfx.tick();
    };
  }

  // Если «Быстро»/«Звук» поменяли в настройках — обновляем кнопки на открытой странице
  function syncSpeedSound() {
    const f = $('#tFast');
    if (f) { f.classList.toggle('on', prefs.fast); f.setAttribute('aria-pressed', prefs.fast); }
    const b = $('#tSound');
    if (b) { b.classList.toggle('on', prefs.sound); b.setAttribute('aria-pressed', prefs.sound); b.innerHTML = prefs.sound ? SOUND_ON : SOUND_OFF; }
  }

  // ---------- Режим стримера: размываем то, к чему придирается модерация эфиров ----------
  // Каждая группа — список CSS-селекторов. Новый блок на сайте = добавить его селектор в нужную группу.
  const SM_CATS = [
    {
      id: 'balance',
      title: 'Баланс и доход',
      desc: 'Баланс в шапке и в профиле, реферальный доход и статистика профиля.',
      sel: ['#balance', '.bal-big', '.stats .stat b', '.ref-income-sum'],
    },
    {
      id: 'pay',
      title: 'Пополнение и вывод',
      desc: 'Кнопки пополнения и вывода размыты и не нажимаются, чтобы случайно не открыть их в эфире. История выводов тоже скрыта.',
      sel: ['#topup', '#pTopup', '#promoUse', '[data-a="withdraw"]', '#wdHistory', '.wd-layer'],
      block: ['#topup', '#pTopup', '#promoUse', '[data-a="withdraw"]'],
    },
    {
      id: 'prices',
      title: 'Цены и суммы',
      desc: 'Стоимость кейсов и бреинротов, «Топ-дроп дня», итог выпадения и суммы в пополнении.',
      sel: ['.price', '.td-price', '.total b', '#partnerBox .line .muted'],
    },
    {
      id: 'spin',
      title: 'Прокрутка и результат',
      desc: 'Лента открытия кейса, круг апгрейдера, мистери и окно с тем, что выпало. Самый узнаваемый кадр.',
      sel: ['.roulette', '.result-row', '.result-total', '.ring-wrap', '.mys-stage', '.mys-cap'],
    },
    {
      id: 'images',
      title: 'Картинки',
      desc: 'Кейсы и бреинроты чуть размыты: понятно, что на экране, но без витрины.',
      sel: ['#view img:not(.coin):not(.logo):not(.ava-img)', '.sheet img:not(.coin)'],
      half: true,
    },
    {
      id: 'words',
      title: 'Слова',
      desc: '«Кейс», «вывод», «пополнение», «апгрейд», «выигрыш», «дроп» и похожие — везде в тексте сайта.',
      sel: ['.smw'],
    },
  ];
  const SM_BLUR = [0, 4, 7, 11];
  // «Азартные» слова: русские основы и английские варианты, с любыми окончаниями
  const SM_WORDS = /(?<![\p{L}\p{N}])(?:кейс|ставк|выв(?:од|ед|ест|ел)|депозит|пополн|апгрейд|джекпот|казино|выигр|выйгр|проигр|рулетк|дроп|прокрут|крутк|шанс|лутбокс|cases?|upgrade|deposit|withdraw|jackpot|casino|drops?)[\p{L}\p{N}]*(?:-[\p{L}\p{N}]+)*/giu;
  const SM_SKIP = 'script,style,textarea,input,select,option,svg,.smw,[data-sm-skip]';

  const smWords = (() => {
    let obs = null;
    const wrap = (node) => {
      const t = node.nodeValue;
      if (!t || t.length < 3) return;
      SM_WORDS.lastIndex = 0;
      if (!SM_WORDS.test(t)) return;
      const parent = node.parentElement;
      if (!parent || parent.closest(SM_SKIP)) return;
      SM_WORDS.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      let m;
      while ((m = SM_WORDS.exec(t))) {
        if (m.index > last) frag.append(t.slice(last, m.index));
        const w = document.createElement('span');
        w.className = 'smw';
        w.textContent = m[0];
        frag.append(w);
        last = m.index + m[0].length;
      }
      if (last < t.length) frag.append(t.slice(last));
      node.replaceWith(frag);
    };
    const scan = (root) => {
      if (root.nodeType === 3) return wrap(root);
      if (root.nodeType !== 1 || root.closest(SM_SKIP)) return;
      const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const list = [];
      while (it.nextNode()) list.push(it.currentNode);
      list.forEach(wrap);
    };
    return {
      start() {
        if (obs) return;
        scan(document.body);
        // Срабатывает до отрисовки кадра, поэтому новое слово не успевает мелькнуть
        obs = new MutationObserver((muts) => {
          for (const m of muts) {
            if (m.type === 'characterData') scan(m.target);
            else m.addedNodes.forEach(scan);
          }
        });
        obs.observe(document.body, { childList: true, subtree: true, characterData: true });
      },
      stop() {
        obs?.disconnect();
        obs = null;
        $$('.smw').forEach((w) => {
          const p = w.parentNode;
          w.replaceWith(w.textContent);
          p?.normalize();
        });
      },
    };
  })();

  const smStyle = document.createElement('style');
  document.head.append(smStyle);
  const smHidden = (id) => prefs.sm.on && prefs.sm.hide[id];
  function applyStreamer() {
    const sm = prefs.sm;
    let css = '';
    if (sm.on) {
      const b = SM_BLUR[sm.blur];
      for (const c of SM_CATS) {
        if (!sm.hide[c.id]) continue;
        const sel = c.sel.join(',');
        css += `${sel}{filter:blur(${c.half ? b / 2 : b}px)!important;transition:filter .25s}`;
        if (c.id === 'words') css += '.smw{display:inline-block}';
        if (c.block) css += `${c.block.join(',')}{pointer-events:none!important;user-select:none}`;
        if (sm.hover) css += `@media (hover:hover){${c.sel.map((x) => x + ':hover').join(',')}{filter:none!important}}`;
      }
    }
    smStyle.textContent = css;
    document.body.classList.toggle('streamer', sm.on);
    if (sm.on && sm.hide.words) smWords.start();
    else smWords.stop();
  }
  // Пополнение/вывод, открытые не кнопкой (например, «Открыть» без денег), — тоже не открываем
  function payBlocked() {
    if (!smHidden('pay')) return false;
    toast('Пополнение и вывод скрыты режимом стримера. Выключить — в настройках', 'err', 3000);
    return true;
  }

  // ---------- Блокировка выхода, пока крутится кейс или апгрейд ----------
  let lastLockToast = 0;
  function lockNav(on) {
    state.locked = on;
    document.body.classList.toggle('locked', on);
    try {
      if (on) { TG?.enableClosingConfirmation?.(); TG?.BackButton?.hide(); }
      else { TG?.disableClosingConfirmation?.(); if ((location.hash || '#/') !== '#/') TG?.BackButton?.show(); }
    } catch {}
  }
  function lockedNotice() {
    if (Date.now() - lastLockToast < 1500) return;
    lastLockToast = Date.now();
    tick();
    toast('Дождись, пока закончится прокрутка', 'err', 2000);
  }
  // Клики по ссылкам, «+», меню и аватарке не срабатывают, пока идёт прокрутка
  document.addEventListener('click', (e) => {
    if (!state.locked) return;
    if (e.target.closest('a[href], #topup, #avatar, #menuBtn, .back')) {
      e.preventDefault();
      e.stopPropagation();
      lockedNotice();
    }
  }, true);
  const stale = (t) => t !== state.render;

  async function api(path, { method = 'GET', body } = {}) {
    const headers = {};
    if (TG?.initData) headers.authorization = 'tma ' + TG.initData;
    else if (DEV_ID) headers.authorization = 'dev ' + DEV_ID;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    try {
      res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch {
      throw new Error('Нет связи с сервером, проверь интернет');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.error === 'site_closed') showClosed(data.mode);
      const e = new Error(data.message || `Ошибка ${res.status}`);
      e.code = data.error;
      e.data = data;
      throw e;
    }
    return data;
  }

  // ---------- Технический перерыв / в разработке ----------
  const CLOSED = {
    maintenance: { title: 'Технический перерыв', text: 'Обновляем Brainrot Grader. Баланс и бреинроты в сохранности. Загляни через несколько минут.' },
    development: { title: 'Сейчас в разработке', text: 'Brainrot Grader скоро откроется. Следи за новостями в нашем канале — запуск совсем скоро.' },
  };
  function showClosed(mode) {
    const c = CLOSED[mode] || CLOSED.maintenance;
    if ($('#closed')) return;
    document.body.append(h(`
      <div class="closed" id="closed">
        <img src="/img/logo.svg?v=3" alt="Brainrot Grader">
        <h1><span class="closed-dot"></span>${esc(c.title)}</h1>
        <p>${esc(c.text)}</p>
        <button class="btn" onclick="location.reload()">Обновить</button>
      </div>`));
  }
  function adminModeStrip() {
    if (!state.me?.siteMode || state.me.siteMode === 'open') return;
    const c = CLOSED[state.me.siteMode];
    const title = esc(c ? c.title : state.me.siteMode);
    if (state.me.isAdmin) document.body.prepend(h(`<div class="mode-strip">Режим «${title}»: игроки не могут зайти, ты видишь сайт как админ</div>`));
    else if (state.me.isTester) document.body.prepend(h(`<div class="mode-strip tester">🧪 Ты тестер. ${title} — обычные игроки сейчас зайти не могут</div>`));
  }

  // ---------- Уведомления сверху: зелёные/красные, пропадают через 6 секунд или по нажатию ----------
  function toast(text, type = 'ok', ms = 6000) {
    const el = h(`<div class="toast ${type === 'err' ? 'err' : ''}" role="status"></div>`);
    el.textContent = text;
    $('#toasts').append(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
    const close = () => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    };
    el.addEventListener('click', close);
    setTimeout(close, ms);
  }
  const fail = (e) => {
    haptic('error');
    toast(e.message || String(e), 'err');
  };

  // ---------- Нижняя шторка ----------
  let sheet = null;
  function openSheet(title, body, { onClose } = {}) {
    closeSheet();
    const ov = h('<div class="overlay"></div>');
    const sh = h('<div class="sheet" role="dialog" aria-modal="true"><div class="sheet-head"><h3></h3><button class="x" aria-label="Закрыть">×</button></div></div>');
    $('h3', sh).textContent = title;
    sh.append(body);
    document.body.append(ov, sh);
    requestAnimationFrame(() => requestAnimationFrame(() => { ov.classList.add('show'); sh.classList.add('show'); }));
    const close = () => {
      if (sheet?.sh !== sh) return;
      sheet = null;
      ov.classList.remove('show');
      sh.classList.remove('show');
      setTimeout(() => { ov.remove(); sh.remove(); }, 280);
      onClose?.();
    };
    ov.addEventListener('click', close);
    $('.x', sh).addEventListener('click', close);
    sheet = { sh, close, setTitle: (t) => ($('h3', sh).textContent = t) };
    return sheet;
  }
  function closeSheet() {
    sheet?.close();
  }

  // ---------- Шапка ----------
  function setBalance(n) {
    if (state.me) state.me.balance = n;
    $('#balance').textContent = fmt(n);
  }
  async function refreshMe() {
    state.me = await api('/api/me');
    setBalance(state.me.balance);
    return state.me;
  }
  // Аватарка: сначала копия с нашего сервера (/api/avatar), потом ссылка из Telegram.
  // Картинку показываем только если она реально загрузилась, иначе — первая буква имени.
  let avatarPromise = null;
  function tryImage(src) {
    return new Promise((done) => {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = () => done(img.naturalWidth > 0 ? src : null);
      img.onerror = () => done(null);
      img.src = src;
    });
  }
  function loadAvatar() {
    avatarPromise ||= (async () => {
      try {
        const headers = TG?.initData ? { authorization: 'tma ' + TG.initData } : DEV_ID ? { authorization: 'dev ' + DEV_ID } : {};
        const r = await fetch('/api/avatar', { headers });
        if (r.ok && (r.headers.get('content-type') || '').startsWith('image/')) {
          const src = await tryImage(URL.createObjectURL(await r.blob()));
          if (src) return src;
        }
      } catch {}
      const url = state.me?.photoUrl;
      if (url && /^https:\/\//.test(url)) return tryImage(url);
      return null;
    })();
    return avatarPromise;
  }
  async function fillAvatar(el) {
    if (!el) return;
    el.textContent = (state.me?.firstName || state.me?.username || '?').slice(0, 1).toUpperCase();
    const src = await loadAvatar();
    if (!src || !el.isConnected) return;
    const img = document.createElement('img');
    img.className = 'ava-img';
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = src;
    el.replaceChildren(img);
  }

  // ---------- Меню (кнопка ≡ слева сверху) ----------
  // Новый режим = одна строка в MENU + его страница в route().
  // badge: 'NEW' — жёлтая метка; show: () => true/false — показывать ли пункт (например, только админам).
  const ICON = {
    cases: '<path d="M3 9h18v11H3z"/><path d="M5 9V5h14v4"/><path d="M10 13h4"/>',
    upgrade: '<circle cx="12" cy="12" r="9"/><path d="M12 16V8"/><path d="m8.5 11.5 3.5-3.5 3.5 3.5"/>',
    mystery: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9.6 9.6a2.4 2.4 0 1 1 3.4 2.2c-.6.3-1 .8-1 1.5v.6"/><path d="M12 16.8h.01"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>',
    friends: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5.5 6.5-5.5s5.5 2 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18.2 14.9c1.6.8 2.7 2.4 3.3 5.1"/>',
  };
  const MENU = [
    {
      group: 'Игры',
      items: [
        { id: 'home', label: 'Кейсы', href: '#/', icon: 'cases' },
        { id: 'upgrade', label: 'Апгрейдер', href: '#/upgrade', icon: 'upgrade' },
        { id: 'mystery', label: 'Мистери', href: '#/mystery', icon: 'mystery', badge: 'NEW', show: () => state.cfg?.mystery?.enabled !== false },
      ],
    },
    {
      group: null,
      items: [
        { id: 'referrals', label: 'Рефералы', href: '#/referrals', icon: 'friends' },
        { id: 'settings', label: 'Настройки', icon: 'settings', action: () => openSettings() },
      ],
    },
  ];
  const svgIcon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ''}</svg>`;
  // Какой пункт меню подсвечен на текущей странице
  function currentSection() {
    const path = (location.hash.slice(1) || '/').split('?')[0];
    if (path.startsWith('/upgrade')) return 'upgrade';
    if (path.startsWith('/mystery')) return 'mystery';
    if (path.startsWith('/referrals')) return 'referrals';
    if (path.startsWith('/profile')) return 'profile';
    return 'home';
  }

  // ---------- Компьютер: разделы прямо в шапке ----------
  function drawTopnav() {
    const nav = $('#topnav');
    if (!nav) return;
    const cur = currentSection();
    nav.innerHTML = MENU.flatMap((g) => g.items)
      .filter((it) => it.href && (!it.show || it.show()))
      .map((it) => `<a class="tn-item" href="${it.href}" ${it.id === cur ? 'aria-current="page"' : ''}>${svgIcon(it.icon)}<span>${esc(it.label)}</span>${it.badge ? `<i class="tn-new">${esc(it.badge)}</i>` : ''}</a>`)
      .join('');
  }

  // ---------- Компьютер: живая лента слева (топ-дроп дня и последние дропы) ----------
  const WIDE = matchMedia('(min-width: 1200px)');
  const live = { busy: false, ids: new Set() };
  const liveCard = (d) => (rememberDrop(d), '') + `
    <div class="lb-drop swap rar-${esc(d.rarity)}" data-drop="${esc(d.id)}" data-id="${esc(d.id)}" role="link" tabindex="0">
      ${ogTag(d)}<img src="${itemImg(d.image)}" alt=""><b>${esc(d.name)}</b>${price(d.price)}${srcLayer(d)}
    </div>`;
  function drawLive(home, animate) {
    const bar = $('#livebar');
    if (!bar) return;
    if (!bar.firstChild) bar.innerHTML = '<div class="lb-head"><span class="live"><i></i>LIVE</span></div><div class="lb-top" id="lbTop"></div><div class="lb-list" id="lbList"></div>';
    const top = home.top;
    $('#lbTop', bar).innerHTML = top
      ? (rememberDrop(top), '') + `<div class="lb-top-in swap rar-${esc(top.rarity)}" data-drop="${esc(top.id)}" role="link" tabindex="0"><span class="td-label">🏆 Топ-дроп дня</span>${ogTag(top)}<img src="${itemImg(top.image)}" alt=""><b>${esc(top.name)}</b><span class="td-price">${COIN}${fmt(top.price)}</span>${srcLayer(top)}</div>`
      : `<div class="lb-top-in"><span class="td-label">🏆 Топ-дроп дня</span><div class="lb-empty">${HOURGLASS}<span class="muted">Сегодня ещё пусто</span></div></div>`;
    const list = $('#lbList', bar);
    const fresh = home.drops.filter((d) => !live.ids.has(d.id));
    if (!animate || !live.ids.size) list.innerHTML = home.drops.map(liveCard).join('');
    else if (fresh.length) {
      list.insertAdjacentHTML('afterbegin', fresh.map(liveCard).join(''));
      $$('.lb-drop', list).slice(0, fresh.length).forEach((el) => el.classList.add('new'));
      $$('.lb-drop', list).slice(home.drops.length).forEach((el) => el.remove());
    }
    live.ids = new Set(home.drops.map((d) => d.id));
  }
  async function liveTick(animate = true) {
    if (!WIDE.matches || document.hidden || live.busy || !state.me || state.locked) return;
    live.busy = true;
    try { drawLive(await api('/api/home'), animate); } catch {}
    live.busy = false;
  }
  function setupDesktop() {
    $('#setBtn').onclick = () => openSettings();
    // высота шапки — чтобы лента слева начиналась сразу под ней
    const bar = $('.topbar');
    const setH = () => document.documentElement.style.setProperty('--hdr', `${bar.offsetTop + bar.offsetHeight}px`);
    setH();
    if (window.ResizeObserver) new ResizeObserver(setH).observe(bar);
    addEventListener('resize', setH);
    liveTick(false);
    setInterval(() => liveTick(true), 10000);
    WIDE.addEventListener?.('change', () => liveTick(false));
    document.addEventListener('visibilitychange', () => !document.hidden && liveTick(true));
  }

  let menu = null;
  function openMenu() {
    if (menu || state.locked) return;
    closeSheet();
    const cur = currentSection();
    const ov = h('<div class="menu-ov"></div>');
    const el = h(`
      <aside class="menu" role="dialog" aria-modal="true" aria-label="Меню">
        <div class="menu-top">
          <img class="logo" src="/img/logo.svg?v=3" alt="Brainrot Grader">
          <button class="x" id="menuX" aria-label="Закрыть меню">×</button>
        </div>
        <nav class="menu-list">
          ${MENU.map((g) => {
            const items = g.items.filter((it) => !it.show || it.show());
            if (!items.length) return '';
            return (g.group ? `<div class="menu-group">${esc(g.group)}</div>` : '<div class="menu-sep"></div>') + items.map((it) => {
              const inner = `${svgIcon(it.icon)}<span>${esc(it.label)}</span>${it.badge ? `<span class="menu-new">${esc(it.badge)}</span>` : ''}`;
              const curAttr = it.id === cur ? ' aria-current="page"' : '';
              return it.href
                ? `<a class="menu-item" href="${it.href}" data-id="${it.id}"${curAttr}>${inner}</a>`
                : `<button class="menu-item" data-id="${it.id}">${inner}</button>`;
            }).join('');
          }).join('')}
        </nav>
      </aside>`);
    document.body.append(ov, el);
    requestAnimationFrame(() => requestAnimationFrame(() => { ov.classList.add('show'); el.classList.add('show'); }));
    $('#menuBtn').setAttribute('aria-expanded', 'true');
    menu = { ov, el };
    try { TG?.BackButton?.show(); } catch {}
    tick();

    ov.addEventListener('click', closeMenu);
    $('#menuX', el).onclick = closeMenu;
    $$('.menu-item', el).forEach((a) => a.addEventListener('click', (e) => {
      const it = MENU.flatMap((g) => g.items).find((x) => x.id === a.dataset.id);
      if (it?.action) { e.preventDefault(); closeMenu(); return it.action(); }
      // Нажали на страницу, где уже стоим — просто закрываем меню
      if (a.getAttribute('href') === (location.hash || '#/')) e.preventDefault();
      closeMenu();
    }));
    // Свайп влево закрывает меню
    let x0 = null;
    let dx = 0;
    el.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; dx = 0; el.style.transition = 'none'; }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (x0 === null) return;
      dx = Math.min(0, e.touches[0].clientX - x0);
      el.style.transform = `translateX(${dx}px)`;
    }, { passive: true });
    el.addEventListener('touchend', () => {
      el.style.transition = '';
      el.style.transform = '';
      if (dx < -70) closeMenu();
      x0 = null;
    });
    $('#menuX', el).focus({ preventScroll: true });
  }
  function closeMenu() {
    if (!menu) return;
    const { ov, el } = menu;
    menu = null;
    ov.classList.remove('show');
    el.classList.remove('show');
    setTimeout(() => { ov.remove(); el.remove(); }, 280);
    $('#menuBtn').setAttribute('aria-expanded', 'false');
    try { if ((location.hash || '#/') === '#/') TG?.BackButton?.hide(); } catch {}
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu) closeMenu(); });

  // ---------- Настройки (меню ≡ и «⋮» Telegram) ----------
  const sw = (key, on, label) => `<button class="sw ${on ? 'on' : ''}" data-k="${key}" role="switch" aria-checked="${on}" aria-label="${esc(label)}"><i></i></button>`;
  function openSettings() {
    if (state.locked) return lockedNotice();
    closeMenu();
    const sm = prefs.sm;
    const body = h(`
      <div class="settings" data-sm-skip>
        <section class="set-group">
          <div class="set-row">
            <div class="grow"><b>Звук</b><p>Нажатия кнопок, щелчки ленты, выпадения и апгрейд. Запоминается на этом устройстве.</p></div>
            ${sw('sound', prefs.sound, 'Звук')}
          </div>
          <div class="set-vol ${prefs.sound ? '' : 'off'}">
            <span>Громкость</span>
            <input type="range" id="setVol" min="0" max="100" step="5" value="${prefs.volume}" aria-label="Громкость">
            <b id="setVolV">${prefs.volume}%</b>
          </div>
          <div class="set-row">
            <div class="grow"><b>Быстрая прокрутка</b><p>Кейсы и апгрейдер крутятся в несколько раз быстрее.</p></div>
            ${sw('fast', prefs.fast, 'Быстрая прокрутка')}
          </div>
        </section>

        <section class="set-group">
          <div class="set-row main">
            <div class="grow"><b>Режим стримера</b><p>Для эфиров в TikTok и других стримов. Размывает деньги, цены, прокрутку и «азартные» слова — то, за что модерация чаще всего режет эфир. Что именно скрывать, выбери ниже.</p></div>
            ${sw('sm', sm.on, 'Режим стримера')}
          </div>
          <div class="set-sub ${sm.on ? '' : 'off'}" id="smSub">
            <div class="set-cap">Что скрывать</div>
            ${SM_CATS.map((c) => `
              <div class="set-row">
                <div class="grow"><b>${esc(c.title)}</b><p>${esc(c.desc)}</p></div>
                ${sw('hide:' + c.id, sm.hide[c.id], c.title)}
              </div>`).join('')}
            <div class="set-row col">
              <div class="grow"><b>Сила размытия</b><p>Картинки всегда размываются в два раза мягче, чтобы на экране не было пустых пятен.</p></div>
              <div class="seg3" role="group" aria-label="Сила размытия">
                ${['Слабо', 'Средне', 'Сильно'].map((t, i) => `<button data-blur="${i + 1}" class="${sm.blur === i + 1 ? 'on' : ''}">${t}</button>`).join('')}
              </div>
            </div>
            <div class="set-row">
              <div class="grow"><b>Проявлять под мышкой</b><p>Только на компьютере: наведи курсор на размытое, и оно станет чётким. Если курсор не захватывается в трансляцию, зрители этого не увидят.</p></div>
              ${sw('hover', sm.hover, 'Проявлять под мышкой')}
            </div>
          </div>
        </section>
      </div>`);
    openSheet('Настройки', body);
    const save = () => { savePrefs(); applyStreamer(); syncSpeedSound(); };
    $$('.sw', body).forEach((b) => (b.onclick = () => {
      const k = b.dataset.k;
      let on;
      if (k === 'sound') { on = prefs.sound = !prefs.sound; $('.set-vol', body).classList.toggle('off', !on); }
      else if (k === 'fast') on = prefs.fast = !prefs.fast;
      else if (k === 'sm') { on = sm.on = !sm.on; $('#smSub', body).classList.toggle('off', !on); }
      else if (k === 'hover') on = sm.hover = !sm.hover;
      else if (k.startsWith('hide:')) { const id = k.slice(5); on = sm.hide[id] = !sm.hide[id]; }
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', on);
      tick();
      save();
      if (k === 'sound' && on) sfx.tick();
    }));
    const vol = $('#setVol', body);
    vol.oninput = () => {
      prefs.volume = Number(vol.value);
      $('#setVolV', body).textContent = `${prefs.volume}%`;
      sfx.setVolume();
    };
    vol.onchange = () => {
      savePrefs();
      if (prefs.sound) { sfx.unlock(); sfx.setVolume(); sfx.clack(); }
    };
    $$('[data-blur]', body).forEach((b) => (b.onclick = () => {
      sm.blur = Number(b.dataset.blur);
      $$('[data-blur]', body).forEach((x) => x.classList.toggle('on', x === b));
      tick();
      save();
    }));
  }

  // ---------- Маршруты ----------
  function route() {
    if (state.locked) {
      history.replaceState(null, '', state.currentHash || '#/');
      lockedNotice();
      return;
    }
    state.currentHash = location.hash || '#/';
    const hash = location.hash.slice(1) || '/';
    const [path, qs] = hash.split('?');
    closeSheet();
    closeMenu();
    stopTimers();
    newRender();
    const tab = path.startsWith('/upgrade') ? 'upgrade' : path.startsWith('/mystery') ? 'mystery' : path.startsWith('/profile') ? 'profile' : path.startsWith('/referrals') ? 'referrals' : 'home';
    const m = /^\/case\/(\d+)$/.exec(path);
    view.dataset.page = m ? 'case' : tab; // для раскладки на компьютере
    drawTopnav();
    // Нижней панели нет: на всех страницах, кроме главной, работает кнопка «Назад» Telegram
    try {
      if (m || tab !== 'home') TG?.BackButton?.show();
      else TG?.BackButton?.hide();
    } catch {}
    window.scrollTo(0, 0);
    if (m) return renderCase(Number(m[1]));
    if (tab === 'upgrade') return renderUpgrade(new URLSearchParams(qs || ''));
    if (tab === 'mystery') return renderMystery(new URLSearchParams(qs || ''));
    if (tab === 'profile') return renderProfile();
    if (tab === 'referrals') return renderReferrals();
    return renderHome();
  }

  // =====================================================================
  //                               ГЛАВНАЯ
  // =====================================================================
  // Песочные часы в пиксельном стиле (рисуем сами, без картинок)
  const HOURGLASS = `<svg class="hourglass" viewBox="0 0 12 20" shape-rendering="crispEdges" aria-hidden="true">
    <rect x="0" y="0" width="12" height="2" fill="#8a5a24"/><rect x="0" y="0" width="12" height="1" fill="#c88a3a"/>
    <rect x="0" y="18" width="12" height="2" fill="#8a5a24"/><rect x="0" y="18" width="12" height="1" fill="#c88a3a"/>
    <rect x="1" y="2" width="1" height="16" fill="#6b4419"/><rect x="10" y="2" width="1" height="16" fill="#6b4419"/>
    <g fill="#cfeee3" opacity=".22"><rect x="3" y="2" width="6" height="3"/><rect x="4" y="5" width="4" height="2"/><rect x="5" y="7" width="2" height="3"/><rect x="4" y="10" width="4" height="2"/><rect x="3" y="12" width="6" height="6"/></g>
    <rect x="3" y="4" width="6" height="1" fill="#f2b33d"/><rect x="4" y="5" width="4" height="2" fill="#f2b33d"/><rect x="5" y="7" width="2" height="1" fill="#f2b33d"/>
    <rect class="sand-stream" x="5.5" y="8" width="1" height="7" fill="#f2b33d"/>
    <rect x="4" y="15" width="4" height="1" fill="#f2b33d"/><rect x="3" y="16" width="6" height="2" fill="#e9a52a"/>
    <rect x="3" y="2" width="1" height="2" fill="#fff" opacity=".35"/>
  </svg>`;
  // ---------- Лента дропов: откуда выпал (подсказка при наведении) и переход по клику ----------
  const drops = new Map();
  function rememberDrop(d) {
    if (!d?.id) return;
    drops.set(String(d.id), d);
    if (drops.size > 300) drops.delete(drops.keys().next().value);
  }
  const dropHref = (d) => (d.source?.kind === 'case' && d.source.caseId ? `#/case/${d.source.caseId}` : d.source?.kind === 'upgrade' ? '#/upgrade' : d.source?.kind === 'mystery' ? '#/mystery' : null);
  // Слой «откуда выпал»: при наведении он плавно заезжает на место бреинрота (без шанса апгрейда)
  const srcLayer = (d) => {
    const src = d.source || {};
    if (src.kind === 'case') {
      return `<span class="drop-src">${src.caseImage ? `<img src="${esc(src.caseImage)}" alt="">` : `<i class="ds-ico">${svgIcon('box')}</i>`}<span class="ds-txt"><small>Кейс</small><b>${esc(src.caseName || 'Кейс')}</b></span></span>`;
    }
    if (src.kind === 'upgrade') return `<span class="drop-src"><i class="ds-ico">${svgIcon('upgrade')}</i><span class="ds-txt"><b>Апгрейд</b></span></span>`;
    if (src.kind === 'mystery') return `<span class="drop-src"><i class="ds-ico">${svgIcon('mystery')}</i><span class="ds-txt"><b>Мистери</b></span></span>`;
    return '';
  };
  const goDrop = (el) => {
    const d = drops.get(el.dataset.drop);
    const href = d && dropHref(d);
    if (!href) return;
    if (location.hash === href) route();
    else location.hash = href;
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-drop]');
    if (el) goDrop(el);
  });
  document.addEventListener('keydown', (e) => {
    const el = e.key === 'Enter' && e.target.closest?.('[data-drop]');
    if (el) goDrop(el);
  });

  const hms = (ms) => {
    const t = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  const dropTile = (d) => (rememberDrop(d), `<div class="drop-tile swap rar-${esc(d.rarity)}" data-drop="${esc(d.id)}" data-id="${esc(d.id)}" role="link" tabindex="0" aria-label="${esc(d.name)} — ${fmt(d.price)} BG"><img src="${itemImg(d.image)}" alt="${esc(d.name)}">${srcLayer(d)}</div>`);

  function drawTopDrop(home) {
    const box = $('#topDropMain');
    if (!box) return;
    const top = home.top;
    box.classList.toggle('swap', !!top);
    if (top) { rememberDrop(top); box.dataset.drop = top.id; box.setAttribute('role', 'link'); box.tabIndex = 0; } else delete box.dataset.drop;
    box.innerHTML = top
      ? `<div class="td-img rar-${esc(top.rarity)}"><img src="${itemImg(top.image)}" alt=""></div>
         <div class="td-info"><span class="td-label">🏆 Топ-дроп дня</span><b class="td-name">${esc(top.name)}</b></div>
         <span class="td-price">${COIN}${fmt(top.price)}</span>${srcLayer(top)}`
      : `<div class="td-img empty-img">${HOURGLASS}</div>
         <div class="td-info"><span class="td-label">🏆 Топ-дроп дня</span><b class="td-name">Сегодня ещё пусто</b><span class="muted td-sub">Открой кейс, и твой дроп окажется здесь</span></div>`;
  }
  function drawDrops(home, animate) {
    const strip = $('#dropsStrip');
    if (!strip) return;
    if (!home.drops.length) { strip.innerHTML = ''; strip.classList.add('hidden'); return; }
    strip.classList.remove('hidden');
    const have = new Set($$('.drop-tile', strip).map((x) => x.dataset.id));
    if (!animate || !have.size) { strip.innerHTML = home.drops.map(dropTile).join(''); return; }
    // новые дропы въезжают слева
    const fresh = home.drops.filter((d) => !have.has(String(d.id)));
    if (!fresh.length) return;
    strip.insertAdjacentHTML('afterbegin', fresh.map(dropTile).join(''));
    $$('.drop-tile', strip).slice(0, fresh.length).forEach((el) => el.classList.add('new'));
    $$('.drop-tile', strip).slice(home.drops.length).forEach((el) => el.remove());
  }
  function drawPromo(home) {
    const box = $('#promoCard');
    if (!box) return;
    const b = home.bonus;
    if (!b) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="promo-top">
        <div class="promo-hero"><img src="/img/brainrots/fortunu-and-cashuru.webp" alt=""><img class="pc pc1" src="/img/coin.webp" alt=""><img class="pc pc2" src="/img/coin.webp" alt=""><img class="pc pc3" src="/img/coin.webp" alt=""></div>
        <div class="promo-time"><span>Осталось времени</span><b id="promoTimer">${hms(new Date(b.endsAt) - Date.now())}</b></div>
        ${HOURGLASS}
      </div>
      <div class="promo-bottom">
        <div class="promo-code-box"><span>Используй промокод</span><button class="promo-code" id="promoCode" aria-label="Скопировать промокод">${esc(b.code)}</button></div>
        <div class="promo-ticket"><b>+${fmt(b.percent)}%</b><span>к пополнению</span></div>
      </div>
      ${b.used
        ? '<p class="promo-used">Этот промокод ты уже использовал. Следующий появится, когда закончится время</p>'
        : '<button class="btn" id="promoUse">Пополнить с промокодом</button>'}`;
    $('#promoCode', box).onclick = () => copy(b.code, 'Промокод скопирован');
    const use = $('#promoUse', box);
    if (use) use.onclick = () => openDeposit(dep.tab, { promo: b.code });
  }

  // Названия разделов кейсов на главной (новый раздел = новая строка здесь + category у кейса)
  const CASE_SECTIONS = { free: 'Бесплатные кейсы', standard: 'Стандартные кейсы', platina: 'Платиновые кейсы', allin: 'ALL-IN кейсы' };

  async function renderHome() {
    const t = state.render;
    view.innerHTML = `
      <section class="top-drop">
        <span class="live"><i></i>LIVE</span>
        <div class="td-main" id="topDropMain"><div class="skeleton" style="height:64px;flex:1"></div></div>
        <div class="drops-strip hidden" id="dropsStrip" aria-label="Последние дропы"></div>
      </section>
      <section class="promo-card hidden" id="promoCard"></section>
      <div id="cases"><h2>Кейсы</h2><div class="case-grid">${'<div class="skeleton"></div>'.repeat(4)}</div></div>`;
    const loadHome = async (animate) => {
      try {
        const home = await api('/api/home');
        if (stale(t)) return;
        const codeChanged = !state.home?.bonus || !home.bonus || state.home.bonus.code !== home.bonus.code || state.home.bonus.used !== home.bonus.used;
        state.home = home;
        drawTopDrop(home);
        drawDrops(home, animate);
        if (!animate || codeChanged) drawPromo(home);
      } catch {}
    };
    loadHome(false);
    // Лента и топ-дроп обновляются сами, таймер промокода тикает каждую секунду
    every(10000, () => !document.hidden && loadHome(true));
    every(1000, () => {
      const el = $('#promoTimer');
      const b = state.home?.bonus;
      if (!el || !b) return;
      const left = new Date(b.endsAt) - Date.now();
      el.textContent = hms(left);
      if (left <= 0 && !state.homeRefreshing) {
        state.homeRefreshing = true;
        setTimeout(() => loadHome(false).finally(() => (state.homeRefreshing = false)), 1500);
      }
    });
    try {
      state.cases = state.cases || (await api('/api/cases'));
    } catch (e) {
      return fail(e);
    }
    if (stale(t)) return;
    // Разделы кейсов: порядок — как идут кейсы, название раздела — из CASE_SECTIONS
    const card = (c) => `
        <a class="case-card" href="#/case/${c.id}">
          <img src="${esc(c.image || '/img/chest.svg')}" alt="">
          <div class="name">${esc(c.name)}</div>
          <div class="row">${c.freeKind
            ? '<span class="muted">раз в сутки</span><span class="free-chip">Бесплатно</span>'
            : `<span class="muted">${c.itemsCount} ${plural(c.itemsCount, 'бреинрот', 'бреинрота', 'бреинротов')}</span>${price(c.price)}`}</div>
        </a>`;
    const groups = new Map();
    for (const c of state.cases) {
      const k = c.category || 'standard';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    $('#cases').innerHTML = state.cases.length
      ? [...groups].map(([k, list]) => `<h2>${esc(CASE_SECTIONS[k] || k)}</h2><div class="case-grid">${list.map(card).join('')}</div>`).join('')
      : '<h2>Кейсы</h2><div class="empty">Кейсы скоро появятся</div>';
  }

  // =====================================================================
  //                         КЕЙС И РУЛЕТКА
  // =====================================================================
  // =====================================================================
  //   Выпал OG: экран трясётся всё сильнее, пока OG едет к маркеру, потом —
  //   вспышка, кольца, лучи, огромное «OG» и пиксельные искры
  // =====================================================================
  const ogFx = (() => {
    let el = null;
    let raf = 0;
    let mode = null; // 'build' — нарастает, 'boom' — толчок и затухание
    let t0 = 0;
    let len = 1;
    let glow = null;
    let timers = [];
    let riseSnd = null; // чтобы оборвать гул, если взрыв раньше (пропуск)
    let pending = null; // ждущий взрыв от arm()
    const later = (fn, ms) => timers.push(setTimeout(fn, ms));
    // Трясём только страницу (шапка с размытием фона на телефоне тяжёлая). На слабых телефонах — меньше искр
    const shaken = () => [view];
    const LOW = matchMedia('(max-width: 700px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
    const vib = (k) => { try { TG?.HapticFeedback?.impactOccurred(k); } catch {} };
    const mount = () => {
      if (el?.isConnected) return el;
      el = h(`<div class="ogfx" aria-hidden="true"><div class="vig"></div><div class="edge"></div><div class="rays"></div><canvas></canvas><div class="flash"></div><div class="ring"></div><div class="ring r2"></div><div class="word"><i></i></div><div class="sub">ВЫПАЛ OG</div></div>`);
      const mask = `url("data:image/svg+xml,${encodeURIComponent(ogSvg('#000').replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '))}")`;
      const w = $('.word i', el);
      w.style.webkitMaskImage = mask;
      w.style.maskImage = mask;
      document.body.appendChild(el);
      return el;
    };
    const centerY = (anchor) => {
      const r = anchor?.getBoundingClientRect?.();
      return r && r.height ? Math.round(r.top + r.height / 2) : Math.round(innerHeight * 0.4);
    };
    const shake = (now) => {
      let a = 0;
      if (mode === 'build') {
        const p = Math.min(1, (now - t0) / len);
        a = 0.5 + p * p * 6.5;
      } else if (mode === 'boom') {
        const p = (now - t0) / 950;
        a = p < 1 ? 17 * (1 - p) * (1 - p) : 0;
      }
      if (!mode || (mode === 'boom' && a <= 0)) {
        shaken().forEach((x) => { x.style.transform = ''; x.style.willChange = ''; });
        raf = 0;
        return;
      }
      const dx = (Math.random() * 2 - 1) * a;
      const dy = (Math.random() * 2 - 1) * a * 0.7;
      const rot = (Math.random() * 2 - 1) * a * 0.09;
      shaken().forEach((x) => (x.style.transform = `translate3d(${dx.toFixed(1)}px,${dy.toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg)`));
      raf = requestAnimationFrame(shake);
    };
    const startShake = (m, ms = 1) => {
      mode = m;
      t0 = performance.now();
      len = ms;
      shaken().forEach((x) => (x.style.willChange = 'transform'));
      if (!raf && !reduced) raf = requestAnimationFrame(shake);
    };
    // Пиксельные искры цветов OG: разлетаются из центра и падают
    function sparks(cy, n = 150, power = 1) {
      const cv = $('canvas', el);
      if (!cv) return;
      const W = innerWidth;
      const H = innerHeight;
      const dpr = LOW ? 1 : Math.min(1.5, devicePixelRatio || 1);
      n = LOW ? Math.round(n * 0.45) : n;
      if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = ['#ff4fb8', '#ffb547', '#fff27a', '#4dffb0', '#4ad8ff', '#b06cff', '#ffffff'];
      const ps = Array.from({ length: n }, () => {
        const a = Math.random() * Math.PI * 2;
        const v = (4 + Math.random() * 12) * power;
        return { x: W / 2, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3.5, s: 3 + 2 * Math.floor(Math.random() * 3), c: cols[(Math.random() * cols.length) | 0], life: 0, max: 55 + Math.random() * 55 };
      });
      let last = performance.now();
      const step = (now) => {
        const dt = Math.min(2.5, (now - last) / 16.67);
        last = now;
        c.clearRect(0, 0, W, H);
        let alive = 0;
        for (const p of ps) {
          p.life += dt;
          if (p.life > p.max) continue;
          alive++;
          p.vx *= Math.pow(0.965, dt);
          p.vy = p.vy * Math.pow(0.965, dt) + 0.3 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          c.globalAlpha = Math.max(0, 1 - p.life / p.max);
          c.fillStyle = p.c;
          c.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
        }
        c.globalAlpha = 1;
        if (alive && el?.isConnected) requestAnimationFrame(step);
        else c.clearRect(0, 0, W, H);
      };
      requestAnimationFrame(step);
    }
    function clear() {
      timers.forEach(clearTimeout);
      timers = [];
      riseSnd?.stop?.();
      riseSnd = null;
      pending?.res();
      pending = null;
      mode = null;
      cancelAnimationFrame(raf);
      raf = 0;
      shaken().forEach((x) => { x.style.transform = ''; x.style.willChange = ''; });
      glow?.classList.remove('og-build');
      glow = null;
      el?.remove();
      el = null;
    }
    // Нарастание: затемнение, пульс по краям, тряска, гул с сердцебиением, вибрация всё чаще
    function build(sec, anchor) {
      if (reduced || sec <= 0.2) return;
      const e = mount();
      e.classList.remove('boom', 'out');
      e.style.setProperty('--cy', centerY(anchor) + 'px');
      e.style.setProperty('--beat', '0.5s');
      requestAnimationFrame(() => e.classList.add('build'));
      glow = anchor || null;
      glow?.classList.add('og-build');
      startShake('build', sec * 1000);
      riseSnd = sfx.ogRise(sec);
      later(() => e.style.setProperty('--beat', '0.3s'), sec * 400);
      later(() => e.style.setProperty('--beat', '0.16s'), sec * 750);
      for (let at = 0, p = 0; at < sec * 1000; p = at / (sec * 1000), at += 520 - p * 400) {
        later(() => vib(p < 0.4 ? 'light' : p < 0.75 ? 'medium' : 'heavy'), at);
      }
    }
    // Взрыв. Промис — когда можно показывать результат (экран уже успокаивается)
    function boom(anchor) {
      timers.forEach(clearTimeout);
      timers = [];
      const e = mount();
      const cy = centerY(anchor || glow);
      glow?.classList.remove('og-build');
      glow = null;
      riseSnd?.stop?.();
      riseSnd = null;
      e.style.setProperty('--cy', cy + 'px');
      e.classList.remove('out', 'boom');
      void e.offsetWidth; // перезапуск анимаций
      e.classList.add('boom');
      sfx.ogBoom();
      vib('heavy');
      later(() => vib('heavy'), 130);
      later(() => vib('rigid'), 280);
      later(() => haptic('success'), 420);
      if (!reduced) {
        startShake('boom');
        sparks(cy, 160, 1);
        later(() => sparks(cy, 90, 0.7), 360);
      }
      later(() => e.classList.add('out'), 1550);
      later(clear, 2100);
      return sleep(1650);
    }
    // Для ленты: нарастание за ~3 с до остановки, взрыв в момент остановки
    function arm(endMs, anchor) {
      const lead = Math.min(3000, endMs * 0.55);
      later(() => build(lead / 1000, anchor), Math.max(0, endMs - lead));
      return new Promise((res) => {
        pending = { anchor, res };
        later(() => fire(), endMs);
      });
    }
    function fire() {
      const pd = pending;
      pending = null;
      if (pd) boom(pd.anchor).then(pd.res);
    }
    // Пропуск прокрута: нарастание отменяем, взрыв — когда лента доедет (через ms)
    function rush(ms) {
      if (!pending) return;
      timers.forEach(clearTimeout);
      timers = [];
      mode = null;
      later(() => fire(), ms);
    }
    return { build, boom, arm, rush, clear };
  })();

  const CARD = 104;
  const STEP = CARD + 8;
  // Сколько карточек пролетает до выигрыша: обычный прокрут — сильный и длинный, быстрый — короткий
  const SPIN = { normal: { win: 125, dur: 9800 }, fast: { win: 36, dur: 2700 } };

  const rCard = (it) => `<div class="r-card rar-${esc(it.rarity)}">${ogTag(it)}<img src="${itemImg(it.image)}" alt=""><div class="n">${esc(it.name)}</div>${price(it.price)}</div>`;
  const itemCard = (it, extra = '') => `<div class="item rar-${esc(it.rarity)}" ${extra}>${ogTag(it)}<img loading="lazy" src="${itemImg(it.image)}" alt=""><div class="n">${esc(it.name)}</div>${price(it.price)}</div>`;

  // Дешёвые чаще мелькают в ленте, как и выпадают на самом деле
  function randomItem(pool) {
    const w = pool.map((p) => 1 / Math.pow(Math.max(p.price, 0.01), 0.8));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) if ((r -= w[i]) <= 0) return pool[i];
    return pool[0];
  }

  function placeStrip(strip, index, offset = 0) {
    const W = strip.parentElement.clientWidth;
    const x = W / 2 - (index * STEP + CARD / 2) + offset;
    strip.style.transform = `translate3d(${x}px,0,0)`;
  }

  // Пока кейс не открывают, лента медленно едет по кругу: все бреинроты, которые могут выпасть
  const idleRaf = new Map();
  function stopIdle(strip) {
    cancelAnimationFrame(idleRaf.get(strip));
    idleRaf.delete(strip);
  }
  function idleStrip(strip, pool) {
    stopIdle(strip);
    strip.style.transition = 'none';
    strip.classList.remove('spinning');
    const seq = [...pool].sort(() => Math.random() - 0.5);
    while (seq.length < 6) seq.push(...pool);
    const period = seq.length * STEP;
    const W = strip.parentElement.clientWidth || 390;
    const reps = Math.ceil((W + period) / period) + 1;
    strip.innerHTML = Array.from({ length: reps }, () => seq.map(rCard).join('')).join('');
    const speed = reduced ? 0 : 34; // пикселей в секунду
    let x = Math.random() * period;
    let last = performance.now();
    const loop = (now) => {
      if (!strip.isConnected || !idleRaf.has(strip)) return idleRaf.delete(strip);
      x = (x + (speed * Math.min(now - last, 100)) / 1000) % period;
      last = now;
      strip.style.transform = `translate3d(${-x}px,0,0)`;
      idleRaf.set(strip, requestAnimationFrame(loop));
    };
    idleRaf.set(strip, requestAnimationFrame(loop));
    strip.style.transform = `translate3d(${-x}px,0,0)`;
  }

  // Щелчок, когда под маркером проходит новая карточка: частота сама замедляется вместе с лентой
  function followStrip(strip, until) {
    const lim = typeof until === 'object' ? until : { until };
    const W = strip.parentElement.clientWidth;
    let last = null;
    const loop = () => {
      if (performance.now() > lim.until || !strip.isConnected) return;
      const m = new DOMMatrixReadOnly(getComputedStyle(strip).transform);
      const idx = Math.floor((W / 2 - m.m41) / STEP);
      if (last !== null && idx !== last) sfx.clack();
      last = idx;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  // «Пропустить»: одна кнопка останавливает все ленты разом
  function makeSkip() {
    const fns = [];
    return {
      used: false,
      add(fn) { fns.push(fn); },
      fire() {
        if (this.used) return;
        this.used = true;
        fns.forEach((fn) => fn());
      },
    };
  }

  async function spinStrip(strip, pool, winner, { delay = 0, sound = true, skip = null } = {}) {
    const cfg = prefs.fast ? SPIN.fast : SPIN.normal;
    const winIdx = cfg.win;
    const cards = Array.from({ length: winIdx + 6 }, (_, i) => (i === winIdx ? winner : randomItem(pool)));
    stopIdle(strip);
    strip.style.transition = 'none';
    strip.classList.remove('spinning');
    strip.innerHTML = cards.map(rCard).join('');
    placeStrip(strip, 3);
    strip.getBoundingClientRect(); // применяем стартовую позицию до анимации
    const dur = reduced ? 700 : cfg.dur + delay;
    const jitter = (Math.random() * 0.7 - 0.35) * CARD; // останавливаемся не ровно по центру — живее
    strip.classList.add('spinning');
    strip.style.transition = `transform ${dur}ms cubic-bezier(0.04, 0.7, 0.09, 1)`;
    placeStrip(strip, winIdx, jitter);
    const follow = { until: performance.now() + dur };
    if (sound) followStrip(strip, follow);
    // Лёгкая вибрация, пока лента быстрая
    let k = 0;
    const tk = setInterval(() => (k++ < (prefs.fast ? 8 : 20) ? tick() : clearInterval(tk)), 140);
    const unblur = setTimeout(() => strip.classList.remove('spinning'), dur * 0.62);
    await new Promise((done) => {
      let over = false;
      const end = setTimeout(() => { over = true; done(); }, dur + 60);
      // Пропуск: лента с того места, где сейчас, быстро доезжает до того же выпавшего бреинрота
      skip?.add(() => {
        if (over) return;
        clearTimeout(end);
        clearTimeout(unblur);
        clearInterval(tk);
        strip.classList.remove('spinning');
        const now = getComputedStyle(strip).transform;
        strip.style.transition = 'none';
        strip.style.transform = now;
        strip.getBoundingClientRect();
        const fin = 420;
        strip.style.transition = `transform ${fin}ms cubic-bezier(0.2, 0.75, 0.25, 1)`;
        placeStrip(strip, winIdx, jitter);
        follow.until = performance.now() + fin;
        setTimeout(() => { over = true; done(); }, fin + 40);
      });
    });
    clearInterval(tk);
    // размываем только видимые соседние карточки: blur на сотнях карточек сразу тормозит телефоны
    $$('.r-card', strip).forEach((el, i) => {
      if (i === winIdx) el.classList.add('win');
      else if (Math.abs(i - winIdx) <= 7) el.classList.add('faded');
    });
  }

  const RAR_ORDER = ['common', 'rare', 'epic', 'legendary', 'og'];
  const bestRarity = (items) => items.reduce((a, it) => (RAR_ORDER.indexOf(it.rarity) > RAR_ORDER.indexOf(a) ? it.rarity : a), 'common');

  async function renderCase(id) {
    const t = state.render;
    view.innerHTML = '<div class="skeleton"></div>';
    let cs;
    try {
      cs = await api('/api/cases/' + id);
    } catch (e) {
      view.innerHTML = '<a class="back" href="#/">‹ Все кейсы</a><div class="empty">Кейс не найден</div>';
      return fail(e);
    }
    if (stale(t)) return;
    view.innerHTML = `
      <a class="back" href="#/">‹ Все кейсы</a>
      <div class="case-head">
        <img src="${esc(cs.image || '/img/chest.svg')}" alt="">
        <div><h1>${esc(cs.name)}</h1><div class="muted">${cs.freeKind ? 'Бесплатно, раз в сутки' : `${cs.items.length} ${plural(cs.items.length, 'бреинрот', 'бреинрота', 'бреинротов')} внутри`}</div></div>
      </div>
      <div id="strips"></div>
      <div class="case-ctrl">
        ${cs.freeKind ? '<span></span>' : `<div class="count-seg" id="countSeg" role="group" aria-label="Сколько кейсов открыть">${[1, 3, 5].map((n) => `<button data-n="${n}" class="${prefs.count === n ? 'on' : ''}">×${n}</button>`).join('')}</div>`}
        ${speedSoundHtml()}
      </div>
      ${cs.freeKind ? '<div class="free-box hidden" id="freeBox"></div>' : ''}
      <button class="btn open-btn" id="open"></button>
      <h2>Что внутри</h2>
      <div class="items">${cs.items.map((i) => itemCard(i)).join('')}</div>`;
    const drawStrips = () => {
      const cnt = openCount(cs);
      $('#strips').innerHTML = Array.from({ length: cnt }, (_, k) => `<div class="roulette ${cnt > 1 ? 'multi' : ''} n${cnt}"><div class="marker"></div><div class="strip" data-k="${k}"></div></div>`).join('');
      $$('#strips .strip').forEach((st) => idleStrip(st, cs.items));
    };
    drawStrips();
    bindSpeedSound(view);
    const btn = $('#open');
    // Бесплатный кейс: условие (подписка / тег) и таймер до следующего открытия
    let free = null;
    const loadFree = async (check = false) => {
      try {
        free = await api(`/api/cases/${cs.id}/free${check ? '?check=1' : ''}`);
      } catch (e) {
        if (check) fail(e);
      }
      if (!stale(t)) update();
      return free;
    };
    const freeEvery = (f) => (!f.hours || f.hours === 24 ? 'раз в сутки' : `раз в ${f.hours} ч`);
    const drawFree = () => {
      const box = $('#freeBox');
      if (!box) return;
      const show = free && !free.nextAt && (!free.ok || free.broken || free.needDeposit);
      box.classList.toggle('hidden', !show);
      if (!show) return void (box.innerHTML = '');
      const sig = JSON.stringify(free);
      if (box.dataset.sig === sig) return;
      box.dataset.sig = sig;
      if (free.broken) return void (box.innerHTML = '<p>Кейс скоро заработает — загляни чуть позже</p>');
      if (free.needDeposit) {
        box.innerHTML = `<p>Бесплатные кейсы — для тех, кто пополнил баланс от <b>${fmt(free.needDeposit.min)} BG</b>. Ты пополнил: ${fmt(free.needDeposit.have)} BG</p><button class="btn ghost" id="freeDep">Пополнить</button>`;
        $('#freeDep', box).onclick = () => openDeposit();
        return;
      }
      if (free.kind === 'channel') {
        box.innerHTML = `<p>Подпишись на наш канал${free.channel?.title ? ` <b>${esc(free.channel.title)}</b>` : ''} — и открывай этот кейс бесплатно ${freeEvery(free)}</p>
          ${free.channel?.url ? '<button class="btn ghost" id="freeGo">Подписаться</button>' : ''}`;
        const go = $('#freeGo', box);
        if (go) go.onclick = () => { try { TG?.openTelegramLink ? TG.openTelegramLink(free.channel.url) : window.open(free.channel.url, '_blank'); } catch { window.open(free.channel.url, '_blank'); } };
      } else {
        box.innerHTML = `<p>Добавь <b>${esc(free.tag)}</b> в своё имя в Telegram — и открывай этот кейс бесплатно ${freeEvery(free)}</p>
          <div class="free-tag-row"><code>${esc(free.tag)}</code><button class="btn ghost" id="freeCopy">Скопировать</button></div>
          <p class="muted">Настройки Telegram → нажми на своё имя → впиши в имя или фамилию. Уберёшь тег — кейс снова закроется</p>`;
        $('#freeCopy', box).onclick = () => copy(free.tag, 'Скопировано');
      }
    };
    const update = () => {
      const n = openCount(cs);
      const enough = (state.me?.balance ?? 0) >= cs.price * n;
      $$('#countSeg button').forEach((b) => (b.disabled = state.busy));
      // Пока крутится — на месте кнопки «Открыть» кнопка «Пропустить»
      if (state.busy && state.skip) {
        btn.classList.add('skip');
        btn.disabled = state.skip.used;
        btn.innerHTML = state.skip.used ? 'Останавливаю…' : `${SKIP_ICON}<span>Пропустить</span>`;
        btn.onclick = () => { state.skip?.fire(); update(); };
        return;
      }
      btn.classList.remove('skip');
      btn.disabled = state.busy;
      if (cs.freeKind) {
        drawFree();
        const left = free?.nextAt ? new Date(free.nextAt) - Date.now() : 0;
        if (!free) { btn.disabled = true; btn.textContent = 'Проверяю…'; return; }
        if (left > 0) { btn.disabled = true; btn.innerHTML = `Следующий через <span class="mono">${hms(left)}</span>`; return; }
        if (free.nextAt) { free.nextAt = null; loadFree(); }
        if (free.broken) { btn.disabled = true; btn.textContent = 'Скоро'; return; }
        if (free.needDeposit) { btn.disabled = false; btn.textContent = 'Пополнить баланс'; btn.onclick = () => openDeposit(); return; }
        if (!free.ok) {
          btn.textContent = free.kind === 'channel' ? 'Я подписался — проверить' : 'Я добавил — проверить';
          btn.onclick = async () => {
            btn.disabled = true;
            const r = await loadFree(true);
            if (r && !r.ok && !r.broken) toast(r.kind === 'channel' ? 'Подписка пока не видна — подпишись и нажми ещё раз' : 'Тег в имени пока не виден — добавь и нажми ещё раз');
          };
          return;
        }
        btn.textContent = 'Открыть бесплатно';
        btn.onclick = () => openFlow(cs, update);
        return;
      }
      btn.innerHTML = enough ? `Открыть${n > 1 ? ` ${n} шт.` : ''} за ${price(cs.price * n)}` : 'Пополнить баланс';
      btn.onclick = enough ? () => openFlow(cs, update) : () => openDeposit();
    };
    $$('#countSeg button').forEach((b) => (b.onclick = () => {
      if (state.busy) return;
      prefs.count = Number(b.dataset.n);
      savePrefs();
      $$('#countSeg button').forEach((x) => x.classList.toggle('on', x === b));
      tick();
      drawStrips();
      update();
    }));
    update();
    state.caseUpdate = update;
    if (cs.freeKind) {
      update.reloadFree = () => loadFree();
      loadFree();
      every(1000, () => free?.nextAt && !state.busy && update());
    }
  }

  // Бесплатный кейс открывается по одному
  const openCount = (cs) => (cs.freeKind ? 1 : prefs.count);

  async function openFlow(cs, update) {
    if (state.busy) return;
    const n = openCount(cs);
    state.busy = true;
    update();
    lockNav(true);
    try {
      const r = await api(`/api/cases/${cs.id}/open`, { method: 'POST', body: { key: newKey(), count: n } });
      setBalance(r.balance);
      const strips = $$('#strips .strip');
      sfx.start();
      // Ленты стартуют вместе и останавливаются по очереди; щёлкает только первая, чтобы звук не был кашей
      const delays = r.drops.map((d, k) => k * (prefs.fast ? (n > 3 ? 120 : 180) : n > 3 ? 280 : 420));
      // Выпал OG: за пару секунд до остановки экран начинает трястись, на остановке — взрыв
      const ogK = r.drops.map((d, k) => (d.item.rarity === 'og' ? k : -1)).filter((k) => k >= 0).pop();
      const ogDone = ogK != null ? ogFx.arm((reduced ? 700 : (prefs.fast ? SPIN.fast : SPIN.normal).dur + delays[ogK]), strips[ogK].parentElement) : null;
      // Кнопка «Пропустить»: ленты сразу доезжают, а если выпал OG — взрыв всё равно будет, как только они встанут
      const skip = makeSkip();
      if (ogDone) skip.add(() => ogFx.rush(480));
      state.skip = skip;
      update();
      await Promise.all(r.drops.map((d, k) => spinStrip(strips[k], cs.items, d.item, { delay: delays[k], sound: k === 0, skip })));
      state.skip = null;
      if (ogDone) await ogDone;
      lockNav(false);
      if (!ogDone) {
        haptic('success');
        sfx.win(bestRarity(r.drops.map((d) => d.item)));
      }
      showDrop(cs, r, update);
      setTimeout(() => liveTick(true), 400); // свой дроп сразу появляется в ленте слева (на компьютере)
    } catch (e) {
      ogFx.clear();
      fail(e);
    } finally {
      state.skip = null;
      lockNav(false);
      state.busy = false;
      if (cs.freeKind) update.reloadFree?.();
      update();
    }
  }

  function showDrop(cs, r, update) {
    const drops = r.drops || [r];
    const n = drops.length;
    const total = drops.reduce((a, d) => a + d.item.price, 0);
    // Монеты уже на балансе — продавать и апгрейдить можно только бреинротов
    const items = drops.filter((d) => !d.item.coins);
    const coins = drops.reduce((a, d) => a + (d.item.coins ? d.item.price : 0), 0);
    const sellSum = items.reduce((a, d) => a + d.item.price, 0);
    const again = openCount(cs);
    const enough = state.me.balance >= cs.price * again;
    const body = h(`
      <div>
        <div class="result-row n${n}">${drops.map((d) => `
          <div class="result-card shine rar-${esc(d.item.rarity)}">${ogTag(d.item)}
            <img src="${itemImg(d.item.image)}" alt="">
            <b>${esc(d.item.name)}</b>
            ${price(d.item.price)}
          </div>`).join('')}
        </div>
        ${n > 1 ? `<div class="result-total"><span>Всего выпало на</span>${price(total)}</div>` : ''}
        ${coins ? `<div class="result-total coins-got"><span>Зачислено на баланс</span>${price(coins)}</div>` : ''}
        ${items.length ? `<div class="btn-row" style="margin-top:18px">
          <button class="btn ghost" data-a="sell">Продать за ${price(sellSum)}</button>
          <button class="btn ghost" data-a="upgrade">Апгрейд</button>
        </div>` : ''}
        <button class="btn" data-a="again" style="margin-top:${items.length ? 8 : 18}px">${cs.freeKind ? 'Готово' : enough ? `Открыть ещё${again > 1 ? ` ${again} шт.` : ''} за ${price(cs.price * again)}` : 'Пополнить баланс'}</button>
      </div>`);
    const s = openSheet(n > 1 ? `Тебе выпало ${n} ${plural(n, 'бреинрот', 'бреинрота', 'бреинротов')}` : 'Тебе выпало', body);
    const sellBtn = $('[data-a=sell]', body);
    if (sellBtn) sellBtn.onclick = async (ev) => {
      ev = { currentTarget: ev.currentTarget }; // после await у события пропадает currentTarget
      ev.currentTarget.disabled = true;
      try {
        const res = await api('/api/inventory/sell', { method: 'POST', body: { ids: items.map((d) => d.inventoryId), key: newKey() } });
        setBalance(res.balance);
        toast(`Продано за ${fmt(res.total)} BG`);
        s.close();
        update();
      } catch (e) {
        ev.currentTarget.disabled = false;
        fail(e);
      }
    };
    const upBtn = $('[data-a=upgrade]', body);
    if (upBtn) upBtn.onclick = () => {
      s.close();
      // Один дроп — сразу в ставку; несколько — просто открываем апгрейдер, игрок выберет сам
      location.hash = items.length === 1 ? `#/upgrade?item=${items[0].inventoryId}` : '#/upgrade';
    };
    $('[data-a=again]', body).onclick = () => {
      s.close();
      if (cs.freeKind) return update();
      if (enough) openFlow(cs, update);
      else openDeposit();
    };
  }

  // =====================================================================
  //                              АПГРЕЙДЕР
  // =====================================================================
  const R = 110;
  const C = 2 * Math.PI * R;
  const up = { selected: [], target: null, preset: 'x2', data: null, tab: 'mine', angle: 0, spinning: false, inv: [] };

  const riskColor = (ch) => (ch >= 45 ? 'var(--crystal)' : ch >= 25 ? 'var(--amber)' : 'var(--ember)');

  async function renderUpgrade(qs) {
    const t = state.render;
    const pre = (qs.get('items') || qs.get('item') || '').split(',').map(Number).filter((x) => Number.isSafeInteger(x) && x > 0);
    up.spinning = false; // если прошлый апгрейд прервали уходом со страницы — не зависаем
    up.selected = pre.length ? pre.slice(0, state.cfg.upgrade.maxItems) : up.selected;
    up.target = null;
    up.data = null;
    up.preset = 'x2';
    const ticks = Array.from({ length: 24 }, (_, i) => {
      const a = (i * 15 * Math.PI) / 180;
      const r1 = i % 6 === 0 ? 124 : 126;
      return `<line x1="${130 + Math.sin(a) * r1}" y1="${130 - Math.cos(a) * r1}" x2="${130 + Math.sin(a) * 129}" y2="${130 - Math.cos(a) * 129}"/>`;
    }).join('');
    view.innerHTML = `
      <div class="up-wrap"><div class="up-left">
      <div class="ring-wrap">
        <svg viewBox="0 0 260 260" aria-hidden="true">
          <g class="ring-ticks">${ticks}</g>
          <circle class="ring-track" cx="130" cy="130" r="${R}"/>
          <circle class="ring-arc" id="arc" cx="130" cy="130" r="${R}" transform="rotate(-90 130 130)" stroke-dasharray="0 ${C}"/>
        </svg>
        <div class="pointer" id="pointer"></div>
        <div class="ring-center" id="rc"><div class="pct" id="pct">0%</div><div class="lbl" id="rlbl">шанс</div></div>
      </div>
      <div class="slots">
        <div class="slot" id="slotIn"></div>
        <div class="arrow-between">›</div>
        <div class="slot" id="slotOut"></div>
      </div>
      <div class="mults" id="mults"></div>
      <div class="up-ctrl">${speedSoundHtml()}</div>
      <button class="btn" id="go" disabled>Апгрейд</button>
      </div>
      <div class="up-right">
      <div class="seg" id="upSeg">
        <button data-t="mine">Мои бреинроты</button>
        <button data-t="targets">Цели</button>
      </div>
      <div id="upList"></div>
      </div></div>`;
    $('#pointer').style.transform = `rotate(${up.angle % 360}deg)`;
    up.angle = up.angle % 360;
    $$('#upSeg button').forEach((b) => (b.onclick = () => { up.tab = b.dataset.t; drawUpList(); }));
    $('#go').onclick = runUpgrade;
    bindSpeedSound(view);
    try {
      up.inv = (await api('/api/inventory')).filter((i) => i.status === 'owned');
    } catch (e) {
      return fail(e);
    }
    if (stale(t)) return;
    up.selected = up.selected.filter((id) => up.inv.some((i) => i.id === id));
    up.tab = up.selected.length ? 'targets' : 'mine';
    if (up.selected.length) await loadTargets();
    drawUpgrade();
  }

  async function loadTargets() {
    up.data = null;
    up.target = null;
    if (!up.selected.length) return;
    try {
      up.data = await api('/api/upgrade/targets', { method: 'POST', body: { ids: up.selected } });
      const p = up.data.presets.find((x) => x.label === up.preset && x.target) || up.data.presets.find((x) => x.target);
      up.preset = p ? p.label : null;
      up.target = p ? p.target : null;
    } catch (e) {
      fail(e);
    }
  }

  function drawUpgrade() {
    const cfg = state.cfg.upgrade;
    const chance = up.target ? up.target.chance : 0;
    const arc = $('#arc');
    if (!arc) return;
    arc.setAttribute('stroke-dasharray', `${(C * chance) / 100} ${C}`);
    arc.style.stroke = riskColor(chance);
    $('#pct').textContent = `${fmt(chance)}%`;
    $('#rlbl').textContent = up.target ? 'шанс' : 'выбери бреинрота';

    const chosen = up.inv.filter((i) => up.selected.includes(i.id));
    const sum = chosen.reduce((a, i) => a + i.item.price, 0);
    const slotIn = $('#slotIn');
    slotIn.classList.toggle('full', chosen.length > 0);
    slotIn.innerHTML = chosen.length
      ? `<div class="imgs ${chosen.length === 1 ? 'one' : ''}">${chosen.map((i) => `<img src="${itemImg(i.item.image)}" alt="">`).join('')}</div>
         <div>${chosen.length === 1 ? esc(chosen[0].item.name) : `${chosen.length} бреинрота`}</div>${price(sum)}`
      : `<div class="t">Твоя ставка</div><div class="t">выбери до ${cfg.maxItems} бреинротов снизу</div>`;
    const slotOut = $('#slotOut');
    slotOut.classList.toggle('full', !!up.target);
    slotOut.innerHTML = up.target
      ? `<div class="imgs one"><img src="${itemImg(up.target.image)}" alt=""></div><div>${esc(up.target.name)}</div>${price(up.target.price)}`
      : `<div class="t">Цель</div><div class="t">${chosen.length ? 'нет подходящих целей' : 'появится после выбора ставки'}</div>`;

    const presets = up.data?.presets || cfg.presets.map((p) => ({ ...p, target: null }));
    $('#mults').innerHTML = presets
      .map((p) => `<button class="chip ${up.preset === p.label && up.target ? 'on' : ''}" data-p="${p.label}" ${p.target ? '' : 'disabled'}>${p.label} <small>${fmt(p.chance)}%</small></button>`)
      .join('');
    $$('#mults .chip').forEach((b) => {
      b.onclick = () => {
        const p = up.data?.presets.find((x) => x.label === b.dataset.p);
        if (!p?.target || up.spinning) return;
        up.preset = p.label;
        up.target = p.target;
        tick();
        drawUpgrade();
      };
    });
    $('#go').disabled = !up.target || up.spinning;
    $$('#upSeg button').forEach((b) => b.classList.toggle('on', b.dataset.t === up.tab));
    drawUpList();
  }

  function drawUpList() {
    const box = $('#upList');
    if (!box) return;
    $$('#upSeg button').forEach((b) => b.classList.toggle('on', b.dataset.t === up.tab));
    const max = state.cfg.upgrade.maxItems;
    if (up.tab === 'mine') {
      if (!up.inv.length) {
        box.innerHTML = '<div class="empty">Пока нечего апгрейдить. Открой кейс, и бреинрот появится здесь<a class="btn" href="#/">К кейсам</a></div>';
        return;
      }
      box.innerHTML = `<div class="items">${up.inv
        .map((i) => {
          const sel = up.selected.includes(i.id);
          const full = !sel && up.selected.length >= max;
          return `<button class="item rar-${esc(i.item.rarity)} ${sel ? 'sel' : ''} ${full ? 'dim' : ''}" data-id="${i.id}">${ogTag(i.item)}<img loading="lazy" src="${itemImg(i.item.image)}" alt=""><div class="n">${esc(i.item.name)}</div>${price(i.item.price)}</button>`;
        })
        .join('')}</div>`;
      $$('.item', box).forEach((b) => {
        b.onclick = async () => {
          if (up.spinning) return;
          const id = Number(b.dataset.id);
          if (up.selected.includes(id)) up.selected = up.selected.filter((x) => x !== id);
          else if (up.selected.length < max) up.selected.push(id);
          else return toast(`Можно поставить до ${max} бреинротов`, 'err', 3000);
          tick();
          await loadTargets();
          drawUpgrade();
        };
      });
      return;
    }
    const targets = up.data?.targets || [];
    if (!up.selected.length) {
      box.innerHTML = '<div class="empty">Сначала выбери свою ставку во вкладке «Мои бреинроты»</div>';
      return;
    }
    if (!targets.length) {
      box.innerHTML = `<div class="empty">Нет бреинротов с шансом от ${state.cfg.upgrade.minChance}% до ${state.cfg.upgrade.maxChance}%. Измени ставку</div>`;
      return;
    }
    box.innerHTML = `<div class="items">${targets
      .map(
        (it) => `<button class="item rar-${esc(it.rarity)} ${up.target?.id === it.id ? 'sel' : ''}" data-id="${it.id}">${ogTag(it)}<img loading="lazy" src="${itemImg(it.image)}" alt=""><div class="n">${esc(it.name)}</div>${price(it.price)}<small class="muted">${fmt(it.chance)}%</small></button>`,
      )
      .join('')}</div>`;
    $$('.item', box).forEach((b) => {
      b.onclick = () => {
        if (up.spinning) return;
        up.target = targets.find((x) => x.id === Number(b.dataset.id));
        up.preset = up.data.presets.find((p) => p.target?.id === up.target.id)?.label || null;
        tick();
        drawUpgrade();
      };
    });
  }

  async function runUpgrade() {
    if (!up.target || up.spinning) return;
    const t = state.render;
    up.spinning = true;
    drawUpgrade();
    const rc = $('#rc');
    rc.classList.remove('won', 'lost');
    lockNav(true);
    let r;
    try {
      r = await api('/api/upgrade', { method: 'POST', body: { ids: up.selected, targetId: up.target.id, key: newKey() } });
    } catch (e) {
      lockNav(false);
      up.spinning = false;
      drawUpgrade();
      return fail(e);
    }
    try {
      // Стрелка делает несколько оборотов и останавливается на числе, которое выпало на сервере.
      // Зелёная дуга — это зона выигрыша от 0 до шанса по часовой стрелке.
      const fast = prefs.fast;
      const dur = reduced ? 600 : fast ? 2200 : 7800;
      const target = up.angle - (up.angle % 360) + 360 * (fast ? 3 : 11) + (r.roll / 100) * 360;
      const ptr = $('#pointer');
      ptr.style.transition = `transform ${dur}ms cubic-bezier(0.06, 0.8, 0.05, 1)`;
      ptr.style.transform = `rotate(${target}deg)`;
      up.angle = target;
      sfx.start();
      // Щелчок на каждом делении шкалы (каждые 15°)
      const until = performance.now() + dur;
      let lastSeg = null;
      const follow = () => {
        if (performance.now() > until || !ptr.isConnected) return;
        const m = new DOMMatrixReadOnly(getComputedStyle(ptr).transform);
        const deg = ((Math.atan2(m.b, m.a) * 180) / Math.PI + 360) % 360;
        const seg = Math.floor(deg / 15);
        if (lastSeg !== null && seg !== lastSeg) sfx.tick(0.9);
        lastSeg = seg;
        requestAnimationFrame(follow);
      };
      requestAnimationFrame(follow);
      await sleep(dur + 80);
      lockNav(false);
      if (stale(t)) return;
      rc.classList.add(r.won ? 'won' : 'lost');
      $('#rlbl').textContent = r.won ? 'Победа' : 'Проигрыш';
      if (r.won && r.target?.rarity === 'og') ogFx.boom($('.ring-wrap'));
      else if (r.won) sfx.upWin();
      else sfx.upLose();
      haptic(r.won ? 'success' : 'error');
      if (r.won) toast(`Апгрейд удался! ${r.target.name} уже в инвентаре`);
      await sleep(fast ? 1100 : 2200);
      if (stale(t)) return;
      rc.classList.remove('won', 'lost');
      ptr.style.transition = 'none';
      up.selected = r.won && r.inventoryId ? [r.inventoryId] : [];
      up.spinning = false;
      try {
        up.inv = (await api('/api/inventory')).filter((i) => i.status === 'owned');
      } catch {}
      if (stale(t)) return;
      up.tab = up.selected.length ? 'targets' : 'mine';
      await loadTargets();
      if (!stale(t)) drawUpgrade();
    } finally {
      lockNav(false);
      // Ушли со страницы — следующий экран апгрейда начнёт с чистого листа
      if (stale(t)) {
        up.spinning = false;
        up.selected = r.won && r.inventoryId ? [r.inventoryId] : [];
      }
    }
  }

  // =====================================================================
  //                               МИСТЕРИ
  // =====================================================================
  // Кладёшь одного бреинрота → он превращается в случайного другого (от 1/N до N× стоимости).
  // Результат решает сервер; анимация — только показ. Победы/поражения не пишем: просто открываем, что выпало.
  const mys = { inv: [], sel: null, info: null, busy: false };
  const SPARKS = Array.from({ length: 16 }, (_, i) => `<b style="--x:${(i * 37) % 100}%;--d:${((i * 0.53) % 3.2).toFixed(2)}s;--s:${3 + (i % 3)}px"></b>`).join('');
  const multLabel = () => fmt(state.cfg.mystery?.mult || 3);

  async function renderMystery(qs) {
    const t = state.render;
    const cfg = state.cfg.mystery || { enabled: false };
    mys.busy = false;
    mys.info = null;
    const pre = Number(qs.get('item'));
    mys.sel = Number.isSafeInteger(pre) && pre > 0 ? pre : mys.sel;
    view.innerHTML = `
      <div class="mys-wrap"><div class="mys-left">
      <section class="mys-stage" id="mysStage">
        <div class="mys-rings" aria-hidden="true"><i></i><i></i><i></i></div>
        <div class="mys-sparks" aria-hidden="true">${SPARKS}</div>
        <div class="mys-core" id="mysCore"><div class="mys-q" aria-hidden="true">?</div><img class="mys-img hidden" id="mysImg" alt=""></div>
        <div class="mys-flash" aria-hidden="true"></div>
      </section>
      <div class="mys-cap" id="mysCap"></div>
      <div class="mys-range" id="mysRange"></div>
      <div id="mysAfter"></div>
      <div class="up-ctrl">${speedSoundHtml()}</div>
      <button class="btn mys-go" id="mysGo" disabled><span class="mys-go-q" aria-hidden="true">?</span> Мистери</button>
      <p class="hint center mys-about">Твой бреинрот превратится в случайного другого — стоимостью от ⅓ до ${multLabel()}× от своей. <button class="link-btn" id="mysHelp">Как это работает</button></p>
      </div>
      <div class="mys-right">
      <div id="mysPool"></div>
      <div class="section-head"><h2>Твои бреинроты</h2></div>
      <div id="mysList"><div class="skeleton" style="height:120px"></div></div>
      </div></div>`;
    bindSpeedSound(view);
    $('#mysHelp').onclick = mysHelp;
    $('#mysGo').onclick = playMys;
    if (!cfg.enabled) {
      $('#mysCap').innerHTML = '<b>Мистери скоро вернётся</b>';
      $('#mysList').innerHTML = '';
      return;
    }
    try {
      mys.inv = (await api('/api/inventory')).filter((i) => i.status === 'owned');
    } catch (e) {
      return fail(e);
    }
    if (stale(t)) return;
    if (mys.sel && !mys.inv.some((i) => i.id === mys.sel)) mys.sel = null;
    drawMysList();
    await selectMys(mys.sel);
  }

  const mysFits = (price) => {
    const c = state.cfg.mystery;
    return price >= c.minInput && price <= c.maxInput;
  };

  function drawMysList() {
    const box = $('#mysList');
    if (!box) return;
    if (!mys.inv.length) {
      box.innerHTML = '<div class="empty">Пока нечего положить. Открой кейс, и бреинрот появится здесь<a class="btn" href="#/">К кейсам</a></div>';
      return;
    }
    // Подходящие — сначала, по цене; неподходящие (слишком дорогие или дешёвые) — тусклые в конце
    const list = [...mys.inv].sort((a, b) => (mysFits(b.item.price) - mysFits(a.item.price)) || b.item.price - a.item.price);
    box.innerHTML = `<div class="items">${list
      .map((i) => `<button class="item rar-${esc(i.item.rarity)} ${mys.sel === i.id ? 'sel' : ''} ${mysFits(i.item.price) ? '' : 'dim'}" data-id="${i.id}">${ogTag(i.item)}<img loading="lazy" src="${itemImg(i.item.image)}" alt=""><div class="n">${esc(i.item.name)}</div>${price(i.item.price)}</button>`)
      .join('')}</div>`;
    $$('.item', box).forEach((b) => (b.onclick = () => {
      if (mys.busy) return;
      const id = Number(b.dataset.id);
      tick();
      selectMys(mys.sel === id ? null : id);
    }));
  }

  async function selectMys(id) {
    mys.sel = id || null;
    mys.info = null;
    $('#mysAfter').innerHTML = '';
    $('#mysGo').innerHTML = '<span class="mys-go-q" aria-hidden="true">?</span> Мистери';
    $('#mysStage')?.classList.remove('revealed');
    $$('#mysList .item').forEach((b) => b.classList.toggle('sel', Number(b.dataset.id) === mys.sel));
    const it = mys.inv.find((i) => i.id === mys.sel);
    showMysItem(it?.item || null);
    $('#mysRange').innerHTML = '';
    $('#mysPool').innerHTML = '';
    $('#mysGo').disabled = true;
    if (!it) return;
    try {
      const info = await api('/api/mystery/info', { method: 'POST', body: { id: it.id } });
      if (mys.sel !== it.id) return;
      mys.info = info;
      if (info.ok) {
        $('#mysRange').innerHTML = `<span>Может выпасть</span> от ${price(info.min)} до ${price(info.max)}`;
        drawMysPool(info.items);
        $('#mysGo').disabled = false;
      } else {
        $('#mysRange').innerHTML = `<span class="warn-t">${esc(info.reason)}</span>`;
      }
    } catch (e) {
      fail(e);
    }
  }

  // Витрина «Что может выпасть» для выбранного бреинрота — как «Что внутри» у кейса
  function drawMysPool(items) {
    const box = $('#mysPool');
    if (!box) return;
    if (!items?.length) { box.innerHTML = ''; return; }
    // Сначала 6 самых дорогих, остальные — по кнопке, чтобы список своих бреинротов не уезжал далеко вниз
    const SHOW = 6;
    const draw = (all) => {
      const list = all ? items : items.slice(0, SHOW);
      box.innerHTML = `<div class="section-head"><h2>Что может выпасть</h2><span class="muted">${items.length} ${plural(items.length, 'бреинрот', 'бреинрота', 'бреинротов')}</span></div>
        <div class="items mys-pool">${list.map((i) => itemCard(i)).join('')}</div>
        ${items.length > SHOW ? `<button class="btn ghost small" id="mysPoolMore" style="margin-top:8px">${all ? 'Свернуть' : `Показать все ${items.length}`}</button>` : ''}`;
      const more = $('#mysPoolMore', box);
      if (more) more.onclick = () => { tick(); draw(!all); };
    };
    draw(false);
  }

  function showMysItem(item, { result = false } = {}) {
    const img = $('#mysImg');
    const core = $('#mysCore');
    if (!img) return;
    core.className = `mys-core ${item ? 'has' : ''} ${item ? 'rar-' + esc(item.rarity) : ''}`;
    if (item) {
      img.src = itemImg(item.image);
      img.classList.remove('hidden');
      $('#mysCap').innerHTML = `<b>${esc(item.name)}</b>${price(item.price)}`;
    } else {
      img.classList.add('hidden');
      img.removeAttribute('src');
      $('#mysCap').innerHTML = '<span class="muted">Выбери бреинрота снизу</span>';
    }
    if (result) core.classList.add('result');
  }

  function mysHelp() {
    const m = multLabel();
    openSheet('Как работает мистери', h(`
      <div class="mys-help">
        <p>1. Выбери одного своего бреинрота и нажми «Мистери».</p>
        <p>2. Он превратится в случайного другого бреинрота стоимостью <b>от ⅓ до ${m}×</b> от своей. Например, бреинрот за 150 BG может стать бреинротом от ${fmt(Math.round(150 / (state.cfg.mystery?.mult || 3)))} до ${fmt(Math.round(150 * (state.cfg.mystery?.mult || 3)))} BG.</p>
        <p>3. Какой выпадет — решает сервер в момент нажатия, анимация лишь показывает результат.</p>
        <p>Положить можно бреинрота стоимостью ${state.cfg.mystery?.floor ? `от ${fmt(state.cfg.mystery.floor)} ` : ''}${state.cfg.mystery?.cap ? `до ${fmt(state.cfg.mystery.cap)} BG` : 'BG'}.</p>
      </div>`));
  }

  async function playMys() {
    if (mys.busy || !mys.sel || !mys.info?.ok) return;
    const fast = prefs.fast;
    const stage = $('#mysStage');
    const go = $('#mysGo');
    const inputId = mys.sel;
    mys.busy = true;
    go.disabled = true;
    $('#mysAfter').innerHTML = '';
    lockNav(true);
    sfx.unlock();
    // Зарядка начинается сразу, параллельно с запросом
    stage.classList.remove('revealed');
    stage.classList.add('charging');
    const charge = fast ? 500 : 1300;
    sfx.charge(charge / 1000);
    try { TG?.HapticFeedback?.impactOccurred('light'); } catch {}
    const t0 = performance.now();
    let r;
    try {
      r = await api('/api/mystery', { method: 'POST', body: { id: inputId, key: newKey() } });
    } catch (e) {
      stage.classList.remove('charging');
      mys.busy = false;
      lockNav(false);
      go.disabled = false;
      return fail(e);
    }
    await sleep(Math.max(0, charge - (performance.now() - t0)));
    // Перебор: картинки мелькают всё медленнее
    stage.classList.remove('charging');
    stage.classList.add('shuffling');
    const frames = [...r.shuffle];
    const steps = fast ? 9 : 22;
    const img = $('#mysImg');
    $('#mysCap').innerHTML = '<span class="mys-dots">?  ?  ?</span>';
    const gaps = Array.from({ length: steps }, (_, i) => (fast ? 40 : 55) + Math.pow(i / steps, 2.2) * (fast ? 170 : 430));
    const isOg = r.item.rarity === 'og';
    let left = gaps.reduce((a, b) => a + b, 0);
    const lead = Math.min(3000, left * 0.6);
    let built = false;
    for (let i = 0; i < steps; i++) {
      // Выпадет OG: последние ~3 секунды перебора экран трясётся всё сильнее
      if (isOg && !built && left <= lead) {
        built = true;
        ogFx.build(left / 1000, stage);
      }
      img.src = itemImg(frames[i % frames.length]);
      img.classList.remove('hidden');
      sfx.chime(i / steps);
      if (i % 3 === 0) tick();
      await sleep(gaps[i]);
      left -= gaps[i];
    }
    // Вспышка — и результат
    stage.classList.remove('shuffling');
    stage.classList.add('revealed');
    showMysItem(r.item, { result: true });
    if (isOg) ogFx.boom(stage);
    else sfx.win(r.item.rarity);
    try { TG?.HapticFeedback?.impactOccurred('heavy'); } catch {}
    // Обновляем список: старого бреинрота нет, новый — выбран
    mys.inv = mys.inv.filter((i) => i.id !== inputId);
    mys.inv.unshift({ id: r.inventoryId, status: 'owned', item: r.item });
    mys.sel = r.inventoryId;
    drawMysList();
    $('#mysRange').innerHTML = '';
    $('#mysPool').innerHTML = '';
    $('#mysAfter').innerHTML = `
      <div class="btn-row">
        <button class="btn ghost" data-a="sell">Продать за ${price(r.item.price)}</button>
        <button class="btn ghost" data-a="upgrade">Апгрейд</button>
      </div>`;
    $('[data-a=upgrade]', $('#mysAfter')).onclick = () => (location.hash = `#/upgrade?item=${r.inventoryId}`);
    $('[data-a=sell]', $('#mysAfter')).onclick = async (ev) => {
      const b = ev.currentTarget;
      if (b.disabled) return;
      b.disabled = true;
      try {
        const s = await api('/api/inventory/sell', { method: 'POST', body: { ids: [r.inventoryId], key: newKey() } });
        setBalance(s.balance);
        haptic('success');
        toast(`Продано за ${fmt(r.item.price)} BG`);
        mys.inv = mys.inv.filter((i) => i.id !== r.inventoryId);
        drawMysList();
        selectMys(null);
      } catch (e) {
        b.disabled = false;
        fail(e);
      }
    };
    mys.busy = false;
    lockNav(false);
    // Можно сразу ещё раз — уже с новым бреинротом
    try {
      const info = await api('/api/mystery/info', { method: 'POST', body: { id: r.inventoryId } });
      if (mys.sel !== r.inventoryId) return;
      mys.info = info;
      if (info.ok) {
        $('#mysRange').innerHTML = `<span>Может выпасть</span> от ${price(info.min)} до ${price(info.max)}`;
        drawMysPool(info.items);
      }
      go.disabled = !info.ok;
      go.innerHTML = info.ok ? '<span class="mys-go-q" aria-hidden="true">?</span> Ещё раз' : '<span class="mys-go-q" aria-hidden="true">?</span> Мистери';
    } catch {}
  }

  // =====================================================================
  //                               ПРОФИЛЬ
  // =====================================================================
  async function renderProfile() {
    const t = state.render;
    view.innerHTML = '<div class="skeleton"></div>';
    let me, inv, wd;
    try {
      [me, inv, wd] = await Promise.all([refreshMe(), api('/api/inventory'), api('/api/withdraw')]);
    } catch (e) {
      return fail(e);
    }
    if (stale(t)) return;
    const name = me.firstName || me.username || 'Игрок';
    view.innerHTML = `
      <div class="prof-wrap"><div class="prof-left">
      <section class="panel">
        <div class="me">
          <div class="avatar" id="bigAva"></div>
          <div class="who">
            <b>${esc(name)}</b>
            <div class="muted">${me.username ? '@' + esc(me.username) : ''}</div>
            <button class="idline" id="copyId">ID ${me.id}</button>
          </div>
        </div>
        <div class="bal-row">
          <div class="bal-big">${COIN}${fmt(me.balance)}</div>
          <button class="btn small" id="pTopup" style="width:auto;padding:0 18px">Пополнить</button>
        </div>
        <div class="stats">
          <div class="stat"><b>${me.stats.cases}</b><span>кейсов</span></div>
          <div class="stat"><b>${me.stats.upgrades}</b><span>апгрейдов</span></div>
          <div class="stat"><b>${fmt(me.stats.withdrawn)}</b><span>выведено BG</span></div>
        </div>
      </section>

      <a class="panel go-panel" href="#/referrals">
        ${svgIcon('friends')}
        <span class="grow"><b>Рефералы</b><span class="muted">Приглашай друзей и получай долю от их проигрышей</span></span>
        <span class="chev" aria-hidden="true">›</span>
      </a>

      <section class="panel promo-enter">
        <h3>Промокод</h3>
        <div class="reflink"><input id="pCode" maxlength="20" placeholder="Введи промокод" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="btn small" id="pAct">Активировать</button></div>
      </section>
      ${me.isPartner ? '<section class="panel" id="partnerBox"><h3>Мои промокоды</h3><div class="skeleton" style="height:60px"></div></section>' : ''}
      </div>
      <div class="prof-right">
      <div class="section-head"><h2>Инвентарь</h2>${inv.some((i) => i.status === 'owned') ? '<button class="link-btn" id="sellAll">Продать всё</button>' : ''}</div>
      <div id="invBox"></div>
      <div id="wdHistory"></div>
      </div></div>`;
    fillAvatar($('#bigAva'));
    const pAct = async () => {
      const code = $('#pCode').value.trim();
      if (!code) return;
      $('#pAct').disabled = true;
      try {
        const r = await api('/api/promo', { method: 'POST', body: { code } });
        haptic('success');
        if (r.type === 'coins') { setBalance(r.balance); toast(`Промокод активирован: +${fmt(r.reward)} BG`); }
        else toast('Код друга применён: бонус к первому пополнению');
        $('#pCode').value = '';
        refreshMe().catch(() => {});
      } catch (e) { fail(e); }
      $('#pAct').disabled = false;
    };
    $('#pAct').onclick = pAct;
    $('#pCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') pAct(); });
    if (me.isPartner) drawPartnerPromos();
    $('#pTopup').onclick = () => openDeposit();
    $('#copyId').onclick = () => copy(String(me.id), 'ID скопирован');
    const sa = $('#sellAll');
    if (sa) {
      sa.onclick = async () => {
        const owned = inv.filter((i) => i.status === 'owned');
        const sum = owned.reduce((a, i) => a + i.item.price, 0);
        if (!(await confirmBox(`Продать ${owned.length} бреинротов за ${fmt(sum)} BG?`, { ok: 'Продать' }))) return;
        try {
          const r = await api('/api/inventory/sell-all', { method: 'POST', body: { key: newKey() } });
          setBalance(r.balance);
          toast(`Продано за ${fmt(r.total)} BG`);
          renderProfile();
        } catch (e) {
          fail(e);
        }
      };
    }
    drawInventory(inv);
    drawWdHistory(wd);
    // Пока что-то на выводе — обновляем статусы сами
    if (inv.some((i) => i.withdraw)) {
      every(15000, async () => {
        try {
          const fresh = await api('/api/inventory');
          if (!stale(t)) drawInventory(fresh);
        } catch {}
      });
    }
  }

  // =====================================================================
  //                               РЕФЕРАЛЫ
  // =====================================================================
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
  // «в пятницу, 16 октября, в 17:00 МСК» и «Каждую пятницу в 17:00 МСК»
  const WEEKDAY = {
    понедельник: ['в понедельник', 'Каждый понедельник'],
    вторник: ['во вторник', 'Каждый вторник'],
    среда: ['в среду', 'Каждую среду'],
    четверг: ['в четверг', 'Каждый четверг'],
    пятница: ['в пятницу', 'Каждую пятницу'],
    суббота: ['в субботу', 'Каждую субботу'],
    воскресенье: ['в воскресенье', 'Каждое воскресенье'],
  };
  function payoutParts(iso, tz, label) {
    const d = new Date(iso);
    let wd, date, time;
    try {
      wd = d.toLocaleDateString('ru-RU', { weekday: 'long', timeZone: tz });
      date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: tz });
      time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz });
    } catch {
      wd = d.toLocaleDateString('ru-RU', { weekday: 'long' });
      date = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    const [on, every] = WEEKDAY[wd] || [wd, wd];
    return { next: `${on}, ${date}, в ${time} ${label}`, every: `${every} в ${time} ${label}` };
  }
  function refHelp(r) {
    const when = payoutParts(r.nextPayoutAt, r.tz, r.tzLabel);
    const body = h(`<div class="ref-help">
      <p>Каждую неделю ты получаешь <b>${fmt(r.percent)}%</b> от того, сколько проиграли приглашённые тобой друзья: сколько они потратили на кейсы и апгрейды минус стоимость того, что им выпало.</p>
      <p>Засчитывается не больше, чем друг пополнил за эту неделю. Если он играет без пополнений, на доход это не влияет.</p>
      <p>Если друг выиграл, его выигрыш (тоже не больше его пополнений) уменьшает доход. Если за неделю друзья в плюсе, реферальный баланс уходит в минус, и этот минус гасится доходом следующих недель.</p>
      <p>${esc(when.every)} доход за неделю переходит на реферальный баланс. Оттуда его можно перевести на основной баланс в любой момент.</p>
      <button class="btn" id="helpOk">Понятно</button>
    </div>`);
    const sh = openSheet('Как считается доход', body);
    $('#helpOk', body).onclick = () => sh.close();
  }

  async function renderReferrals() {
    const t = state.render;
    view.innerHTML = '<div class="skeleton"></div>';
    let r;
    try {
      r = await api('/api/referrals');
    } catch (e) {
      return fail(e);
    }
    if (stale(t)) return;
    const pre = r.preliminary;
    const neg = r.refBalance < 0;
    view.innerHTML = `
      <h1 class="page-title">Рефералы</h1>

      <section class="panel ref-code">
        <span class="muted">Твой код</span>
        <button class="ref-code-big" id="copyCode" aria-label="Скопировать код">${esc(r.code)}</button>
        <p class="hint">Друг получает <b>+${fmt(r.bonusPercent)}%</b> к первому пополнению. Ты получаешь <b>${fmt(r.percent)}%</b> от его проигрышей каждую неделю.</p>
        ${r.link ? `<div class="reflink"><input id="refLink" readonly value="${esc(r.link)}"><button class="btn small" id="copyRef">Копировать</button></div>
        <button class="btn ghost small" id="shareRef" style="margin-top:8px">Отправить ссылку друзьям</button>` : ''}
        ${!r.isPartner && r.partnerContact ? '<button class="btn ghost small" id="howPartner" style="margin-top:8px">Как стать партнёром?</button>' : ''}
      </section>

      <section class="ref-income">
        <div class="ref-income-head">
          <span>Предварительный доход</span>
          <button class="help" id="refHelp" aria-label="Как считается доход">?</button>
        </div>
        <div class="ref-income-sum ${pre < 0 ? 'neg' : ''}">${COIN}${signed(pre)}</div>
        <span class="ref-income-when">Начислится ${esc(payoutParts(r.nextPayoutAt, r.tz, r.tzLabel).next)}</span>
      </section>

      <section class="panel">
        <span class="muted">Реферальный баланс</span>
        <div class="bal-big ${neg ? 'neg' : ''}">${COIN}${neg ? signed(r.refBalance) : fmt(r.refBalance)}</div>
        ${neg ? '<p class="hint">Друзья выиграли больше, чем проиграли. Этот минус погасится доходом следующих недель, с основного баланса ничего не спишется.</p>' : ''}
        <button class="btn" id="refTransfer" ${r.refBalance > 0 ? '' : 'disabled'}>Перевести на баланс</button>
        <div class="stats two">
          <div class="stat"><b>${r.count}</b><span>${plural(r.count, 'друг', 'друга', 'друзей')}</span></div>
          <div class="stat"><b>${fmt(r.earned)}</b><span>BG заработано</span></div>
        </div>
      </section>

      <h2>Друзья</h2>
      ${r.referrals.length
        ? `<div class="panel ref-list">${r.referrals.map((f) => `<div class="line"><div class="grow"><b>${esc(f.name)}</b><span class="muted">с ${new Date(f.joinedAt).toLocaleDateString('ru-RU')}</span></div>${price(f.earned)}</div>`).join('')}</div>`
        : '<div class="empty">Пока никого. Отправь другу ссылку: когда он зайдёт по ней, он появится здесь</div>'}

      ${r.history.length ? `<h2>История</h2><div class="panel ref-list">${r.history.map((x) => `<div class="line"><div class="grow"><b>${x.kind === 'week' ? 'Доход за неделю' : x.kind === 'transfer' ? 'Перевод на баланс' : 'Корректировка'}</b><span class="muted">${new Date(x.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</span></div><span class="price ${x.amount < 0 ? 'neg' : ''}">${COIN}${signed(x.amount)}</span></div>`).join('')}</div>` : ''}`;

    $('#refHelp').onclick = () => refHelp(r);
    if ($('#howPartner')) $('#howPartner').onclick = () => partnerHow(r.partnerContact);
    $('#copyCode').onclick = () => copy(r.code, 'Код скопирован');
    if (r.link) {
      $('#copyRef').onclick = () => copy(r.link, 'Ссылка скопирована');
      $('#shareRef').onclick = () => {
        const url = `https://t.me/share/url?url=${encodeURIComponent(r.link)}&text=${encodeURIComponent(`Залетай в Brainrot Grader: по моей ссылке +${fmt(r.bonusPercent)}% к первому пополнению`)}`;
        try { TG?.openTelegramLink ? TG.openTelegramLink(url) : window.open(url, '_blank'); } catch { window.open(url, '_blank'); }
      };
    }
    $('#refTransfer').onclick = async (ev) => {
      ev = { currentTarget: ev.currentTarget }; // после await у события пропадает currentTarget
      ev.currentTarget.disabled = true;
      try {
        const res = await api('/api/referrals/transfer', { method: 'POST', body: { key: newKey() } });
        setBalance(res.balance);
        haptic('success');
        toast(`Переведено на баланс: ${fmt(res.transferred)} BG`);
        renderReferrals();
      } catch (e) {
        fail(e);
        ev.currentTarget.disabled = false;
      }
    };
  }

  // Как стать партнёром: написать владельцу, приложить ссылки на TikTok и Telegram-канал
  function partnerHow(contact) {
    const nick = String(contact).replace(/^@/, '');
    const body = h(`
      <div class="partner-how">
        <p>Партнёры получают повышенный процент с друзей и могут создавать свои промокоды на монеты.</p>
        <p><b>Чтобы стать партнёром:</b></p>
        <ol>
          <li>Напиши в личные сообщения <b>@${esc(nick)}</b></li>
          <li>Пришли ссылку на свой <b>TikTok</b></li>
          <li>И ссылки на свои <b>Telegram-каналы</b></li>
        </ol>
        <p class="muted">Мы посмотрим твои площадки и ответим в Telegram.</p>
        <button class="btn" id="partnerWrite">Написать @${esc(nick)}</button>
      </div>`);
    openSheet('Как стать партнёром', body);
    $('#partnerWrite', body).onclick = () => {
      const url = `https://t.me/${encodeURIComponent(nick)}`;
      try { TG?.openTelegramLink ? TG.openTelegramLink(url) : window.open(url, '_blank'); } catch { window.open(url, '_blank'); }
    };
  }

  // Партнёр: создание своих промокодов на монеты
  async function drawPartnerPromos() {
    const box = $('#partnerBox');
    if (!box) return;
    let d;
    try { d = await api('/api/promos'); } catch (e) { return fail(e); }
    if (!box.isConnected) return;
    const L = d.limits;
    box.innerHTML = `
      <h3>Мои промокоды</h3>
      <p class="hint" style="margin-top:0">Ты партнёр: можешь создать промокод на монеты для своих подписчиков. Каждый игрок активирует его только один раз. Монеты списываются с твоего баланса сразу, за неиспользованные активации вернутся при удалении.</p>
      <label class="field"><span>Промокод (5–20 латинских букв или цифр)</span><input id="ppCode" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Например, VLADTV50"></label>
      <div class="btn-row" style="gap:8px">
        <label class="field" style="flex:1"><span>Активаций</span><input id="ppUses" type="number" inputmode="numeric" min="1" max="${L.maxUses}" value="10"></label>
        <label class="field" style="flex:1"><span>BG за активацию</span><input id="ppReward" type="number" inputmode="decimal" min="${L.minReward}" max="${L.maxReward}" value="5"></label>
      </div>
      <button class="btn" id="ppCreate" style="margin-top:12px"></button>
      <div id="ppList" style="margin-top:12px">${d.promos.length ? d.promos.map((p) => `
        <div class="line"><div class="grow"><b>${esc(p.code)}</b><span class="muted">${fmt(p.reward)} BG × ${p.maxUses} · использовано ${p.uses} из ${p.maxUses}${p.status === 'used_up' ? ' · закончился' : ''}</span></div>
        ${p.status === 'active' ? `<button class="link-btn" data-pdel="${p.id}" data-code="${esc(p.code)}" data-left="${(p.maxUses - p.uses) * p.reward}">Удалить</button>` : ''}</div>`).join('') : '<p class="hint">Промокодов пока нет</p>'}</div>`;
    const cost = () => {
      const n = Math.floor(Number($('#ppUses').value) || 0);
      const r = Number($('#ppReward').value) || 0;
      $('#ppCreate').innerHTML = `Создать за ${price(Math.round(n * r * 100) / 100)}`;
    };
    $('#ppUses').oninput = cost;
    $('#ppReward').oninput = cost;
    cost();
    $('#ppCreate').onclick = async (ev) => {
      const btn = ev.currentTarget;
      if (btn.disabled) return; // уже создаём — повторные нажатия игнорируем
      const code = $('#ppCode').value.trim().toUpperCase();
      if (!/^[A-Z0-9]{5,20}$/.test(code)) return toast('Промокод: 5–20 латинских букв или цифр', 'err');
      const uses = Math.floor(Number($('#ppUses').value));
      const reward = Number($('#ppReward').value);
      if (!(uses >= 1)) return toast('Укажи количество активаций', 'err');
      if (!(reward > 0)) return toast('Укажи, сколько монет даёт одна активация', 'err');
      btn.disabled = true;
      try {
        const ok = await confirmBox(
          `Создать промокод ${code}: ${uses} активаций по ${fmt(reward)} BG?\nС баланса спишется ${fmt(uses * reward)} BG.`,
          { ok: 'Создать' },
        );
        if (!ok) return;
        const r = await api('/api/promos', { method: 'POST', body: { code, uses, reward, key: newKey() } });
        setBalance(r.balance);
        haptic('success');
        toast(`Промокод ${r.promo.code} создан`);
        drawPartnerPromos();
      } catch (e) {
        fail(e);
      } finally {
        btn.disabled = false;
      }
    };
    $$('[data-pdel]', box).forEach((b) => (b.onclick = async () => {
      if (b.disabled) return;
      b.disabled = true;
      try {
        // Сумма в окне — на момент открытия. Вернём ровно за те активации, которые останутся неиспользованными
        // в момент удаления: если кто-то успеет активировать раньше, вернётся меньше — сервер считает сам.
        const ok = await confirmBox(
          `Удалить промокод ${b.dataset.code}? Вернём монеты за неиспользованные активации — сейчас это ${fmt(Number(b.dataset.left))} BG.`,
          { ok: 'Удалить' },
        );
        if (!ok) return;
        const r = await api(`/api/promos/${b.dataset.pdel}/delete`, { method: 'POST', body: {} });
        setBalance(r.balance);
        toast(`Промокод удалён, вернули ${fmt(r.refund)} BG`);
        drawPartnerPromos();
      } catch (e) {
        fail(e);
        drawPartnerPromos();
      } finally {
        b.disabled = false;
      }
    }));
  }

  function drawInventory(inv) {
    state.inv = inv;
    const box = $('#invBox');
    if (!box) return;
    if (!inv.length) {
      box.innerHTML = '<div class="empty">Здесь будут твои бреинроты<a class="btn" href="#/">Открыть кейс</a></div>';
      return;
    }
    box.innerHTML = `<div class="items">${inv
      .map((i) => {
        const w = i.withdraw;
        let layer = '';
        if (w && w.status === 'queued') {
          // старая заявка-замена (бреинрот уже обменян) — без кнопки ×; остальные (и новая замена) — обычный «На выводе»
          const oldEx = w.exchange && typeof w.exchange !== 'object';
          layer = oldEx
            ? `<div class="wd-layer"><div class="spinner"></div>На выводе</div>`
            : `<div class="wd-layer"><div class="spinner"></div>На выводе<button class="wd-cancel" data-cancel="${w.id}" aria-label="Отменить вывод">×</button></div>`;
        } else if (w && w.status === 'waiting') {
          layer = `<div class="wd-layer wd-wait">📦<span>Ждём на складе</span><button class="wd-cancel" data-cancel="${w.id}" aria-label="Отменить вывод">×</button></div>`;
        } else if (w && w.status === 'called') {
          layer = w.inGame
            ? `<div class="wd-layer"><div class="spinner"></div>Ждём тебя в игре</div>`
            : `<div class="wd-layer">Твоя очередь!<button class="wd-ingame" data-ingame="${w.id}">Я в игре</button></div>`;
        }
        // div, а не button: внутри есть свои кнопки (отмена вывода, «Я в игре»)
        return `<div class="item rar-${esc(i.item.rarity)} ${w ? 'withdrawing' : ''}" role="button" tabindex="0" data-id="${i.id}">${ogTag(i.item)}<img loading="lazy" src="${itemImg(i.item.image)}" alt=""><div class="n">${esc(i.item.name)}</div>${price(i.item.price)}${layer}</div>`;
      })
      .join('')}</div>`;
    $$('.item', box).forEach((b) => {
      b.onclick = (ev) => {
        const cancelId = ev.target.closest('[data-cancel]')?.dataset.cancel;
        const ingameId = ev.target.closest('[data-ingame]')?.dataset.ingame;
        if (cancelId) return cancelWithdraw(Number(cancelId));
        if (ingameId) return imInGame(Number(ingameId));
        const it = inv.find((x) => x.id === Number(b.dataset.id));
        if (it && it.status === 'owned') itemActions(it);
      };
    });
  }

  function drawWdHistory(wd) {
    const box = $('#wdHistory');
    const done = wd.requests.filter((r) => !['queued', 'called', 'waiting'].includes(r.status)).slice(0, 10);
    if (!box || !done.length) return;
    const label = { completed: 'Выведен', cancelled: 'Отменён', rejected: 'Отклонён' };
    box.innerHTML = `<div class="section-head"><h2>История выводов</h2></div>${done
      .map((r) => `<div class="line"><img src="${itemImg(r.item.image)}" alt=""><div class="grow"><b>${esc(r.item.name)}</b><span class="muted">${label[r.status] || r.status}${r.note ? ': ' + esc(r.note) : ''}</span></div>${price(r.item.price)}</div>`)
      .join('')}`;
  }

  const GARAMA = 'Garama and Madundung';
  function itemActions(it) {
    const min = state.cfg.withdrawMin;
    // Гарамы дешевле минимума, но выводятся парой: берём эту и ещё одну свободную
    const garPair = it.item.name === GARAMA && it.item.price < min
      ? (state.inv || []).filter((x) => x.status === 'owned' && x.item.name === GARAMA && x.id !== it.id).slice(0, 1).map((x) => x.id)
      : null;
    const canWithdraw = it.item.price >= min || (garPair && garPair.length === 1);
    it.withIds = garPair && garPair.length === 1 ? [it.id, garPair[0]] : [it.id];
    const body = h(`
      <div>
        <div class="result-card rar-${esc(it.item.rarity)}" ${it.item.rarity === 'og' ? '' : 'style="box-shadow:none;border-color:var(--ridge-2)"'}>${ogTag(it.item)}
          <img src="${itemImg(it.item.image)}" alt=""><b>${esc(it.item.name)}</b>${price(it.item.price)}
        </div>
        <button class="btn" data-a="withdraw" ${canWithdraw ? '' : 'disabled'}>${it.withIds.length > 1 ? `Вывести ${it.withIds.length} шт. в Roblox` : 'Вывести в Roblox'}</button>
        ${canWithdraw ? '' : `<p class="hint center">${garPair ? 'Garama and Madundung выводится от 2 шт. — нужна ещё одна' : `Вывести можно бреинрота от ${fmt(min)} BG`}</p>`}
        <div class="btn-row" style="margin-top:8px">
          <button class="btn ghost" data-a="sell">Продать за ${price(it.item.price)}</button>
          <button class="btn ghost" data-a="upgrade">Апгрейд</button>
        </div>
      </div>`);
    const s = openSheet('Бреинрот', body);
    $('[data-a=sell]', body).onclick = async (ev) => {
      ev = { currentTarget: ev.currentTarget }; // после await у события пропадает currentTarget
      ev.currentTarget.disabled = true;
      try {
        const r = await api('/api/inventory/sell', { method: 'POST', body: { ids: [it.id], key: newKey() } });
        setBalance(r.balance);
        toast(`Продано за ${fmt(r.total)} BG`);
        s.close();
        renderProfile();
      } catch (e) {
        ev.currentTarget.disabled = false;
        fail(e);
      }
    };
    $('[data-a=upgrade]', body).onclick = () => {
      s.close();
      location.hash = `#/upgrade?item=${it.id}`;
    };
    $('[data-a=withdraw]', body).onclick = () => withdrawSheet(it);
  }

  function withdrawSheet(it) {
    if (payBlocked()) return;
    const body = h(`
      <div>
        <div class="line" style="border-top:1px solid var(--ridge)"><img src="${itemImg(it.item.image)}" alt=""><div class="grow"><b>${esc(it.item.name)}${(it.withIds || []).length > 1 ? ` ×${it.withIds.length}` : ''}</b></div>${price(it.item.price * ((it.withIds || []).length || 1))}</div>
        <label class="field"><span>Твой ник в Roblox</span><input id="rbx" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="20" placeholder="Например, Player_123" value="${esc(state.me.robloxUsername || '')}"></label>
        <div class="note">Выводы проходят каждый день ${esc(state.cfg.withdrawWindow)}. Бот напишет в Telegram, когда подойдёт твоя очередь и нужно будет зайти в игру.</div>
        <button class="btn" id="wdGo">Поставить на вывод</button>
      </div>`);
    const s = openSheet('Вывод', body);
    $('#wdGo', body).onclick = async (ev) => {
      ev = { currentTarget: ev.currentTarget }; // после await у события пропадает currentTarget
      const nick = $('#rbx', body).value.trim();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(nick)) return toast('Ник в Roblox: 3–20 символов, латиница, цифры и _', 'err');
      ev.currentTarget.disabled = true;
      const btn = ev.currentTarget;
      const picked = {}; // выбор по каждому бреинроту копится: при выводе пары спросим про каждый
      const send = async (choices) => {
        Object.assign(picked, choices || {});
        const r = await api('/api/withdraw', { method: 'POST', body: { ids: it.withIds || [it.id], robloxUsername: nick, choices: picked } });
        state.me.robloxUsername = nick;
        if (r.balance != null) setBalance(r.balance);
        s.close();
        haptic('success');
        const ex = r.requests.filter((x) => x.mode === 'exchange').length;
        if (r.waiting) toast('Как только бреинрот появится у нас на складе, вывод встанет в очередь — бот напишет');
        else if (ex) toast('Ты в очереди на вывод. Замену выдадим в игре, когда подойдёт твоя очередь — бот напишет');
        else toast('Ты в очереди на вывод. Бот напишет, когда нужно будет зайти в игру');
        renderProfile();
      };
      try {
        await send();
      } catch (e) {
        btn.disabled = false;
        // бреинрота нет на складе — даём выбрать: замена сразу или подождать
        if (e.code === 'need_choice' && e.data?.offers?.length) return exchangeSheet(e.data.offers[0], s, send);
        fail(e);
      }
    };
  }

  // Бреинрота нет на складе: замена драконами / Гарамами (+ остаток на баланс) или подождать, пока появится
  function exchangeSheet(o, parent, send) {
    const ex = o.exchange;
    const body = h(`
      <div>
        <p class="ex-lead">«${esc(o.item.name)}» сейчас нет у нас на складе. Как поступим?</p>
        ${ex ? `
        <div class="ex-card">
          <div class="ex-title">Вывести с заменой</div>
          <div class="line"><img src="${itemImg(ex.item.image)}" alt=""><div class="grow"><b>${ex.qty} × ${esc(ex.item.name)}</b>${ex.change > 0 ? `<span class="muted">+ ${fmt(ex.change)} BG на баланс</span>` : ''}</div></div>
          <p class="muted">Сейчас ничего не меняется: «${esc(o.item.name)}» просто встанет в очередь на вывод. Когда тебя вызовут, в игре выдадим это вместо него. До этого можно отменить.</p>
          <button class="btn" data-a="exchange">Вывести с заменой</button>
        </div>` : '<p class="hint">Заменить сейчас нечем — на складе не хватает бреинротов для замены.</p>'}
        <div class="ex-card">
          <div class="ex-title">Подождать «${esc(o.item.name)}»</div>
          <p class="muted">Как только он появится у нас на складе, вывод сам встанет в очередь, и бот напишет. Пока ждёшь, отменить можно в любой момент.</p>
          <button class="btn ghost" data-a="wait">Подождать</button>
        </div>
      </div>`);
    const s2 = openSheet('Нет на складе', body);
    const go = (choice) => async (ev) => {
      const b = ev.currentTarget;
      $$('button', body).forEach((x) => (x.disabled = true));
      try {
        await send({ [o.inventoryId]: choice });
        s2.close();
        parent.close?.();
      } catch (e) {
        $$('button', body).forEach((x) => (x.disabled = false));
        if (e.code === 'need_choice' && e.data?.offers?.length) { s2.close(); return exchangeSheet(e.data.offers[0], parent, send); }
        fail(e);
      }
      return b;
    };
    const exBtn = $('[data-a=exchange]', body);
    if (exBtn) exBtn.onclick = go('exchange');
    $('[data-a=wait]', body).onclick = go('wait');
  }

  async function cancelWithdraw(id) {
    try {
      await api(`/api/withdraw/${id}/cancel`, { method: 'POST', body: {} });
      toast('Вывод успешно отменён');
      renderProfile();
    } catch (e) {
      fail(e);
      renderProfile();
    }
  }

  async function imInGame(id) {
    try {
      await api(`/api/withdraw/${id}/in-game`, { method: 'POST', body: {} });
      toast('Отлично, сейчас отправим бреинрота');
      renderProfile();
    } catch (e) {
      fail(e);
    }
  }

  async function copy(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = h('<textarea style="position:fixed;opacity:0"></textarea>');
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(msg, 'ok', 2500);
  }

  // =====================================================================
  //                             ПОПОЛНЕНИЕ
  // =====================================================================
  const dep = { tab: 'stars', sel: new Map(), q: '', from: '', to: '', sort: 'desc', catalog: null, timers: [] };
  const stopDepTimers = () => { dep.timers.forEach(clearInterval); dep.timers = []; };

  // Одно поле «Промокод или код друга» в пополнении
  const refPct = () => state.me.refBonusPercent || state.cfg.refBonusPercent;
  function codeFieldsHtml() {
    const hb = state.home?.bonus;
    const about = state.me.canEnterRefCode
      ? `Промокод с главной даёт бонус к пополнению. Код друга — +${fmt(refPct())}% к первому пополнению, на аккаунт можно ввести только один код друга.`
      : 'Промокод с главной даёт бонус к пополнению.';
    return `
      <label class="field"><span>Промокод или код друга</span><input id="dPromo" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Например, ${esc(hb?.code || 'DRAGON47')}" value="${esc(dep.promo || '')}"></label>
      <p class="hint" style="margin-top:6px">${about}</p>`;
  }
  // Что за код в поле — спрашиваем у сервера, пока игрок печатает (промокод с главной узнаём сразу)
  const peek = { code: '', res: null, timer: 0 };
  function knownBonus(box) {
    const code = ($('#dPromo', box)?.value || '').trim().toUpperCase();
    const bound = state.me.firstDepositBonus || 0; // уже привязан к другу, впереди первое пополнение
    let pct = bound;
    const parts = bound ? [`+${fmt(bound)}% к первому пополнению по коду друга`] : [];
    if (code.length >= 3) {
      const r = peek.code === code ? peek.res : null;
      if (!r) parts.push('Проверяем код…');
      else if (r.ok && r.kind === 'friend' && bound) { /* тот же друг — бонус уже учтён */ }
      else if (r.ok) { pct += r.percent; if (r.text) parts.push(r.text); }
      else if (r.text) parts.push('⚠ ' + r.text);
    }
    return { pct, text: parts.join('. ') };
  }
  function watchCode(box, recalc) {
    const inp = $('#dPromo', box);
    if (!inp) return recalc();
    const run = () => {
      const code = inp.value.trim().toUpperCase();
      clearTimeout(peek.timer);
      if (code !== peek.code) {
        peek.code = code;
        peek.res = null;
        const hb = state.home?.bonus;
        if (hb && code === hb.code) {
          peek.res = hb.used
            ? { ok: false, kind: 'bonus', percent: 0, text: 'Ты уже использовал этот промокод' }
            : { ok: true, kind: 'bonus', percent: hb.percent, text: `+${fmt(hb.percent)}% к пополнению по промокоду ${hb.code}` };
        } else if (code.length >= 3) {
          peek.timer = setTimeout(async () => {
            let r;
            try { r = await api('/api/deposit/code', { method: 'POST', body: { code } }); }
            catch { r = { ok: true, kind: null, percent: 0, text: 'Код проверим, когда создашь оплату' }; }
            if (peek.code === code) { peek.res = r; recalc(); }
          }, 350);
        }
      }
      recalc();
    };
    inp.oninput = run;
    run();
  }
  const codeBody = (box) => ({ promo: $('#dPromo', box)?.value.trim() || undefined });
  function afterCodes(kind) {
    if (kind === 'friend') {
      if (state.me.canEnterRefCode) state.me.firstDepositBonus = refPct();
      Object.assign(state.me, { hasReferrer: true, canEnterRefCode: false });
    }
    dep.promo = '';
    peek.code = '';
    peek.res = null;
  }

  function openDeposit(tab = dep.tab, { promo } = {}) {
    if (payBlocked()) return;
    if (promo !== undefined) dep.promo = promo;
    const body = h(`<div><div class="seg" id="depSeg" style="margin-top:0"><button data-t="stars">Звёзды</button><button data-t="items">Бреинроты</button></div><div id="dep"></div></div>`);
    openSheet('Пополнение', body, { onClose: stopDepTimers });
    $$('#depSeg button', body).forEach((b) => (b.onclick = () => showDepTab(b.dataset.t)));
    showDepTab(tab);
  }

  function showDepTab(tab) {
    dep.tab = tab;
    stopDepTimers();
    $$('#depSeg button').forEach((b) => b.classList.toggle('on', b.dataset.t === tab));
    if (tab === 'stars') starsTab();
    else itemsTab();
  }

  // ----- Звёзды -----
  function starsTab() {
    const cfg = state.cfg;
    const box = $('#dep');
    box.innerHTML = `
      <label class="field"><span>Сколько звёзд</span><input id="stars" type="number" inputmode="numeric" min="${cfg.starsMin}" max="${cfg.starsMax}" placeholder="Например, 100"></label>
      ${codeFieldsHtml()}
      <div class="total"><span>Получишь</span><b>${COIN}<span id="get">0</span></b></div>
      <p class="hint" id="bonusHint"></p>
      <button class="btn" id="pay" disabled>Оплатить звёздами</button>
      <p class="hint center">1 ⭐ = ${fmt(cfg.starsRate)} BG, минимум ${cfg.starsMin} ⭐. Зачисление сразу после оплаты.</p>`;
    const inp = $('#stars', box);
    const recalc = () => {
      const n = Math.floor(Number(inp.value) || 0);
      const base = n * cfg.starsRate;
      const kb = knownBonus(box);
      $('#get', box).textContent = fmt(base * (1 + kb.pct / 100));
      $('#bonusHint', box).textContent = kb.text;
      $('#pay', box).disabled = !(n >= cfg.starsMin && n <= cfg.starsMax);
    };
    inp.oninput = recalc;
    watchCode(box, recalc);
    $('#pay', box).onclick = async (ev) => {
      ev = { currentTarget: ev.currentTarget }; // после await у события пропадает currentTarget
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        const codes = codeBody(box);
        const r = await api('/api/deposit/stars', { method: 'POST', body: { stars: Math.floor(Number(inp.value)), ...codes } });
        afterCodes(r.codeKind);
        const after = (status) => {
          if (status === 'paid') {
            haptic('success');
            toast(r.bonus > 0 ? `Оплата прошла: ${fmt(r.bg)} BG и +${fmt(r.bonus)} BG бонусом` : 'Оплата прошла, BG уже на балансе');
            if (codes.promo && state.home?.bonus && codes.promo.toUpperCase() === state.home.bonus.code) state.home.bonus.used = true;
            closeSheet();
            pollBalance();
          } else if (status === 'failed') toast('Оплата не прошла', 'err');
          btn.disabled = false;
        };
        if (TG?.openInvoice) TG.openInvoice(r.link, after);
        else {
          window.open(r.link, '_blank');
          btn.disabled = false;
        }
      } catch (e) {
        btn.disabled = false;
        fail(e);
      }
    };
  }

  async function pollBalance() {
    const before = state.me.balance;
    for (let i = 0; i < 8; i++) {
      await sleep(1500);
      try {
        const me = await refreshMe();
        if (me.balance !== before) break;
      } catch {}
    }
    state.caseUpdate?.();
  }

  // ----- Бреинроты -----
  async function itemsTab() {
    const box = $('#dep');
    box.innerHTML = '<div class="skeleton"></div>';
    let cur;
    try {
      cur = await api('/api/deposit/current');
    } catch (e) {
      return fail(e);
    }
    if (dep.tab !== 'items' || !$('#dep')) return;
    if (cur.request && ['queued', 'active'].includes(cur.request.status)) return queueView(cur);
    if (cur.request) return finishedView(cur.request);
    return catalogView(cur.open);
  }

  async function catalogView(open) {
    const box = $('#dep');
    if (!dep.catalog) {
      box.innerHTML = '<div class="skeleton"></div>';
      try {
        dep.catalog = await api('/api/deposit/catalog');
      } catch (e) {
        return fail(e);
      }
    }
    const cat = dep.catalog;
    box.innerHTML = `
      <p class="hint" style="margin-top:0">Выбери одного или сразу несколько бреинротов. Отдашь их одним трейдом в Roblox, BG зачислятся после приёма.</p>
      ${open === false ? '<div class="note warn">Приём сейчас на паузе. Заявку можно создать, она встанет в очередь.</div>' : ''}
      <input class="search" id="dq" placeholder="Поиск бреинрота" value="${esc(dep.q)}" style="margin-top:12px">
      <div class="filters">
        <input id="dfrom" inputmode="decimal" placeholder="Цена от" value="${esc(dep.from)}">
        <input id="dto" inputmode="decimal" placeholder="до" value="${esc(dep.to)}">
        <button class="sort" id="dsort"></button>
      </div>
      <div class="items" id="dgrid"></div>
      <div class="picked"><button class="btn" id="dnext"></button></div>`;
    const draw = () => {
      const q = dep.q.toLowerCase();
      const from = Number(dep.from) || 0;
      const to = Number(dep.to) || Infinity;
      let list = cat.items.filter((i) => i.name.toLowerCase().includes(q) && i.price >= from && i.price <= to);
      list = list.sort((a, b) => (dep.sort === 'desc' ? b.price - a.price : a.price - b.price));
      $('#dsort').textContent = dep.sort === 'desc' ? 'Сначала дорогие' : 'Сначала дешёвые';
      $('#dgrid').innerHTML = list.length
        ? list
            .map((i) => {
              const n = dep.sel.get(i.id) || 0;
              return `<button class="item rar-${esc(i.rarity)} ${n ? 'sel' : ''}" data-id="${i.id}">${n ? `<span class="qty">${n}</span><span class="minus" data-minus="${i.id}">−</span>` : ''}${i.minQty && !n ? `<span class="min-qty">от ${i.minQty} шт.</span>` : ''}${ogTag(i)}<img loading="lazy" src="${itemImg(i.image)}" alt=""><div class="n">${esc(i.name)}</div>${price(i.price)}</button>`;
            })
            .join('')
        : '<div class="empty" style="grid-column:1/-1">Ничего не нашлось</div>';
      const count = [...dep.sel.values()].reduce((a, b) => a + b, 0);
      const sum = [...dep.sel.entries()].reduce((a, [id, n]) => a + (cat.items.find((x) => x.id === id)?.price || 0) * n, 0);
      const nb = $('#dnext');
      nb.disabled = !count;
      nb.innerHTML = count ? `Продолжить: ${count} шт. на ${price(sum)}` : 'Выбери бреинротов';
      $$('#dgrid .item').forEach((b) => {
        b.onclick = (ev) => {
          const id = Number(b.dataset.id);
          const n = dep.sel.get(id) || 0;
          const minQty = cat.items.find((x) => x.id === id)?.minQty || 1;
          if (ev.target.closest('[data-minus]')) {
            if (n <= minQty) dep.sel.delete(id);
            else dep.sel.set(id, n - 1);
          } else {
            const add = n === 0 ? minQty : 1; // Гарамы — сразу парой: их принимаем от 2 шт.
            if (count + add > cat.maxItems) return toast(`За одну заявку можно до ${cat.maxItems} бреинротов`, 'err', 3000);
            dep.sel.set(id, n + add);
          }
          tick();
          draw();
        };
      });
    };
    $('#dq').oninput = (e) => { dep.q = e.target.value; draw(); };
    $('#dfrom').oninput = (e) => { dep.from = e.target.value.replace(',', '.'); draw(); };
    $('#dto').oninput = (e) => { dep.to = e.target.value.replace(',', '.'); draw(); };
    $('#dsort').onclick = () => { dep.sort = dep.sort === 'desc' ? 'asc' : 'desc'; draw(); };
    $('#dnext').onclick = () => summaryView(open);
    draw();
  }

  function summaryView(open) {
    const cat = dep.catalog;
    const box = $('#dep');
    const lines = [...dep.sel.entries()].map(([id, n]) => ({ it: cat.items.find((x) => x.id === id), n })).filter((l) => l.it);
    const sum = lines.reduce((a, l) => a + l.it.price * l.n, 0);
    box.innerHTML = `
      <button class="back" id="dback">‹ Назад к выбору</button>
      ${lines.map((l) => `<div class="line"><img src="${itemImg(l.it.image)}" alt=""><div class="grow"><b>${esc(l.it.name)} ×${l.n}</b></div>${price(l.it.price * l.n)}<button class="x" data-rm="${l.it.id}" aria-label="Убрать">×</button></div>`).join('')}
      <div class="total"><span>Всего получишь</span><b>${COIN}<span id="dget">${fmt(sum)}</span></b></div>
      <p class="hint" id="dbonus"></p>
      ${sum < cat.minTotal ? `<div class="note warn">Минимальное пополнение — ${fmt(cat.minTotal)} BG. Добавь ещё бреинротов</div>` : ''}
      <label class="field"><span>Твой ник в Roblox</span><input id="drbx" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="20" placeholder="Например, Player_123" value="${esc(state.me.robloxUsername || '')}"></label>
      ${codeFieldsHtml()}
      ${open === false ? '<div class="note warn">Приём сейчас на паузе. Заявка встанет в очередь и мы примем её, когда вернёмся.</div>' : ''}
      <button class="btn" id="dcreate" ${sum < cat.minTotal ? 'disabled' : ''}>Создать заявку</button>`;
    const recalc = () => {
      const kb = knownBonus(box);
      $('#dget', box).textContent = fmt(sum * (1 + kb.pct / 100));
      $('#dbonus', box).textContent = kb.text;
    };
    watchCode(box, recalc);
    $('#dback').onclick = () => catalogView(open);
    $$('[data-rm]', box).forEach((b) => (b.onclick = () => { dep.sel.delete(Number(b.dataset.rm)); dep.sel.size ? summaryView(open) : catalogView(open); }));
    $('#dcreate').onclick = async (ev) => {
      ev = { currentTarget: ev.currentTarget }; // после await у события пропадает currentTarget
      const nick = $('#drbx').value.trim();
      if (!/^[A-Za-z0-9_]{3,20}$/.test(nick)) return toast('Ник в Roblox: 3–20 символов, латиница, цифры и _', 'err');
      ev.currentTarget.disabled = true;
      try {
        const r = await api('/api/deposit/items', {
          method: 'POST',
          body: { items: lines.map((l) => ({ itemId: l.it.id, qty: l.n })), robloxUsername: nick, ...codeBody(box) },
        });
        state.me.robloxUsername = nick;
        afterCodes(r.codeKind);
        dep.sel.clear();
        haptic('success');
        toast('Заявка создана. Бот напишет, когда подойдёт очередь');
        itemsTab();
      } catch (e) {
        ev.currentTarget.disabled = false;
        fail(e);
      }
    };
  }

  function queueView(cur) {
    const r = cur.request;
    const box = $('#dep');
    const active = r.status === 'active';
    let left = active ? r.secondsLeft : r.etaSeconds;
    box.innerHTML = `
      <div class="center" style="padding:6px 0 4px">
        ${active
          ? `<div class="queue-num">Твоя очередь!</div>
             <p>Отправь трейд в Roblox аккаунту <b>${esc(r.tradeAccount || '—')}</b></p>
             <div class="muted">Осталось</div>`
          : r.ahead
            ? `<div class="muted">Ты в очереди</div><div class="queue-num">№${r.position}</div>
               <p class="hint">Впереди ${r.ahead} ${plural(r.ahead, 'заявка', 'заявки', 'заявок')}. Примерное ожидание:</p>`
            : `<div class="muted">Ты в очереди</div><div class="queue-num">№1</div>
               <p class="hint">Ты следующий. Примерное ожидание:</p>`}
        <div class="timer" id="qtimer">${mmss(left)}</div>
      </div>
      ${cur.open === false && !active ? '<div class="note warn">Приём сейчас на паузе, очередь продолжится, когда мы вернёмся.</div>' : ''}
      <div class="note">Бот напишет в Telegram, когда подойдёт очередь. Это окно можно закрыть.</div>
      <div style="margin-top:12px">${r.items.map((i) => `<div class="line"><img src="${itemImg(i.image)}" alt=""><div class="grow"><b>${esc(i.name)} ×${i.qty}</b></div>${price(i.price * i.qty)}</div>`).join('')}</div>
      <div class="total"><span>Ник: ${esc(r.robloxUsername)}</span><b>${COIN}${fmt(r.total)}</b></div>
      <button class="btn danger" id="dcancel">Отменить заявку</button>`;
    dep.timers.push(setInterval(() => {
      left = Math.max(0, left - 1);
      const el = $('#qtimer');
      if (el) el.textContent = mmss(left);
    }, 1000));
    dep.timers.push(setInterval(async () => {
      try {
        const fresh = await api('/api/deposit/current');
        if (dep.tab !== 'items' || !$('#dep')) return;
        stopDepTimers();
        if (fresh.request && ['queued', 'active'].includes(fresh.request.status)) queueView(fresh);
        else if (fresh.request) finishedView(fresh.request);
        else catalogView(fresh.open);
      } catch {}
    }, 10000));
    $('#dcancel').onclick = async (ev) => {
      ev = { currentTarget: ev.currentTarget }; // после await у события пропадает currentTarget
      if (!(await confirmBox('Отменить заявку на пополнение? Место в очереди пропадёт.', { ok: 'Отменить заявку', cancel: 'Назад' }))) return;
      ev.currentTarget.disabled = true;
      try {
        await api(`/api/deposit/items/${r.id}/cancel`, { method: 'POST', body: {} });
        stopDepTimers();
        toast('Заявка отменена');
        catalogView(cur.open);
      } catch (e) {
        ev.currentTarget.disabled = false;
        fail(e);
      }
    };
  }

  function finishedView(r) {
    const box = $('#dep');
    const text = {
      completed: `Зачислено ${fmt(r.credited)} BG`,
      cancelled: 'Заявка отменена',
      expired: 'Время на трейд вышло',
      rejected: `Заявка отклонена${r.note ? ': ' + r.note : ''}`,
    }[r.status];
    box.innerHTML = `
      <div class="center" style="padding:10px 0"><div class="queue-num" style="font-size:26px">${esc(text || r.status)}</div></div>
      <button class="btn" id="dnew">Новая заявка</button>`;
    if (r.status === 'completed') refreshMe().catch(() => {});
    $('#dnew').onclick = () => catalogView();
  }

  // =====================================================================
  //                                СТАРТ
  // =====================================================================
  // ---------- Полный экран (Telegram 8.0+) ----------
  // На компьютере открываемся сразу во весь экран, на телефоне остаётся обычный вид.
  // Кнопка ⛶ в шапке переключает режим вручную (только на компьютере).
  function setupFullscreen() {
    if (!TG?.isVersionAtLeast?.('8.0') || !TG.requestFullscreen) return;
    const desktop = ['tdesktop', 'macos', 'weba', 'webk', 'web'].includes(TG.platform);
    if (!desktop) return;
    const btn = $('#fsBtn');
    btn.classList.remove('hidden');
    btn.onclick = () => {
      try { TG.isFullscreen ? TG.exitFullscreen() : TG.requestFullscreen(); } catch {}
    };
    try { if (!TG.isFullscreen) TG.requestFullscreen(); } catch {}
  }

  async function boot() {
    applyStreamer();
    if (TG) {
      try {
        TG.ready();
        TG.expand();
        TG.setHeaderColor?.('#0c1110');
        TG.setBackgroundColor?.('#0c1110');
        if (TG.isVersionAtLeast?.('7.7')) TG.disableVerticalSwipes();
        // Пункт «Настройки» в меню ⋮ Telegram
        if (TG.SettingsButton && TG.isVersionAtLeast?.('7.0')) {
          TG.SettingsButton.onClick(() => openSettings());
          TG.SettingsButton.show();
        } else TG.onEvent?.('settingsButtonClicked', () => openSettings());
        setupFullscreen();
        TG.BackButton?.onClick(() => {
          if (state.locked) return lockedNotice();
          if (menu) return closeMenu();
          if (sheet) return closeSheet();
          if (history.length > 1) history.back();
          else location.hash = '#/';
        });
      } catch {}
    }
    if (!TG?.initData && !DEV_ID) {
      view.innerHTML = '<div class="empty">Открой Brainrot Grader через бота в Telegram</div>';
      return;
    }
    try {
      [state.me, state.cfg] = await Promise.all([api('/api/me'), api('/api/config')]);
    } catch (e) {
      if (e.code !== 'site_closed') view.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    adminModeStrip();
    setBalance(state.me.balance);
    fillAvatar($('#avatar'));
    $('#topup').onclick = () => openDeposit();
    $('#menuBtn').onclick = () => (menu ? closeMenu() : openMenu());
    setupDesktop();
    addEventListener('hashchange', route);
    route();
  }

  boot();
})();
