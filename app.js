'use strict';

/* ---------- Helpers ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const STORE_KEY = 'vokabeln.v1';
const PREFS_KEY = 'vokabeln.prefs';
const DAY = 86400000;
const BOX_DAYS = [0, 1, 2, 4, 8, 16]; // Leitner intervals per box
const TYPE_LABEL = { noun: 'Nomen', verb: 'Verb', adj: 'Adjektiv', other: 'Sonstige' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (iso) => new Date(iso + 'T00:00:00');
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); };
const norm = (s) => String(s ?? '').toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function startOfWeek() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d.getTime();
}

function formatLongDate(iso) {
  return parseISO(iso).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}
function formatShortDate(iso) {
  return parseISO(iso).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
}
function dayLabel(iso) {
  if (iso === isoDate()) return 'Heute';
  if (iso === daysAgo(1)) return 'Gestern';
  return formatLongDate(iso);
}

/* ---------- Example data ---------- */
function seedWords() {
  const raw = [
    ['Tisch', 'noun', 'der', 'die Tische', 'la mesa', 'Das Buch liegt auf dem Tisch.', 'Wohnen', 8, true],
    ['Lampe', 'noun', 'die', 'die Lampen', 'la lámpara', 'Die Lampe ist kaputt.', 'Wohnen', 8, true],
    ['Fenster', 'noun', 'das', 'die Fenster', 'la ventana', 'Kannst du bitte das Fenster öffnen?', 'Wohnen', 8, false],
    ['Wohnung', 'noun', 'die', 'die Wohnungen', 'el piso, el apartamento', 'Meine Wohnung ist klein, aber hell.', 'Wohnen', 8, false],
    ['Schlüssel', 'noun', 'der', 'die Schlüssel', 'la llave', 'Ich finde meinen Schlüssel nicht.', 'Wohnen', 8, true],
    ['gemütlich', 'adj', '', '', 'acogedor', 'Das Café ist sehr gemütlich.', 'Wohnen', 8, false],
    ['Bahnhof', 'noun', 'der', 'die Bahnhöfe', 'la estación de tren', 'Wir treffen uns am Bahnhof.', 'Reisen', 3, false],
    ['pünktlich', 'adj', '', '', 'puntual', 'Der Zug ist heute pünktlich.', 'Reisen', 3, false],
    ['Brötchen', 'noun', 'das', 'die Brötchen', 'el panecillo', 'Zum Frühstück esse ich ein Brötchen.', 'Alltag', 1, false],
    ['Rechnung', 'noun', 'die', 'die Rechnungen', 'la cuenta, la factura', 'Die Rechnung, bitte!', 'Alltag', 1, false],
    ['Wetter', 'noun', 'das', '', 'el tiempo (clima)', 'Wie ist das Wetter heute?', 'Alltag', 1, false],
    ['aufräumen', 'verb', '', '', 'ordenar, recoger', 'Am Samstag räume ich mein Zimmer auf.', 'Alltag', 1, false],
    ['trotzdem', 'other', '', '', 'sin embargo, aun así', 'Es regnet, trotzdem gehen wir spazieren.', 'Alltag', 1, false],
    ['sich verabreden', 'verb', '', '', 'quedar (con alguien)', 'Ich habe mich mit Anna verabredet.', 'Freizeit', 0, false],
    ['vermissen', 'verb', '', '', 'echar de menos', 'Ich vermisse meine Familie.', 'Freizeit', 0, false],
  ];
  const now = Date.now();
  return raw.map(([word, type, article, pl, translation, example, topic, ago, learned], i) => ({
    id: uid(), word, type, article, plural: pl, translation, example, topic,
    date: daysAgo(ago), createdAt: now - ago * DAY + i * 1000,
    learned, isExample: true, srs: { box: learned ? 3 : 0, due: 0, right: 0, wrong: 0 },
  }));
}

/* ---------- State & storage ---------- */
const state = {
  words: [],
  filter: { q: '', type: 'all', topic: 'all', date: 'all' },
  prefs: { theme: 'auto', hideLearned: false, dir: 'de-es', lastTopic: '', lastTopicDay: '' },
};

function load() {
  try { Object.assign(state.prefs, JSON.parse(localStorage.getItem(PREFS_KEY)) || {}); } catch {}
  let raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch {}
  if (raw === null) {
    state.words = seedWords();
    save();
  } else {
    try { state.words = (JSON.parse(raw).words || []).map(sanitize).filter(Boolean); }
    catch { state.words = []; }
  }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, words: state.words })); }
  catch { toast('Speichern fehlgeschlagen – Speicher voll?'); }
}
function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch {}
}

function sanitize(w) {
  if (!w || typeof w.word !== 'string' || !w.word.trim()) return null;
  const type = TYPE_LABEL[w.type] ? w.type : 'other';
  return {
    id: typeof w.id === 'string' && w.id ? w.id : uid(),
    word: w.word.trim(),
    type,
    article: type === 'noun' && ['der', 'die', 'das'].includes(w.article) ? w.article : '',
    plural: type === 'noun' ? String(w.plural || '').trim() : '',
    translation: String(w.translation || '').trim(),
    example: String(w.example || '').trim(),
    topic: String(w.topic || '').trim(),
    date: /^\d{4}-\d{2}-\d{2}$/.test(w.date) ? w.date : isoDate(new Date(w.createdAt || Date.now())),
    createdAt: Number(w.createdAt) || Date.now(),
    learned: !!w.learned,
    isExample: !!w.isExample,
    srs: {
      box: Math.min(5, Math.max(0, Number(w.srs?.box) || 0)),
      due: Number(w.srs?.due) || 0,
      right: Number(w.srs?.right) || 0,
      wrong: Number(w.srs?.wrong) || 0,
    },
  };
}

/* ---------- Filtering ---------- */
function matches(w) {
  const f = state.filter;
  if (f.type !== 'all' && w.type !== f.type) return false;
  if (f.topic === '__none' ? w.topic : f.topic !== 'all' && w.topic !== f.topic) return false;
  if (f.date === 'today' && w.date !== isoDate()) return false;
  if (f.date === 'week' && parseISO(w.date).getTime() < startOfWeek()) return false;
  if (/^\d{4}/.test(f.date) && w.date !== f.date) return false;
  if (f.q) {
    const hay = norm([w.article, w.word, w.plural, w.translation, w.example, w.topic].join(' '));
    return norm(f.q).split(/\s+/).every((t) => hay.includes(t));
  }
  return true;
}
const filtered = () => state.words.filter(matches);
const filtersActive = () => { const f = state.filter; return f.q || f.type !== 'all' || f.topic !== 'all' || f.date !== 'all'; };

/* ---------- Rendering ---------- */
function deHTML(w, withPlural = false) {
  const art = w.type === 'noun' && w.article ? `<span class="art art-${w.article}">${w.article}</span> ` : '';
  const pl = withPlural && w.plural ? ` <span class="plural">· ${esc(w.plural)}</span>` : '';
  return `${art}${esc(w.word)}${pl}`;
}

const CHECK_SVG = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function rowHTML(w) {
  const sub = [
    w.translation ? esc(w.translation) : '<em>Übersetzung fehlt</em>',
    w.topic ? `<span class="topic">· ${esc(w.topic)}</span>` : '',
  ].join(' ');
  return `
    <div class="word${w.learned ? ' learned' : ''}" data-id="${w.id}" role="button" tabindex="0">
      <button class="check" data-act="toggle" aria-label="${w.learned ? 'Als nicht gelernt markieren' : 'Als gelernt markieren'}">${CHECK_SVG}</button>
      <div class="word-body">
        <div class="word-main">${deHTML(w, true)}${w.isExample ? '<span class="tag">Beispiel</span>' : ''}</div>
        <div class="word-sub">${sub}</div>
      </div>
    </div>`;
}

function render() {
  renderStats();
  renderFilters();
  renderList();
}

function renderStats() {
  const total = state.words.length;
  const learned = state.words.filter((w) => w.learned).length;
  const week = state.words.filter((w) => w.createdAt >= startOfWeek()).length;
  const pct = total ? Math.round((learned / total) * 100) : 0;
  const c = 2 * Math.PI * 27;
  const ring = $('#ringValue');
  ring.style.strokeDasharray = c;
  ring.style.strokeDashoffset = c * (1 - pct / 100);
  $('#ringLabel').textContent = pct + '%';
  if (!total) {
    $('#heroTitle').textContent = 'Noch keine Wörter';
    $('#heroSub').textContent = 'Tippe unten auf +';
  } else {
    $('#heroTitle').textContent = `${learned} von ${plural(total, 'Wort', 'Wörtern')} gelernt`;
    $('#heroSub').textContent = `Diese Woche: ${week} neu · ${total - learned} offen`;
  }
}

function renderFilters() {
  const f = state.filter;
  $$('#chips [data-type]').forEach((b) => b.classList.toggle('on', b.dataset.type === f.type));

  const topics = [...new Set(state.words.map((w) => w.topic).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  const hasNoTopic = state.words.some((w) => !w.topic);
  if (f.topic !== 'all' && f.topic !== '__none' && !topics.includes(f.topic)) f.topic = 'all';
  $('#topicFilter').innerHTML = [`<option value="all">Alle Themen</option>`,
    ...topics.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`),
    hasNoTopic ? `<option value="__none">Ohne Thema</option>` : ''].join('');
  $('#topicFilter').value = f.topic;
  $('#topicChip span').textContent = f.topic === 'all' ? 'Thema' : f.topic === '__none' ? 'Ohne Thema' : f.topic;
  $('#topicChip').classList.toggle('on', f.topic !== 'all');

  const dates = [...new Set(state.words.map((w) => w.date))].sort().reverse();
  if (/^\d{4}/.test(f.date) && !dates.includes(f.date)) f.date = 'all';
  $('#dateFilter').innerHTML = [`<option value="all">Alle Daten</option>`, `<option value="today">Heute</option>`, `<option value="week">Diese Woche</option>`,
    ...dates.map((d) => `<option value="${d}">${formatShortDate(d)}</option>`)].join('');
  $('#dateFilter').value = f.date;
  const dateText = { all: 'Datum', today: 'Heute', week: 'Diese Woche' }[f.date] || formatShortDate(f.date);
  $('#dateChip span').textContent = dateText;
  $('#dateChip').classList.toggle('on', f.date !== 'all');

  $('#topicList').innerHTML = topics.map((t) => `<option value="${esc(t)}">`).join('');
}

function renderList() {
  const list = $('#list');
  const words = filtered();
  if (!state.words.length) {
    list.innerHTML = `<div class="empty"><strong>Dein Vokabelheft ist leer</strong>Tippe auf „Wort hinzufügen“, um loszulegen.</div>`;
    return;
  }
  if (!words.length) {
    list.innerHTML = `<div class="empty"><strong>Nichts gefunden</strong>Versuche einen anderen Suchbegriff oder Filter.</div>`;
    return;
  }
  const open = words.filter((w) => !w.learned);
  const learned = words.filter((w) => w.learned).sort((a, b) => b.createdAt - a.createdAt);

  // group open words by lesson date, newest first
  const groups = new Map();
  open.sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1))
    .forEach((w) => { if (!groups.has(w.date)) groups.set(w.date, []); groups.get(w.date).push(w); });

  let html = '';
  for (const [date, ws] of groups) {
    html += `<div class="section-head"><h3>${esc(dayLabel(date))}<span class="count">${ws.length}</span></h3></div>`;
    html += ws.map(rowHTML).join('');
  }
  if (!open.length) html += `<div class="empty"><strong>Alles gelernt! 🎉</strong>Füge neue Wörter aus dem Unterricht hinzu.</div>`;
  if (learned.length) {
    html += `<div class="section-head"><h3>Gelernt<span class="count">${learned.length}</span></h3>
      <button data-act="toggle-learned">${state.prefs.hideLearned ? 'Anzeigen' : 'Ausblenden'}</button></div>`;
    if (!state.prefs.hideLearned) html += learned.map(rowHTML).join('');
  }
  list.innerHTML = html;
}

/* ---------- Overlays ---------- */
function openOverlay(el) {
  el.hidden = false;
  document.documentElement.classList.add('locked');
}
function closeOverlay(el) {
  el.hidden = true;
  if (!$$('.overlay').some((o) => !o.hidden)) document.documentElement.classList.remove('locked');
}
$$('.overlay').forEach((ov) => {
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-close]')) closeOverlay(ov);
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const top = $$('.overlay').filter((o) => !o.hidden).pop();
  if (top) closeOverlay(top);
});

/* ---------- Toast ---------- */
let toastTimer;
function toast(text, actionLabel, onAction) {
  const t = $('#toast'), btn = $('#toastAction');
  $('#toastText').textContent = text;
  btn.hidden = !actionLabel;
  btn.textContent = actionLabel || '';
  btn.onclick = () => { t.hidden = true; onAction && onAction(); };
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), actionLabel ? 5000 : 2200);
}

/* ---------- Add / edit sheet ---------- */
const form = $('#wordForm');
let editingId = null;
let typeTouched = false;
let currentType = '';
let currentArticle = '';

function setType(t) {
  currentType = t;
  $$('#fType button').forEach((b) => b.classList.toggle('on', b.dataset.v === t));
  $('#nounFields').hidden = t !== 'noun';
}
function setArticle(a) {
  currentArticle = a;
  $$('#fArticle button').forEach((b) => b.classList.toggle('on', b.dataset.v === a));
}

function defaultTopic() {
  return state.prefs.lastTopicDay === isoDate() ? state.prefs.lastTopic : '';
}

function openWordSheet(word) {
  editingId = word ? word.id : null;
  form.classList.toggle('editing', !!word);
  $('#wordSheetTitle').textContent = word ? 'Wort bearbeiten' : 'Neues Wort';
  $('#formError').hidden = true;
  $('#fWord').value = word ? word.word : '';
  $('#fPlural').value = word ? word.plural : '';
  $('#fTrans').value = word ? word.translation : '';
  $('#fExample').value = word ? word.example : '';
  $('#fTopic').value = word ? word.topic : defaultTopic();
  $('#fDate').value = word ? word.date : isoDate();
  $('#fLearned').checked = word ? word.learned : false;
  typeTouched = !!word;
  setType(word ? word.type : '');
  setArticle(word ? word.article : '');
  openOverlay($('#wordOverlay'));
  if (!word) $('#fWord').focus(); // must stay synchronous for iOS to show the keyboard
}

// Smart guess while typing: "der Hund" → Nomen + der; capitalised → Nomen; "-en" → Verb
$('#fWord').addEventListener('input', () => {
  const v = $('#fWord').value.trim();
  const m = v.match(/^(der|die|das)\s+\S/i);
  if (m) {
    setType('noun');
    setArticle(m[1].toLowerCase());
    return;
  }
  if (typeTouched) return;
  if (/^[A-ZÄÖÜ]/.test(v)) setType('noun');
  else if (/^[a-zäöüß ]+(en|ern|eln)$/.test(v) && v.length > 3) setType('verb');
  else setType('');
});

$('#fType').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  typeTouched = true;
  setType(currentType === b.dataset.v ? '' : b.dataset.v);
});
$('#fArticle').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  setArticle(currentArticle === b.dataset.v ? '' : b.dataset.v);
});

function readForm() {
  let word = $('#fWord').value.trim().replace(/\s+/g, ' ');
  let type = currentType || 'other';
  let article = currentArticle;
  const m = word.match(/^(der|die|das)\s+(.+)$/i);
  if (m) { type = 'noun'; article = m[1].toLowerCase(); word = m[2]; }
  if (type === 'noun' && word) word = word[0].toUpperCase() + word.slice(1);
  return {
    word, type,
    article: type === 'noun' ? article : '',
    plural: type === 'noun' ? $('#fPlural').value.trim() : '',
    translation: $('#fTrans').value.trim(),
    example: $('#fExample').value.trim(),
    topic: $('#fTopic').value.trim(),
    date: $('#fDate').value || isoDate(),
    learned: $('#fLearned').checked,
  };
}

function saveWord() {
  const data = readForm();
  if (!data.word) {
    $('#formError').textContent = 'Bitte ein deutsches Wort eingeben.';
    $('#formError').hidden = false;
    $('#fWord').focus();
    return false;
  }
  if (editingId) {
    const w = state.words.find((x) => x.id === editingId);
    Object.assign(w, data, { isExample: w.isExample && w.word === data.word });
  } else {
    state.words.push(sanitize({ ...data, id: uid(), createdAt: Date.now(), learned: false }));
  }
  if (data.topic) Object.assign(state.prefs, { lastTopic: data.topic, lastTopicDay: isoDate() });
  else if (!editingId) Object.assign(state.prefs, { lastTopic: '', lastTopicDay: '' });
  savePrefs();
  save();
  render();
  return true;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!editingId && !$('#fWord').value.trim()) return closeOverlay($('#wordOverlay'));
  if (saveWord()) {
    closeOverlay($('#wordOverlay'));
    toast(editingId ? 'Änderungen gespeichert' : 'Wort gespeichert');
  }
});

function saveAndNext() {
  const name = readForm().word;
  if (!saveWord()) return;
  toast(`„${name}“ gespeichert`);
  ['#fWord', '#fPlural', '#fTrans', '#fExample'].forEach((s) => ($(s).value = ''));
  typeTouched = false;
  setType('');
  setArticle('');
  $('#formError').hidden = true;
  $('#fWord').focus();
}
$('#saveNextBtn').addEventListener('click', saveAndNext);

// Return key flow: Wort → Übersetzung → speichern
form.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
  e.preventDefault();
  const id = e.target.id;
  if (id === 'fWord') (currentType === 'noun' ? $('#fPlural') : $('#fTrans')).focus();
  else if (id === 'fPlural') $('#fTrans').focus();
  else if (editingId) form.requestSubmit();
  else saveAndNext();
});

$('#deleteBtn').addEventListener('click', () => {
  const idx = state.words.findIndex((w) => w.id === editingId);
  if (idx < 0) return;
  const [removed] = state.words.splice(idx, 1);
  save(); render();
  closeOverlay($('#wordOverlay'));
  toast(`„${removed.word}“ gelöscht`, 'Rückgängig', () => {
    state.words.splice(idx, 0, removed); save(); render();
  });
});

/* ---------- List interactions ---------- */
$('#list').addEventListener('click', (e) => {
  if (e.target.closest('[data-act="toggle-learned"]')) {
    state.prefs.hideLearned = !state.prefs.hideLearned;
    savePrefs(); renderList();
    return;
  }
  const row = e.target.closest('.word'); if (!row) return;
  const w = state.words.find((x) => x.id === row.dataset.id); if (!w) return;
  if (e.target.closest('[data-act="toggle"]')) {
    w.learned = !w.learned;
    save(); render();
    if (w.learned) toast(`„${w.word}“ gelernt`, 'Rückgängig', () => { w.learned = false; save(); render(); });
    return;
  }
  openWordSheet(w);
});
$('#list').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('word')) e.target.click();
});

/* ---------- Search & filters ---------- */
$('#search').addEventListener('input', (e) => { state.filter.q = e.target.value.trim(); renderList(); });
$('#search').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-type]'); if (!b) return;
  state.filter.type = state.filter.type === b.dataset.type ? 'all' : b.dataset.type;
  renderFilters(); renderList();
});
$('#topicFilter').addEventListener('change', (e) => { state.filter.topic = e.target.value; renderFilters(); renderList(); });
$('#dateFilter').addEventListener('change', (e) => { state.filter.date = e.target.value; renderFilters(); renderList(); });

/* ---------- Review (Leitner flashcards) ---------- */
const review = { queue: [], pos: 0, firstTry: new Map(), revealed: false };

function pickDir() {
  const d = state.prefs.dir;
  return d === 'mix' ? (Math.random() < 0.5 ? 'de-es' : 'es-de') : d;
}

function buildQueue() {
  let pool = (filtersActive() ? filtered() : state.words).filter((w) => w.translation);
  const open = pool.filter((w) => !w.learned);
  if (open.length) pool = open;
  const now = Date.now();
  const rnd = new Map(pool.map((w) => [w.id, Math.random()]));
  // due first, then lower box, then words with more mistakes, then random
  pool.sort((a, b) =>
    (b.srs.due <= now) - (a.srs.due <= now) ||
    a.srs.box - b.srs.box ||
    b.srs.wrong - a.srs.wrong ||
    rnd.get(a.id) - rnd.get(b.id));
  review.queue = pool.slice(0, 20).map((w) => ({ id: w.id, dir: pickDir(), misses: 0 }));
  review.pos = 0;
  review.firstTry = new Map();
}

function openReview() {
  buildQueue();
  if (!review.queue.length) {
    toast('Keine Wörter mit Übersetzung zum Lernen');
    return;
  }
  setDirUI();
  openOverlay($('#reviewOverlay'));
  showCard();
}

function setDirUI() {
  $$('#dirSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.prefs.dir));
}

function showCard() {
  const total = review.queue.length;
  $('#reviewBar').style.width = `${(review.pos / total) * 100}%`;
  $('#reviewCount').textContent = `${Math.min(review.pos + 1, total)}/${total}`;
  const done = review.pos >= total;
  $('#flashcard').hidden = done;
  $('#reviewDone').hidden = !done;
  $('#revealBtn').hidden = done;
  $('#answerBtns').hidden = true;
  $('#doneBtns').hidden = !done;
  $('#dirSeg').hidden = done;
  if (done) return showDone();

  const card = review.queue[review.pos];
  const w = state.words.find((x) => x.id === card.id);
  if (!w) { review.pos++; return showCard(); }
  review.revealed = false;
  const fc = $('#flashcard');
  fc.classList.remove('revealed');
  fc.classList.remove('pop'); void fc.offsetWidth; fc.classList.add('pop');

  const extras = [];
  if (w.plural) extras.push(`<span class="fc-extra">Plural: ${esc(w.plural)}</span>`);
  if (w.type !== 'noun') extras.push(`<span class="fc-extra">${TYPE_LABEL[w.type]}</span>`);
  if (w.example) extras.push(`<span class="fc-example">„${esc(w.example)}“</span>`);

  if (card.dir === 'de-es') {
    $('#fcLang').textContent = 'Deutsch → Spanisch';
    $('#fcFront').innerHTML = deHTML(w);
    $('#fcBack').innerHTML = `<span class="fc-answer">${esc(w.translation)}</span>${extras.join('')}`;
  } else {
    $('#fcLang').textContent = 'Spanisch → Deutsch';
    $('#fcFront').textContent = w.translation;
    $('#fcBack').innerHTML = `<span class="fc-answer">${deHTML(w)}</span>${extras.join('')}`;
  }
}

function reveal() {
  if (review.revealed || review.pos >= review.queue.length) return;
  review.revealed = true;
  $('#flashcard').classList.add('revealed');
  $('#revealBtn').hidden = true;
  $('#answerBtns').hidden = false;
}

function answer(right) {
  if (!review.revealed) return;
  const card = review.queue[review.pos];
  const w = state.words.find((x) => x.id === card.id);
  if (w) {
    if (!review.firstTry.has(w.id)) review.firstTry.set(w.id, right);
    if (right) {
      w.srs.box = Math.min(5, w.srs.box + 1);
      w.srs.right++;
      w.srs.due = Date.now() + BOX_DAYS[w.srs.box] * DAY;
    } else {
      w.srs.box = 0;
      w.srs.wrong++;
      w.srs.due = 0;
      // missed words come back a few cards later in this session
      if (card.misses < 3) {
        const at = Math.min(review.pos + 3, review.queue.length);
        review.queue.splice(at, 0, { ...card, misses: card.misses + 1 });
      }
    }
    save();
  }
  review.pos++;
  showCard();
}

function showDone() {
  const total = review.firstTry.size;
  const right = [...review.firstTry.values()].filter(Boolean).length;
  $('#reviewBar').style.width = '100%';
  $('#reviewCount').textContent = '';
  $('#doneTitle').textContent = right === total ? 'Perfekt!' : 'Geschafft!';
  $('#doneText').textContent = `${right} von ${plural(total, 'Wort', 'Wörtern')} auf Anhieb gewusst.`;
  render();
}

$('#flashcard').addEventListener('click', reveal);
$('#revealBtn').addEventListener('click', reveal);
$('#rightBtn').addEventListener('click', () => answer(true));
$('#wrongBtn').addEventListener('click', () => answer(false));
$('#againBtn').addEventListener('click', () => { buildQueue(); showCard(); });
$('#dirSeg').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state.prefs.dir = b.dataset.v; savePrefs(); setDirUI();
  review.queue.slice(review.pos).forEach((c) => (c.dir = pickDir()));
  showCard();
});
document.addEventListener('keydown', (e) => {
  if ($('#reviewOverlay').hidden) return;
  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); review.revealed ? answer(true) : reveal(); }
  if (e.key === 'ArrowRight') answer(true);
  if (e.key === 'ArrowLeft') answer(false);
});

/* ---------- Menu: export / import / theme ---------- */
const THEMES = { auto: 'Automatisch', light: 'Hell', dark: 'Dunkel' };
function applyTheme() {
  const t = state.prefs.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  $('#themeLabel').textContent = THEMES[t];
  const bg = getComputedStyle(document.body).backgroundColor;
  $$('meta[name="theme-color"]').forEach((m) => {
    if (t === 'auto') m.content = m.media.includes('dark') ? '#000000' : '#FFFFFF';
    else m.content = bg;
  });
}

function openMenu() {
  $('#removeExamplesBtn').hidden = !state.words.some((w) => w.isExample);
  openOverlay($('#menuOverlay'));
}

async function exportData() {
  const name = `vokabeln-${isoDate()}.json`;
  const json = JSON.stringify({ app: 'vokabeln', version: 1, exportedAt: new Date().toISOString(), words: state.words }, null, 2);
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Vokabeln Backup' }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Backup „${name}“ exportiert`);
}

async function importData(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = (Array.isArray(parsed) ? parsed : parsed.words || []).map(sanitize).filter(Boolean);
    if (!incoming.length) throw new Error('empty');
    const byId = new Map(state.words.map((w) => [w.id, w]));
    let added = 0, updated = 0;
    for (const w of incoming) {
      if (byId.has(w.id)) { Object.assign(byId.get(w.id), w); updated++; }
      else { state.words.push(w); added++; }
    }
    save(); render();
    toast(`${added} neu, ${updated} aktualisiert`);
  } catch {
    toast('Datei konnte nicht gelesen werden');
  }
}

$('#menuBtn').addEventListener('click', openMenu);
$('#exportBtn').addEventListener('click', () => { closeOverlay($('#menuOverlay')); exportData(); });
$('#importBtn').addEventListener('click', () => { closeOverlay($('#menuOverlay')); $('#importFile').click(); });
$('#importFile').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (f) importData(f);
  e.target.value = '';
});
$('#themeBtn').addEventListener('click', () => {
  const order = Object.keys(THEMES);
  state.prefs.theme = order[(order.indexOf(state.prefs.theme) + 1) % order.length];
  savePrefs(); applyTheme();
});
$('#removeExamplesBtn').addEventListener('click', () => {
  const before = state.words;
  state.words = state.words.filter((w) => !w.isExample);
  save(); render();
  closeOverlay($('#menuOverlay'));
  toast('Beispielwörter entfernt', 'Rückgängig', () => { state.words = before; save(); render(); });
});

/* ---------- Bottom bar ---------- */
$('#quickAdd').addEventListener('click', () => openWordSheet());
$('#addBtn').addEventListener('click', () => openWordSheet());
$('#learnBtn').addEventListener('click', openReview);

/* ---------- Start ---------- */
load();
applyTheme();
$('#todayLabel').textContent = formatLongDate(isoDate());
render();

// Shortcuts: index.html#neu or #lernen
if (location.hash === '#neu') openWordSheet();
if (location.hash === '#lernen') openReview();
if (location.hash) history.replaceState(null, '', location.pathname + location.search);

// Refresh "Heute"/"Gestern" labels when the app comes back the next day
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { $('#todayLabel').textContent = formatLongDate(isoDate()); render(); }
});

if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
