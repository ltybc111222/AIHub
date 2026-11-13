// SPDX-License-Identifier: GPL-3.0-or-later
//
// Снимок структуры интерфейса чата для разведки (issue #2).
//
// Только чтение DOM. Скрипт не кликает, не вводит текст, не делает сетевых
// запросов и не читает куки/хранилища. Текст страницы не сохраняется: только
// теги, роли и атрибуты из белого списка, счётчики и геометрия. Значения,
// похожие на идентификаторы или почту, заменяются на «…».
//
// Использование (в консоли страницы или через Claude in Chrome):
//   AIHubRecon.snapshot('empty')        // полный снимок текущего состояния
//   AIHubRecon.start()                  // начать запись таймлайна
//   ... пользователь отправляет запрос ...
//   AIHubRecon.stop()                   // таймлайн + самые «горячие» узлы
//   AIHubRecon.turns()                  // разметка реплик диалога
//   AIHubRecon.menus()                  // открытые меню/листбоксы (открывает пользователь)
//   AIHubRecon.env()                    // браузер и язык (Promise)
(() => {
  'use strict';

  const R = '…';
  const MAX_ATTR = 60;

  // Атрибуты, значения которых описывают структуру, а не содержимое.
  const STRUCT_ATTRS = new Set([
    'role', 'type', 'contenteditable', 'translate', 'spellcheck', 'enterkeyhint',
    'autocomplete', 'dir', 'lang', 'name', 'method', 'disabled', 'readonly',
    'aria-busy', 'aria-live', 'aria-atomic', 'aria-relevant', 'aria-expanded',
    'aria-haspopup', 'aria-disabled', 'aria-pressed', 'aria-selected',
    'aria-checked', 'aria-hidden', 'aria-multiline', 'aria-autocomplete',
    'aria-modal', 'aria-orientation', 'aria-roledescription', 'aria-level',
    'data-state', 'data-testid', 'data-message-author-role', 'data-is-streaming',
    'data-lexical-editor', 'data-slate-editor', 'data-side', 'data-align',
    'data-orientation', 'data-disabled', 'data-highlighted',
  ]);
  // Атрибуты с текстом интерфейса: сохраняются только у элементов управления
  // вне навигации (в навигации это могут быть названия диалогов).
  const LABEL_ATTRS = new Set(['aria-label', 'title', 'placeholder', 'data-placeholder', 'aria-placeholder']);
  // Атрибуты-ссылки на id: сохраняется только факт наличия.
  const REF_ATTRS = new Set(['aria-controls', 'aria-labelledby', 'aria-describedby', 'aria-owns', 'aria-activedescendant', 'for', 'form']);
  // Никогда не сохраняются даже по имени значения.
  const SKIP_ATTRS = new Set(['class', 'style', 'href', 'src', 'srcset', 'value', 'd', 'viewBox', 'xmlns', 'alt', 'content', 'action']);

  // Классы, по которым известны редакторы и гипотезы части 1. Остальные классы не пишутся.
  const MARKER_CLASSES = ['ProseMirror', 'ProseMirror-focused', 'cm-content', 'ql-editor', 'font-claude-message', 'ds-markdown', 'katex', 'katex-display', 'markdown', 'prose'];

  const INTERACTIVE_ROLES = new Set(['button', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'option', 'combobox', 'textbox', 'switch', 'tab', 'checkbox', 'radio', 'listbox', 'menu']);

  const HYPOTHESES = {
    'chatgpt.com': {
      input: ['#prompt-textarea', '#prompt-textarea.ProseMirror[contenteditable="true"]'],
      send: ['button[data-testid="send-button"]', 'button[aria-label*="Send"]'],
      stop: ['button[data-testid="stop-button"]'],
      answer: ['div[data-message-author-role="assistant"]'],
    },
    'claude.ai': {
      input: ['div[contenteditable="true"].ProseMirror'],
      send: ['button[aria-label="Send message"]'],
      stop: ['button[aria-label*="Stop"]'],
      answer: ['div.font-claude-message'],
    },
    'chat.deepseek.com': {
      input: ['textarea#chat-input'],
      send: ['div[role="button"][aria-label*="Send"]'],
      stop: ['button[aria-label*="Stop"]'],
      answer: ['div.ds-markdown'],
    },
  };

  // Нейтральные кандидаты, не зависящие от сервиса.
  const GENERIC = {
    input: 'textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]',
    // Флаг i в CSS не сворачивает регистр кириллицы, поэтому варианты с заглавной буквы перечислены явно.
    stop: '[data-testid*="stop" i], [aria-label*="stop" i], [aria-label*="стоп"], [aria-label*="Стоп"], [aria-label*="останов"], [aria-label*="Останов"]',
    busy: '[aria-busy="true"]',
    live: '[aria-live], [role="status"], [role="alert"], [role="log"]',
    streaming: '[data-is-streaming="true"]',
    messages: '[data-message-author-role], [data-testid*="message" i], [data-testid*="turn" i], [data-is-streaming], [data-message-id], article',
    popupTriggers: 'button[aria-haspopup], [role="button"][aria-haspopup], [role="combobox"], [data-testid*="model" i]',
    menus: '[role="menu"], [role="listbox"], [role="dialog"], [data-radix-popper-content-wrapper]',
    landmarks: 'main, nav, aside, header, footer, form, [role="main"], [role="navigation"], [role="complementary"], [role="banner"], [role="contentinfo"], [role="region"], [role="dialog"], [role="log"], [role="feed"], [role="search"], [role="toolbar"], [role="status"], [role="alert"]',
  };
  // Найденные вживую якоря ответа (дополняют гипотезы в таймлайне).
  const CURRENT_ANSWER = {
    'chatgpt.com': ['[data-conversation-role="assistant"]'],
    'chat.deepseek.com': ['.ds-assistant-message-main-content'],
  };
  // Атрибуты состояния, за которыми следит таймлайн (имя содержит одно из слов).
  const STATE_ATTR_RE = /state|stream|status|busy|generat|pending|progress/i;

  const RICH = { pre: 'pre', code: 'code', table: 'table', ul: 'ul', ol: 'ol', li: 'li', h: 'h1,h2,h3,h4,h5,h6', blockquote: 'blockquote', katex: '.katex', math: 'math', mjx: 'mjx-container', img: 'img', svg: 'svg', button: 'button,[role="button"]' };

  const hyp = () => HYPOTHESES[location.hostname] || {};

  const idLike = (v) =>
    /[0-9a-f]{8}-[0-9a-f]{4}/i.test(v) || /\d{5,}/.test(v) || /@/.test(v) ||
    (/^[A-Za-z0-9_-]{16,}$/.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v));

  const clean = (v) => {
    if (v == null) return v;
    v = String(v).replace(/\s+/g, ' ').trim();
    if (idLike(v)) return R;
    return v.length > MAX_ATTR ? v.slice(0, MAX_ATTR) + R : v;
  };

  const inNav = (el) => !!el.closest('nav, aside, [role="navigation"], [role="complementary"]');

  const isInteractive = (el) => {
    const t = el.tagName.toLowerCase();
    if (t === 'a') return false;
    if (['button', 'input', 'textarea', 'select'].includes(t)) return true;
    if (el.isContentEditable) return true;
    return INTERACTIVE_ROLES.has(el.getAttribute('role') || '');
  };

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0;
  };

  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  };

  function attrs(el) {
    const out = {};
    const labelsOk = isInteractive(el) && !inNav(el);
    for (const { name, value } of el.attributes) {
      if (SKIP_ATTRS.has(name) || name.startsWith('on')) continue;
      if (name === 'id') out.id = clean(value);
      else if (STRUCT_ATTRS.has(name)) out[name] = clean(value);
      else if (LABEL_ATTRS.has(name)) out[name] = labelsOk ? clean(value) : R;
      else if (REF_ATTRS.has(name)) out[name] = R;
      else if (name.startsWith('data-')) out[name] = /^[a-z0-9_.:-]{1,32}$/i.test(value) && !idLike(value) ? value : R;
      else if (name.startsWith('aria-')) out[name] = R;
      else out[name] = R;
    }
    return out;
  }

  function describe(el, opts = {}) {
    if (!el || el.nodeType !== 1) return null;
    const d = { tag: el.tagName.toLowerCase(), attrs: attrs(el) };
    const markers = MARKER_CLASSES.filter((c) => el.classList.contains(c));
    if (markers.length) d.markers = markers;
    if (el.isContentEditable && el.getAttribute('contenteditable') == null) d.inheritsEditable = true;
    if ('disabled' in el && el.disabled) d.disabled = true;
    if (opts.geom) { d.rect = rect(el); d.visible = isVisible(el); }
    if (opts.kids) d.children = el.childElementCount;
    if (opts.svg) d.hasSvg = !!el.querySelector('svg');
    return d;
  }

  // Короткая подпись узла: tag[role][data-testid]#id — без содержимого.
  function sig(el) {
    if (!el || el.nodeType !== 1) return null;
    let s = el.tagName.toLowerCase();
    const id = el.id && !idLike(el.id) ? el.id : el.id ? R : '';
    if (id) s += '#' + id;
    for (const a of ['role', 'data-testid', 'data-message-author-role', 'contenteditable', 'aria-live', 'aria-busy', 'data-is-streaming']) {
      const v = el.getAttribute(a);
      if (v != null) s += `[${a}=${clean(v)}]`;
    }
    const m = MARKER_CLASSES.filter((c) => el.classList.contains(c));
    if (m.length) s += '.' + m.join('.');
    return s;
  }

  const LANDMARK_STOP = 'form, main, nav, aside, header, footer, [role="main"], [role="region"], [role="dialog"], body';
  function ancestors(el, max = 20) {
    const chain = [];
    let cur = el.parentElement;
    while (cur && chain.length < max) {
      chain.push(sig(cur));
      if (cur.matches(LANDMARK_STOP)) break;
      cur = cur.parentElement;
    }
    return chain;
  }

  function editorKind(el) {
    if (el.tagName === 'TEXTAREA') return 'textarea';
    if (el.classList.contains('ProseMirror')) return 'ProseMirror';
    if (el.hasAttribute('data-lexical-editor')) return 'Lexical';
    if (el.hasAttribute('data-slate-editor')) return 'Slate';
    if (el.classList.contains('ql-editor')) return 'Quill';
    if (el.classList.contains('cm-content')) return 'CodeMirror';
    if (el.isContentEditable) return 'contenteditable (неизвестный)';
    return el.getAttribute('role') || el.tagName.toLowerCase();
  }

  // Кандидаты в поле ввода. Сначала те, что внутри form, затем самые нижние на экране:
  // в ответах бывают редактируемые блоки кода с role=textbox, их нельзя принять за композер.
  function composerCandidates() {
    return [...document.querySelectorAll(GENERIC.input)].filter(isVisible)
      .map((el) => ({ el, f: el.closest('form') ? 1 : 0, y: el.getBoundingClientRect().bottom }))
      .sort((a, b) => b.f - a.f || b.y - a.y)
      .map((x) => x.el);
  }

  // Контейнер композера: ближайшая форма или предок, в котором есть кнопки.
  function composerBox(input) {
    const form = input.closest('form');
    if (form) return form;
    let cur = input.parentElement;
    for (let i = 0; cur && i < 8; i++, cur = cur.parentElement) {
      if (cur.querySelectorAll('button, [role="button"]').length >= 2) return cur;
    }
    return input.parentElement;
  }

  function composer() {
    return composerCandidates().map((el) => {
      const box = composerBox(el);
      const buttons = [...box.querySelectorAll('button, [role="button"], input[type="submit"]')]
        .filter(isVisible)
        .map((b) => describe(b, { geom: true, svg: true }));
      return {
        input: describe(el, { geom: true }),
        editor: editorKind(el),
        focused: document.activeElement === el,
        empty: (el.value ?? el.textContent).trim().length === 0, // только факт пустоты
        ancestors: ancestors(el),
        box: sig(box),
        buttons,
      };
    });
  }

  function count(sel) {
    try { return document.querySelectorAll(sel).length; } catch { return 'invalid'; }
  }

  function hypotheses() {
    const h = hyp();
    const out = {};
    for (const [k, list] of Object.entries(h)) {
      out[k] = list.map((sel) => {
        let first = null;
        try { first = document.querySelector(sel); } catch {}
        return { sel, count: count(sel), visible: first ? isVisible(first) : null };
      });
    }
    return out;
  }

  function richCounts(el) {
    const o = {};
    for (const [k, sel] of Object.entries(RICH)) { const n = el.querySelectorAll(sel).length; if (n) o[k] = n; }
    return o;
  }

  function attrNamesInSubtree(el, limit = 2000) {
    const names = {};
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT);
    let n = 0;
    for (let cur = el; cur && n < limit; cur = walker.nextNode(), n++) {
      for (const { name, value } of cur.attributes) {
        if (SKIP_ATTRS.has(name)) continue;
        if (!(name.startsWith('data-') || name.startsWith('aria-') || name === 'role')) continue;
        const v = STRUCT_ATTRS.has(name) ? clean(value) : R;
        const key = `${name}=${v}`;
        names[key] = (names[key] || 0) + 1;
      }
    }
    return names;
  }

  function messages() {
    const groups = {};
    const sels = [...new Set([...(hyp().answer || []), ...GENERIC.messages.split(', ')])];
    for (const sel of sels) {
      let list;
      try { list = [...document.querySelectorAll(sel)]; } catch { continue; }
      if (!list.length) continue;
      const last = list[list.length - 1];
      groups[sel] = {
        count: list.length,
        first: describe(list[0], { kids: true }),
        last: describe(last, { kids: true }),
        lastAncestors: ancestors(last, 12),
        lastRich: richCounts(last),
      };
    }
    return groups;
  }

  function landmarks() {
    return [...document.querySelectorAll(GENERIC.landmarks)].slice(0, 40).map((el) => ({
      sig: sig(el),
      rect: rect(el),
      visible: isVisible(el),
      depth: ancestors(el, 50).length,
      contains: {
        buttons: el.querySelectorAll('button, [role="button"]').length,
        links: el.querySelectorAll('a').length,
        inputs: el.querySelectorAll(GENERIC.input).length,
        lists: el.querySelectorAll('ul, ol, [role="list"]').length,
      },
    }));
  }

  // Сначала элементы вне навигации: в боковой панели их бывает больше лимита.
  function listDescribe(sel, geom = true) {
    return [...document.querySelectorAll(sel)]
      .sort((a, b) => inNav(a) - inNav(b))
      .slice(0, 30)
      .map((el) => ({ ...describe(el, { geom, svg: true }), inNav: inNav(el), ancestors: ancestors(el, 6) }));
  }

  function snapshot(label = '') {
    return {
      label,
      host: location.hostname,
      at: new Date().toISOString(),
      lang: document.documentElement.lang || null,
      visibility: document.visibilityState,
      viewport: [innerWidth, innerHeight],
      hypotheses: hypotheses(),
      composer: composer(),
      stopCandidates: listDescribe(GENERIC.stop),
      busy: listDescribe(GENERIC.busy),
      live: listDescribe(GENERIC.live),
      streaming: listDescribe(GENERIC.streaming, false),
      messages: messages(),
      popupTriggers: listDescribe(GENERIC.popupTriggers),
      menus: menus(),
      landmarks: landmarks(),
    };
  }

  function menus() {
    return [...document.querySelectorAll(GENERIC.menus)].filter(isVisible).slice(0, 5).map((m) => ({
      menu: describe(m, { geom: true }),
      ancestors: ancestors(m, 6),
      items: [...m.querySelectorAll('[role^="menuitem"], [role="option"], button, [role="radio"], [role="switch"]')]
        .slice(0, 40).map((i) => describe(i, { svg: true })),
    }));
  }

  // Реплики диалога: от «горячего» узла (или ответа по гипотезе) поднимаемся до уровня,
  // где у родителя несколько однотипных детей, и описываем эти соседние реплики.
  function turns(startSel) {
    let start = null;
    if (startSel) start = document.querySelector(startSel);
    if (!start && state.hot.length) start = state.hot[0].el;
    if (!start) for (const s of hyp().answer || []) { const l = document.querySelectorAll(s); if (l.length) { start = l[l.length - 1]; break; } }
    if (!start) return { error: 'нет стартового узла' };
    const main = start.closest('main, [role="main"]') || document.body;
    let best = null;
    for (let cur = start; cur && cur !== main; cur = cur.parentElement) {
      const p = cur.parentElement;
      if (!p) break;
      const same = [...p.children].filter((c) => c.tagName === cur.tagName);
      if (same.length >= 2) best = { el: cur, parent: p };
    }
    if (!best) return { error: 'уровень реплик не найден', from: sig(start), ancestors: ancestors(start) };
    const sibs = [...best.parent.children].slice(-8);
    return {
      parent: sig(best.parent),
      parentAncestors: ancestors(best.parent, 10),
      total: best.parent.childElementCount,
      last: sibs.map((s) => ({ self: describe(s, { kids: true }), rich: richCounts(s), attrs: attrNamesInSubtree(s), textLen: s.textContent.length })),
    };
  }

  // ---------- таймлайн ----------

  const state = { obs: null, timer: null, t0: 0, ticks: [], vis: [], heat: new Map(), hot: [] };

  // Короткий хеш строки (djb2) — чтобы отличать иконки по геометрии SVG, не сохраняя её.
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

  // Состояние кнопки без текста: отпечаток иконки и классы-состояния.
  function btnState(el) {
    if (!el) return null;
    const d = [...el.querySelectorAll('svg path, svg rect, svg circle')].map((p) => p.getAttribute('d') || p.tagName).join('|');
    const flags = [...el.classList].filter((c) => /disabled|loading|stop|active|selected|busy|generat/i.test(c));
    return `icon:${d ? hash(d) : '-'}${flags.length ? ' ' + flags.join(' ') : ''}${el.getAttribute('aria-disabled') ? ' aria-disabled=' + el.getAttribute('aria-disabled') : ''}${el.getAttribute('tabindex') != null ? ' tabindex' : ''}`;
  }

  function tick() {
    const h = hyp();
    const first = (list) => { for (const s of list || []) { try { const e = document.querySelector(s); if (e) return e; } catch {} } return null; };
    const sendEl = first(h.send);
    const inputs = composerCandidates();
    const box = inputs[0] ? composerBox(inputs[0]) : null;
    const lastBtn = box ? [...box.querySelectorAll('button, [role="button"]')].filter(isVisible).pop() : null;
    const answerSels = [...(h.answer || []), ...(CURRENT_ANSWER[location.hostname] || [])];
    let answers = [];
    for (const s of answerSels) { try { answers = [...document.querySelectorAll(s)]; } catch { answers = []; } if (answers.length) break; }
    const main = document.querySelector('main, [role="main"]') || document.body;
    // Сводка атрибутов состояния внутри main: «имя=значение×число», без радикс-меню (data-state=closed/open).
    const st = {};
    for (const el of main.querySelectorAll('*')) {
      for (const { name, value } of el.attributes) {
        if (!STATE_ATTR_RE.test(name) || name.startsWith('data-lt')) continue;
        if (name === 'data-state' && (value === 'closed' || value === 'open')) continue;
        const k = `${name}=${clean(value)}`;
        st[k] = (st[k] || 0) + 1;
      }
    }
    state.ticks.push({
      t: Math.round(performance.now() - state.t0),
      vis: document.visibilityState[0],
      send: sendEl ? sig(sendEl) + (sendEl.disabled || sendEl.getAttribute('aria-disabled') === 'true' ? ' (disabled)' : '') : null,
      lastBtn: lastBtn ? sig(lastBtn) + (lastBtn.disabled ? ' (disabled)' : '') + ` aria-label=${attrs(lastBtn)['aria-label'] ?? '-'} ${btnState(lastBtn)}` : null,
      stop: count(GENERIC.stop) + '/' + (h.stop || []).map(count).join(','),
      busy: count(GENERIC.busy),
      streaming: count(GENERIC.streaming),
      answers: answers.length,
      lastAnswerLen: answers.length ? answers[answers.length - 1].textContent.length : null,
      mainLen: main.textContent.length,
      stateAttrs: Object.entries(st).sort().map(([k, n]) => `${k}×${n}`).join(' '),
    });
  }

  function start(intervalMs = 250) {
    stop(true);
    state.t0 = performance.now();
    state.ticks = []; state.vis = []; state.heat = new Map(); state.hot = [];
    state.obs = new MutationObserver((recs) => {
      for (const r of recs) {
        const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        if (!el) continue;
        // Учитываем ближайший «блочный» предок, чтобы не мельчить до span.
        const block = el.closest('p, li, pre, td, th, h1, h2, h3, h4, div') || el;
        state.heat.set(block, (state.heat.get(block) || 0) + 1);
      }
    });
    state.obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-busy', 'aria-label', 'data-state', 'disabled', 'data-is-streaming', 'data-testid'] });
    state.onVis = () => state.vis.push({ t: Math.round(performance.now() - state.t0), v: document.visibilityState });
    document.addEventListener('visibilitychange', state.onVis);
    state.timer = setInterval(tick, intervalMs);
    tick();
    return 'recording';
  }

  // Общий предок самых горячих узлов поднимается до контейнера ответа.
  function hotSummary() {
    const top = [...state.heat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
    const byContainer = new Map();
    for (const [el, n] of top) {
      // Контейнер: предок с разметкой ответа (markdown/prose/гипотеза) или 4 уровня вверх.
      let c = el.closest('.ds-markdown, .font-claude-message, [data-message-author-role], .markdown, .prose');
      if (!c) { c = el; for (let i = 0; i < 4 && c.parentElement; i++) c = c.parentElement; }
      byContainer.set(c, (byContainer.get(c) || 0) + n);
    }
    state.hot = [...byContainer.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([el, n]) => ({ el, n }));
    return state.hot.map(({ el, n }) => ({ mutations: n, node: describe(el, { kids: true }), ancestors: ancestors(el, 14), rich: richCounts(el) }));
  }

  function stop(silent = false) {
    if (state.timer) clearInterval(state.timer);
    if (state.obs) state.obs.disconnect();
    if (state.onVis) document.removeEventListener('visibilitychange', state.onVis);
    const was = !!state.timer;
    state.timer = null; state.obs = null; state.onVis = null;
    if (silent || !was) return null;
    tick();
    // Сжимаем таймлайн: оставляем тики, где что-то изменилось (кроме длины текста).
    const key = (x) => [x.vis, x.send, x.lastBtn, x.stop, x.busy, x.streaming, x.answers, x.stateAttrs].join('|');
    const changes = state.ticks.filter((x, i, a) => i === 0 || i === a.length - 1 || key(x) !== key(a[i - 1]));
    const lens = state.ticks.map((x) => [x.t, x.vis, x.lastAnswerLen, x.mainLen]);
    const gaps = state.ticks.slice(1).map((x, i) => x.t - state.ticks[i].t);
    return {
      durationMs: state.ticks.length ? state.ticks[state.ticks.length - 1].t : 0,
      ticks: state.ticks.length,
      maxGapMs: gaps.length ? Math.max(...gaps) : 0,
      visibility: state.vis,
      changes,
      // Длины для анализа фоновой вкладки: [t, видимость, длина ответа, длина main]
      lengths: lens.filter((x, i) => i % 4 === 0 || i === lens.length - 1),
      hot: hotSummary(),
    };
  }

  async function env() {
    const ua = navigator.userAgentData;
    let brands = null;
    if (ua?.getHighEntropyValues) {
      try { brands = (await ua.getHighEntropyValues(['fullVersionList', 'platform'])).fullVersionList; } catch {}
    }
    return { userAgent: navigator.userAgent, brands, navigatorLang: navigator.language, docLang: document.documentElement.lang };
  }

  window.AIHubRecon = { snapshot, start, stop, turns, menus, env, version: 3 };
  return 'AIHubRecon v3 ready';
})();
