import './style.css';
import * as face from './face.js';
import * as store from './store.js';

const ENROLL_SAMPLES = 5;
const ENROLL_INTERVAL_MS = 300;
const ENROLL_TIMEOUT_MS = 20000;
const MAX_SAMPLES_PER_PERSON = 30;
const LOG_GAP_MS = 30000; // log a person again only after this long out of view
const LOG_LIMIT = 200;

const $ = (sel) => document.querySelector(sel);

const state = {
  people: store.loadPeople(),
  settings: store.loadSettings(),
  modelsReady: false,
  matcher: null,
  camera: { stream: null, running: false, loopId: 0, mirror: true },
  enroll: null,
  log: [],
  lastSeen: new Map(),
  photo: null, // { results }
};

const els = {
  status: $('#status'),
  peopleCount: $('#people-count'),
  settings: $('#settings'),
  settingsSummary: $('#settings-summary'),
  detector: $('#set-detector'),
  threshold: $('#set-threshold'),
  thresholdValue: $('#threshold-value'),
  camViewport: $('#cam-viewport'),
  video: $('#video'),
  camOverlay: $('#cam-overlay'),
  camPlaceholder: $('#cam-placeholder'),
  cameraPanel: $('#tab-camera'),
  cameraPanel: $('#tab-camera'),
  btnCamera: $('#btn-camera'),
  btnFullscreen: $('#btn-fullscreen'),
  btnExitFullscreen: $('#btn-exit-fullscreen'),
  cameraSelect: $('#camera-select'),
  cameraMsg: $('#camera-msg'),
  fps: $('#fps'),
  enrollForm: $('#enroll-form'),
  enrollName: $('#enroll-name'),
  btnEnroll: $('#btn-enroll'),
  enrollProgress: $('#enroll-progress'),
  enrollMsg: $('#enroll-msg'),
  log: $('#log'),
  logEmpty: $('#log-empty'),
  btnLogCsv: $('#btn-log-csv'),
  btnLogClear: $('#btn-log-clear'),
  dropzone: $('#dropzone'),
  photoInput: $('#photo-input'),
  photoViewport: $('#photo-viewport'),
  photoImg: $('#photo-img'),
  photoOverlay: $('#photo-overlay'),
  photoMsg: $('#photo-msg'),
  photoFaces: $('#photo-faces'),
  photoEmpty: $('#photo-empty'),
  people: $('#people'),
  peopleEmpty: $('#people-empty'),
  peopleMsg: $('#people-msg'),
  btnExport: $('#btn-export'),
  importInput: $('#import-input'),
  btnClearAll: $('#btn-clear-all'),
};

/* ---------- helpers ---------- */

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of [].concat(children)) {
    if (child != null) node.append(child);
  }
  return node;
}

function setMsg(node, text, kind = '') {
  node.textContent = text;
  node.dataset.kind = kind;
}

const personById = (id) => state.people.find((p) => p.id === id);
const similarity = (distance) => Math.round(Math.max(0, 1 - distance) * 100);
const formatTime = (ts) =>
  new Date(ts).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'medium' });

function avatar(person, className = 'avatar') {
  if (person?.thumb) return el('img', { className, src: person.thumb, alt: '' });
  const initials = (person?.name ?? '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return el('span', { className: `${className} avatar--initials`, textContent: initials });
}

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- people database ---------- */

function commitPeople(people) {
  try {
    store.savePeople(people);
  } catch {
    return false;
  }
  state.people = people;
  state.matcher = face.createMatcher(state.people, state.settings.threshold);
  renderPeople();
  refreshPhotoMatches();
  return true;
}

/** Adds descriptors to the person with this name, creating them if needed. */
function addSamples(name, descriptors, thumb) {
  const clean = name.trim();
  const key = clean.toLocaleLowerCase('id');
  const existing = state.people.find((p) => p.name.toLocaleLowerCase('id') === key);
  const samples = descriptors.map((d) => Array.from(d));
  let people;
  if (existing) {
    const updated = {
      ...existing,
      descriptors: [...existing.descriptors, ...samples].slice(-MAX_SAMPLES_PER_PERSON),
      thumb: existing.thumb || thumb,
    };
    people = state.people.map((p) => (p.id === existing.id ? updated : p));
  } else {
    people = [...state.people, { id: store.newId(), name: clean, descriptors: samples, thumb, createdAt: Date.now() }];
  }
  if (!commitPeople(people)) return null;
  return { added: !existing, person: people.find((p) => p.name.toLocaleLowerCase('id') === key) };
}

function renderPeople() {
  els.peopleCount.textContent = String(state.people.length);
  els.peopleEmpty.hidden = state.people.length > 0;
  els.btnExport.disabled = state.people.length === 0;
  els.btnClearAll.disabled = state.people.length === 0;
  const sorted = [...state.people].sort((a, b) => a.name.localeCompare(b.name, 'id'));
  els.people.replaceChildren(
    ...sorted.map((p) =>
      el('li', { className: 'person' }, [
        avatar(p, 'avatar avatar--lg'),
        el('div', { className: 'person__info' }, [
          el('strong', { textContent: p.name }),
          el('small', {
            className: 'muted',
            textContent: `${p.descriptors.length} sampel · ${new Date(p.createdAt).toLocaleDateString('id-ID')}`,
          }),
        ]),
        el('div', { className: 'row row--tight' }, [
          el('button', {
            className: 'btn btn--ghost btn--sm',
            textContent: 'Ubah nama',
            onclick: () => renamePerson(p.id),
          }),
          el('button', {
            className: 'btn btn--danger btn--sm',
            textContent: 'Hapus',
            onclick: () => deletePerson(p.id),
          }),
        ]),
      ]),
    ),
  );
}

function renamePerson(id) {
  const person = personById(id);
  const name = prompt('Nama baru:', person.name)?.trim();
  if (!name || name === person.name) return;
  const clash = state.people.find((p) => p.id !== id && p.name.toLocaleLowerCase('id') === name.toLocaleLowerCase('id'));
  if (clash) {
    setMsg(els.peopleMsg, `Nama "${name}" sudah dipakai.`, 'error');
    return;
  }
  commitPeople(state.people.map((p) => (p.id === id ? { ...p, name } : p)));
  setMsg(els.peopleMsg, `Nama diubah menjadi "${name}".`, 'ok');
}

function deletePerson(id) {
  const person = personById(id);
  if (!confirm(`Hapus "${person.name}" dari database?`)) return;
  commitPeople(state.people.filter((p) => p.id !== id));
  state.lastSeen.delete(id);
  setMsg(els.peopleMsg, `"${person.name}" dihapus.`, 'ok');
}

els.btnClearAll.addEventListener('click', () => {
  if (!confirm('Hapus SEMUA wajah terdaftar? Tindakan ini tidak bisa dibatalkan.')) return;
  commitPeople([]);
  state.lastSeen.clear();
  setMsg(els.peopleMsg, 'Semua data wajah dihapus.', 'ok');
});

els.btnExport.addEventListener('click', () => {
  const date = new Date().toISOString().slice(0, 10);
  download(`maca-beungeut-${date}.json`, store.exportPeople(state.people), 'application/json');
});

els.importInput.addEventListener('change', async () => {
  const file = els.importInput.files[0];
  els.importInput.value = '';
  if (!file) return;
  try {
    const incoming = store.parseImport(await file.text());
    if (!incoming.length) throw new Error('Tidak ada data wajah yang valid di file ini');
    const byId = new Map(state.people.map((p) => [p.id, p]));
    for (const p of incoming) byId.set(p.id, p);
    if (!commitPeople([...byId.values()])) throw new Error('Penyimpanan browser penuh');
    setMsg(els.peopleMsg, `${incoming.length} orang berhasil diimpor.`, 'ok');
  } catch (err) {
    setMsg(els.peopleMsg, `Gagal impor: ${err.message}`, 'error');
  }
});

/* ---------- drawing ---------- */

/**
 * Draws boxes + labels for `results` onto `canvas` (sized to the source's
 * intrinsic pixels). `mirror` flips x to match a CSS-mirrored video.
 */
function drawDetections(canvas, results, { mirror = false, labeler } = {}) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  const scale = Math.max(1, Math.max(width, height) / 800);
  const fontSize = Math.round(15 * scale);
  ctx.lineWidth = 3 * scale;
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'top';

  results.forEach((r, i) => {
    const { text, color } = labeler(r, i);
    const { x, y, width: w, height: h } = r.box;
    const bx = mirror ? width - x - w : x;
    ctx.strokeStyle = color;
    ctx.strokeRect(bx, y, w, h);

    const pad = 5 * scale;
    const tw = ctx.measureText(text).width + pad * 2;
    const th = fontSize + pad * 2;
    const lx = Math.min(Math.max(0, bx - ctx.lineWidth / 2), width - tw);
    const ly = y - th - ctx.lineWidth / 2 >= 0 ? y - th - ctx.lineWidth / 2 : y + h + ctx.lineWidth / 2;
    ctx.fillStyle = color;
    ctx.fillRect(lx, ly, tw, th);
    ctx.fillStyle = '#0b1220';
    ctx.fillText(text, lx + pad, ly + pad);
  });
}

const COLOR_KNOWN = '#22c55e';
const COLOR_UNKNOWN = '#f59e0b';
const COLOR_ENROLL = '#38bdf8';

function recognitionLabel(r, prefix = '') {
  const person = r.id && personById(r.id);
  return person
    ? { text: `${prefix}${person.name} · ${similarity(r.distance)}%`, color: COLOR_KNOWN }
    : { text: `${prefix}Tidak dikenal`, color: COLOR_UNKNOWN };
}

const identifyAll = (results) => results.map((r) => ({ ...r, ...face.identify(state.matcher, r.descriptor) }));

/* ---------- camera ---------- */

function cameraError(err) {
  if (!navigator.mediaDevices?.getUserMedia) return 'Browser tidak mengizinkan akses kamera. Buka lewat https:// atau http://localhost.';
  switch (err?.name) {
    case 'NotAllowedError':
      return 'Izin kamera ditolak. Izinkan akses kamera di pengaturan browser lalu coba lagi.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Kamera tidak ditemukan.';
    case 'NotReadableError':
      return 'Kamera sedang dipakai aplikasi lain.';
    default:
      return `Gagal membuka kamera: ${err?.message ?? err}`;
  }
}

async function startCamera(deviceId) {
  stopCamera();
  setMsg(els.cameraMsg, '');
  els.btnCamera.disabled = true;
  try {
    const video = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } };
    const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    state.camera.stream = stream;
    els.video.srcObject = stream;
    await els.video.play();

    const track = stream.getVideoTracks()[0];
    state.camera.mirror = track.getSettings().facingMode !== 'environment';
    els.video.classList.toggle('is-mirrored', state.camera.mirror);
    els.camPlaceholder.hidden = true;
    els.btnFullscreen.hidden = false;
    els.btnCamera.textContent = 'Matikan kamera';
    await populateCameraSelect(track.getSettings().deviceId);

    state.camera.running = true;
    cameraLoop(++state.camera.loopId);
  } catch (err) {
    stopCamera();
    setMsg(els.cameraMsg, cameraError(err), 'error');
  } finally {
    els.btnCamera.disabled = !state.modelsReady;
    updateEnrollButton();
  }
}

function stopCamera() {
  state.camera.running = false;
  state.camera.loopId++;
  state.camera.stream?.getTracks().forEach((t) => t.stop());
  state.camera.stream = null;
  els.video.srcObject = null;
  els.camOverlay.getContext('2d').clearRect(0, 0, els.camOverlay.width, els.camOverlay.height);
  els.camPlaceholder.hidden = false;
  els.camViewport.style.aspectRatio = '';
  setFullscreen(false);
  els.btnFullscreen.hidden = true;
  els.btnCamera.textContent = 'Nyalakan kamera';
  els.fps.textContent = '';
  if (state.enroll) finishEnroll('Pendaftaran dibatalkan karena kamera dimatikan.', 'error');
  updateEnrollButton();
}

async function populateCameraSelect(activeId) {
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  els.cameraSelect.hidden = devices.length < 2;
  els.cameraSelect.replaceChildren(
    ...devices.map((d, i) => el('option', { value: d.deviceId, textContent: d.label || `Kamera ${i + 1}` })),
  );
  if (activeId) els.cameraSelect.value = activeId;
}

async function cameraLoop(loopId) {
  const { video, camOverlay } = els;
  let fps = 0;
  while (state.camera.running && loopId === state.camera.loopId) {
    // Pause detection while another tab is shown (saves CPU/battery; keeps the photo tab responsive).
    if (els.cameraPanel.hidden && !state.enroll) {
      await sleep(250);
      continue;
    }
    // Pause detection while another tab is shown (saves CPU/battery; keeps the photo tab responsive).
    if (els.cameraPanel.hidden && !state.enroll) {
      await sleep(250);
      continue;
    }
    if (video.readyState < 2 || !video.videoWidth) {
      await nextFrame();
      continue;
    }
    if (camOverlay.width !== video.videoWidth || camOverlay.height !== video.videoHeight) {
      camOverlay.width = video.videoWidth;
      camOverlay.height = video.videoHeight;
      // Follow the stream's real shape (portrait on phones) instead of a fixed 16:9 box.
      els.camViewport.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    }
    const t0 = performance.now();
    let results;
    try {
      results = identifyAll(await face.detectFaces(video, state.settings.detector, { inputSize: 416 }));
    } catch (err) {
      console.error(err);
      await sleep(500);
      continue;
    }
    if (loopId !== state.camera.loopId) break;

    const enrolling = Boolean(state.enroll);
    drawDetections(camOverlay, results, {
      mirror: state.camera.mirror,
      labeler: (r) => (enrolling ? { text: 'Mendaftarkan…', color: COLOR_ENROLL } : recognitionLabel(r)),
    });
    if (enrolling) handleEnrollFrame(results);
    else updateLog(results);

    const dt = performance.now() - t0;
    fps = fps ? fps * 0.9 + (1000 / dt) * 0.1 : 1000 / dt;
    els.fps.textContent = `${fps.toFixed(1)} fps · ${results.length} wajah`;
    await nextFrame();
  }
}

els.btnCamera.addEventListener('click', () => (state.camera.running ? stopCamera() : startCamera()));

/* Fullscreen: CSS takeover of the viewport, plus the Fullscreen API where
   supported (hides browser chrome on Android; iOS falls back to CSS only). */
function setFullscreen(on) {
  const active = els.camViewport.classList.contains('is-fullscreen');
  if (on === active) return;
  els.camViewport.classList.toggle('is-fullscreen', on);
  document.body.classList.toggle('no-scroll', on);
  els.btnExitFullscreen.hidden = !on;
  if (on) els.camViewport.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

els.btnFullscreen.addEventListener('click', () => setFullscreen(true));
els.btnExitFullscreen.addEventListener('click', () => setFullscreen(false));
document.addEventListener('keydown', (e) => e.key === 'Escape' && setFullscreen(false));
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) setFullscreen(false);
});
els.cameraSelect.addEventListener('change', () => startCamera(els.cameraSelect.value));

/* ---------- enrollment from camera ---------- */

function updateEnrollButton() {
  els.btnEnroll.disabled = !state.camera.running || Boolean(state.enroll);
}

els.enrollForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = els.enrollName.value.trim();
  if (!name || !state.camera.running) return;
  state.enroll = { name, samples: [], thumb: '', lastAt: 0, startedAt: performance.now() };
  els.enrollProgress.hidden = false;
  setProgress(0);
  setMsg(els.enrollMsg, 'Lihat ke kamera…');
  updateEnrollButton();
});

function setProgress(n) {
  els.enrollProgress.firstElementChild.style.width = `${(n / ENROLL_SAMPLES) * 100}%`;
}

function handleEnrollFrame(results) {
  const en = state.enroll;
  const now = performance.now();
  if (now - en.startedAt > ENROLL_TIMEOUT_MS) {
    finishEnroll('Waktu habis. Pastikan wajah terlihat jelas dan cukup cahaya, lalu coba lagi.', 'error');
    return;
  }
  if (results.length !== 1) {
    setMsg(els.enrollMsg, results.length ? 'Terdeteksi lebih dari satu wajah — pastikan hanya Anda di kamera.' : 'Wajah belum terdeteksi…');
    return;
  }
  if (now - en.lastAt < ENROLL_INTERVAL_MS) return;
  en.lastAt = now;
  en.samples.push(results[0].descriptor);
  if (!en.thumb) en.thumb = face.cropFace(els.video, results[0].box);
  setProgress(en.samples.length);
  setMsg(els.enrollMsg, `Mengambil sampel ${en.samples.length}/${ENROLL_SAMPLES}…`);
  if (en.samples.length < ENROLL_SAMPLES) return;

  const res = addSamples(en.name, en.samples, en.thumb);
  if (!res) finishEnroll('Gagal menyimpan: penyimpanan browser penuh.', 'error');
  else if (res.added) finishEnroll(`"${res.person.name}" berhasil didaftarkan.`, 'ok');
  else finishEnroll(`Sampel "${res.person.name}" ditambahkan (total ${res.person.descriptors.length}).`, 'ok');
  if (res) els.enrollName.value = '';
}

function finishEnroll(message, kind) {
  state.enroll = null;
  els.enrollProgress.hidden = true;
  setMsg(els.enrollMsg, message, kind);
  updateEnrollButton();
}

/* ---------- recognition log ---------- */

function updateLog(results) {
  const now = Date.now();
  let changed = false;
  for (const r of results) {
    const person = r.id && personById(r.id);
    if (!person) continue;
    const prev = state.lastSeen.get(r.id);
    state.lastSeen.set(r.id, now);
    if (prev !== undefined && now - prev < LOG_GAP_MS) continue;
    state.log.unshift({ name: person.name, thumb: person.thumb, time: now, similarity: similarity(r.distance) });
    changed = true;
  }
  if (!changed) return;
  state.log.length = Math.min(state.log.length, LOG_LIMIT);
  renderLog();
}

function renderLog() {
  els.logEmpty.hidden = state.log.length > 0;
  els.btnLogCsv.disabled = els.btnLogClear.disabled = state.log.length === 0;
  els.log.replaceChildren(
    ...state.log.slice(0, 50).map((entry) =>
      el('li', { className: 'item' }, [
        avatar(entry),
        el('div', { className: 'item__info' }, [
          el('strong', { textContent: entry.name }),
          el('small', { className: 'muted', textContent: formatTime(entry.time) }),
        ]),
        el('span', { className: 'pill', textContent: `${entry.similarity}%` }),
      ]),
    ),
  );
}

function csvCell(value) {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // avoid spreadsheet formula injection
  return `"${s.replaceAll('"', '""')}"`;
}

els.btnLogCsv.addEventListener('click', () => {
  const rows = [['Nama', 'Waktu', 'Kemiripan (%)']].concat(
    state.log.map((e) => [e.name, new Date(e.time).toISOString(), e.similarity]),
  );
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  download(`maca-beungeut-riwayat-${new Date().toISOString().slice(0, 10)}.csv`, `﻿${csv}`, 'text/csv');
});

els.btnLogClear.addEventListener('click', () => {
  state.log = [];
  state.lastSeen.clear();
  renderLog();
});

/* ---------- photo ---------- */

async function analyzePhoto(file) {
  if (!file || !state.modelsReady) return;
  if (!file.type.startsWith('image/')) {
    setMsg(els.photoMsg, 'File yang dipilih bukan gambar.', 'error');
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    els.photoImg.src = url;
    await els.photoImg.decode();
  } catch {
    URL.revokeObjectURL(url);
    setMsg(els.photoMsg, 'Gambar tidak bisa dibuka.', 'error');
    return;
  }
  if (els.photoImg.dataset.url) URL.revokeObjectURL(els.photoImg.dataset.url);
  els.photoImg.dataset.url = url;
  els.photoViewport.hidden = false;
  els.photoOverlay.width = els.photoImg.naturalWidth;
  els.photoOverlay.height = els.photoImg.naturalHeight;
  els.photoOverlay.getContext('2d').clearRect(0, 0, els.photoOverlay.width, els.photoOverlay.height);
  await detectPhoto();
}

async function detectPhoto() {
  if (!els.photoImg.dataset.url) return;
  setMsg(els.photoMsg, 'Mendeteksi wajah…');
  els.photoFaces.replaceChildren();
  try {
    const results = await face.detectFaces(els.photoImg, state.settings.detector, { inputSize: 608 });
    state.photo = {
      results: results.map((r) => ({ ...r, thumb: face.cropFace(els.photoImg, r.box, 96) })),
    };
  } catch (err) {
    console.error(err);
    state.photo = null;
    setMsg(els.photoMsg, `Gagal mendeteksi: ${err.message}`, 'error');
    return;
  }
  const n = state.photo.results.length;
  setMsg(els.photoMsg, n ? `${n} wajah terdeteksi.` : 'Tidak ada wajah terdeteksi. Coba foto lain atau detektor "Akurat".', n ? 'ok' : 'error');
  refreshPhotoMatches();
}

/** Re-identifies the current photo's faces (e.g. after the database changes). */
function refreshPhotoMatches() {
  if (!state.photo) return;
  const results = identifyAll(state.photo.results);
  drawDetections(els.photoOverlay, results, { labeler: (r, i) => recognitionLabel(r, `${i + 1}. `) });
  renderPhotoFaces(results);
}

function renderPhotoFaces(results) {
  els.photoEmpty.hidden = results.length > 0;
  els.photoFaces.replaceChildren(
    ...results.map((r, i) => {
      const person = r.id && personById(r.id);
      const input = el('input', {
        type: 'text',
        placeholder: 'Nama',
        maxLength: 60,
        required: true,
        value: person?.name ?? '',
      });
      const form = el('form', { className: 'row' }, [
        input,
        el('button', { className: 'btn btn--primary btn--sm', type: 'submit', textContent: person ? 'Tambah sampel' : 'Daftarkan' }),
      ]);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        const res = addSamples(name, [r.descriptor], r.thumb);
        if (!res) setMsg(els.photoMsg, 'Gagal menyimpan: penyimpanan browser penuh.', 'error');
        else setMsg(els.photoMsg, res.added ? `"${res.person.name}" berhasil didaftarkan.` : `Sampel "${res.person.name}" ditambahkan.`, 'ok');
      });
      return el('li', { className: 'item item--stack' }, [
        el('div', { className: 'item__row' }, [
          el('img', { className: 'avatar', src: r.thumb, alt: '' }),
          el('div', { className: 'item__info' }, [
            el('strong', { textContent: `${i + 1}. ${person ? person.name : 'Tidak dikenal'}` }),
            el('small', {
              className: 'muted',
              textContent: person ? `Kemiripan ${similarity(r.distance)}%` : 'Belum ada di database',
            }),
          ]),
        ]),
        form,
      ]);
    }),
  );
}

els.photoInput.addEventListener('change', () => {
  analyzePhoto(els.photoInput.files[0]);
  els.photoInput.value = '';
});
els.dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  els.dropzone.classList.add('is-over');
});
els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('is-over'));
els.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  els.dropzone.classList.remove('is-over');
  analyzePhoto(e.dataTransfer.files[0]);
});

/* ---------- tabs & settings ---------- */

document.querySelectorAll('.tab').forEach((tab) =>
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll('.panel').forEach((p) => (p.hidden = p.id !== `tab-${tab.dataset.tab}`));
  }),
);

function updateSettingsSummary() {
  const detector = state.settings.detector === 'ssd' ? 'Akurat' : 'Cepat';
  els.settingsSummary.textContent = `· ${detector} · ambang ${state.settings.threshold.toFixed(2)}`;
}

function applySettings() {
  els.detector.value = state.settings.detector;
  els.threshold.value = String(state.settings.threshold);
  els.thresholdValue.textContent = state.settings.threshold.toFixed(2);
  els.settings.open = matchMedia('(min-width: 861px)').matches;
  updateSettingsSummary();
}

els.detector.addEventListener('change', () => {
  state.settings.detector = els.detector.value;
  store.saveSettings(state.settings);
  updateSettingsSummary();
  if (state.modelsReady) detectPhoto();
});

els.threshold.addEventListener('input', () => {
  state.settings.threshold = Number(els.threshold.value);
  els.thresholdValue.textContent = state.settings.threshold.toFixed(2);
  state.matcher = face.createMatcher(state.people, state.settings.threshold);
  store.saveSettings(state.settings);
  updateSettingsSummary();
  refreshPhotoMatches();
});

/* ---------- boot ---------- */

async function boot() {
  applySettings();
  renderPeople();
  renderLog();
  state.matcher = face.createMatcher(state.people, state.settings.threshold);
  try {
    const backend = await face.loadModels();
    state.modelsReady = true;
    els.status.dataset.state = 'ready';
    els.status.textContent = `Siap · ${backend.toUpperCase()}`;
    els.btnCamera.disabled = false;
    els.photoInput.disabled = false;
  } catch (err) {
    console.error(err);
    els.status.dataset.state = 'error';
    els.status.textContent = 'Gagal memuat model';
    setMsg(els.cameraMsg, `Model gagal dimuat: ${err.message}. Jalankan "npm run models" lalu muat ulang.`, 'error');
  }
}

boot();
