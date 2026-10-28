'use strict';

const $ = (id) => document.getElementById(id);

const els = {
  form: $('form'),
  url: $('url'),
  go: $('go'),
  message: $('message'),
  card: $('card'),
  thumb: $('thumb'),
  duration: $('duration'),
  title: $('title'),
  uploader: $('uploader'),
  download: $('download'),
  progress: $('progress'),
  stage: $('stage'),
  percent: $('percent'),
  fill: $('fill'),
  speed: $('speed'),
  eta: $('eta'),
  cancel: $('cancel'),
  done: $('done'),
  doneName: $('done-name'),
  doneMeta: $('done-meta'),
  donePath: $('done-path'),
  reveal: $('reveal'),
  folderRow: $('folder-row'),
  openRow: $('open-row'),
  autoOpen: $('auto-open'),
  folder: $('folder'),
  browse: $('browse'),
  save: $('save'),
  again: $('again'),
  status: $('status'),
};

/* ---------- custom dropdown ---------- */

const dropdown = (() => {
  const root = $('quality');
  const btn = $('quality-btn');
  const label = $('quality-label');
  const list = $('quality-list');

  let options = [];
  let selected = 0;
  let active = 0;
  let isOpen = false;

  const items = () => [...list.children];

  function highlight(i) {
    active = Math.max(0, Math.min(i, options.length - 1));
    items().forEach((li, n) => li.classList.toggle('active', n === active));
    const li = items()[active];
    btn.setAttribute('aria-activedescendant', li.id);
    li.scrollIntoView({ block: 'nearest' });
  }

  function select(i) {
    selected = i;
    label.textContent = options[i][1];
    items().forEach((li, n) => li.setAttribute('aria-selected', String(n === i)));
  }

  function open() {
    if (isOpen || !options.length) return;
    isOpen = true;
    list.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    highlight(selected);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    list.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    btn.removeAttribute('aria-activedescendant');
  }

  function commit(i) {
    select(i);
    close();
  }

  btn.addEventListener('click', () => (isOpen ? close() : open()));
  btn.addEventListener('blur', close);

  btn.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!isOpen) return open();
        highlight(active + (e.key === 'ArrowDown' ? 1 : -1));
        break;
      }
      case 'Home':
        if (isOpen) { e.preventDefault(); highlight(0); }
        break;
      case 'End':
        if (isOpen) { e.preventDefault(); highlight(options.length - 1); }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (isOpen) commit(active);
        else open();
        break;
      case 'Escape':
        if (isOpen) { e.preventDefault(); e.stopPropagation(); close(); }
        break;
      case 'Tab':
        close();
        break;
    }
  });

  // Keep focus on the button while interacting with the list.
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('mousemove', (e) => {
    const li = e.target.closest('li');
    if (li) highlight(Number(li.dataset.index));
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (li) commit(Number(li.dataset.index));
  });

  document.addEventListener('pointerdown', (e) => {
    if (!root.contains(e.target)) close();
  });

  return {
    set(newOptions) {
      close();
      options = newOptions;
      list.innerHTML = '';
      options.forEach(([, text], i) => {
        const li = document.createElement('li');
        li.id = `quality-opt-${i}`;
        li.setAttribute('role', 'option');
        li.dataset.index = String(i);
        li.textContent = text;
        list.append(li);
      });
      select(0);
    },
    get value() {
      return options[selected]?.[0];
    },
  };
})();

/* ---------- save folder ---------- */

let isLocal = false; // only the machine running ymate can pick folders
let savedFolder = '';

async function commitFolder() {
  const value = els.folder.value.trim();
  if (!isLocal || value === savedFolder) return true;
  try {
    const res = await post('/api/settings', { downloadDir: value });
    savedFolder = res.downloadDir;
    els.folder.value = savedFolder;
    setMessage('');
    return true;
  } catch (err) {
    setMessage(err.message);
    els.folder.value = savedFolder;
    return false;
  }
}

els.folder.addEventListener('change', commitFolder);
els.folder.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    els.folder.blur();
  }
});

// Clicking Browse again while a dialog is open replaces it (and brings it to the front).
let pickToken = 0;
els.browse.addEventListener('click', async () => {
  const token = ++pickToken;
  els.browse.textContent = 'Choosing…';
  els.browse.title = 'A folder window should be open. Click again to bring it back.';
  try {
    const { path } = await post('/api/pick-folder', {});
    if (token === pickToken && path) {
      els.folder.value = path;
      await commitFolder();
    }
  } catch (err) {
    if (token === pickToken) {
      setMessage(err.message);
      els.folder.focus();
    }
  } finally {
    if (token === pickToken) {
      els.browse.textContent = 'Browse';
      els.browse.removeAttribute('title');
    }
  }
});

// Check the file exists before letting the browser download it, so a server
// error shows a message instead of a "save this JSON file" dialog.
els.save.addEventListener('click', async (e) => {
  if (els.save.dataset.checked === els.save.href) return;
  e.preventDefault();
  try {
    const res = await fetch(els.save.href, { method: 'HEAD' });
    if (!res.ok) throw new Error();
    els.save.dataset.checked = els.save.href;
    els.save.click();
  } catch {
    setMessage('Couldn\u2019t fetch the file. If you just updated ymate, restart it (Ctrl+C, then npm start) and refresh.');
  }
});

els.autoOpen.addEventListener('change', () => {
  post('/api/settings', { openWhenDone: els.autoOpen.checked }).catch((err) => setMessage(err.message));
});

els.reveal.addEventListener('click', () => {
  post(`/api/jobs/${els.reveal.dataset.id}/reveal`, {}).catch((err) => setMessage(err.message));
});

api('/api/settings')
  .then((s) => {
    isLocal = s.local;
    savedFolder = s.downloadDir;
    els.folder.value = s.downloadDir;
    els.folderRow.hidden = !isLocal;
    els.openRow.hidden = !isLocal;
    els.autoOpen.checked = s.openWhenDone;
  })
  .catch(() => {});

let currentUrl = '';
let currentJob = null;
let events = null;

/* ---------- helpers ---------- */

function show(...visible) {
  for (const el of [els.card, els.progress, els.done]) el.hidden = !visible.includes(el);
}

function setMessage(text) {
  els.message.textContent = text || '';
  els.message.hidden = !text;
}

function formatDuration(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function formatBytes(n) {
  if (!n) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function formatEta(s) {
  if (s == null) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return m ? `${m}m ${sec}s left` : `${sec}s left`;
}

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function post(path, body) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/* ---------- step 1: look up the video ---------- */

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = els.url.value.trim();
  if (!url) return;

  setMessage('');
  show();
  els.go.disabled = true;
  els.go.textContent = 'Looking…';

  try {
    const info = await post('/api/info', { url });
    currentUrl = url;
    renderInfo(info);
  } catch (err) {
    setMessage(err.message);
  } finally {
    els.go.disabled = false;
    els.go.textContent = 'Continue';
  }
});

function renderInfo(info) {
  els.thumb.src = info.thumbnail || '';
  els.duration.textContent = info.isLive ? 'LIVE' : formatDuration(info.duration);
  els.title.textContent = info.title;
  els.uploader.textContent = info.uploader;

  const options = [['best', info.maxHeight ? `Best available (${info.maxHeight}p)` : 'Best available']];
  for (const h of info.heights) options.push([String(h), h >= 2160 ? '4K · 2160p' : `${h}p`]);
  options.push(['audio', 'Audio only · MP3']);
  dropdown.set(options);

  show(els.card);
}

/* ---------- step 2: download ---------- */

els.download.addEventListener('click', async () => {
  els.download.disabled = true;
  try {
    if (!(await commitFolder())) return;
    const { id } = await post('/api/download', { url: currentUrl, quality: dropdown.value });
    currentJob = id;
    renderProgress({ status: 'starting', stage: 'Starting', percent: 0 });
    show(els.progress);
    listen(id);
  } catch (err) {
    setMessage(err.message);
  } finally {
    els.download.disabled = false;
  }
});

function listen(id) {
  events?.close();
  events = new EventSource(`/api/jobs/${id}/events`);
  events.onmessage = (e) => {
    const job = JSON.parse(e.data);
    if (job.status === 'done') return finish(job);
    if (job.status === 'error' || job.status === 'cancelled') return fail(job);
    renderProgress(job);
  };
}

function renderProgress(job) {
  els.stage.textContent = job.stage;
  els.percent.textContent = `${Math.floor(job.percent)}%`;
  els.fill.style.width = `${job.percent}%`;
  els.fill.parentElement.classList.toggle('pulse', job.status === 'starting' || job.status === 'processing');
  els.speed.textContent = job.speed ? `${formatBytes(job.speed)}/s` : '';
  els.eta.textContent = formatEta(job.eta);
}

function finish(job) {
  events?.close();
  els.doneName.textContent = job.filename;
  els.doneMeta.textContent = formatBytes(job.size);
  els.donePath.textContent = job.folder ? `Saved in ${job.folder}` : '';
  els.reveal.dataset.id = job.id;
  els.reveal.hidden = !isLocal;
  els.save.href = `/api/files/${encodeURIComponent(job.filename)}`;
  delete els.save.dataset.checked;
  els.save.className = isLocal ? 'ghost link' : 'primary link';
  els.save.textContent = isLocal ? 'Download a copy' : 'Save file';
  show(els.done);
}

function fail(job) {
  events?.close();
  currentJob = null;
  show(job.status === 'cancelled' ? els.card : null);
  if (job.status === 'error') setMessage(job.error);
}

els.cancel.addEventListener('click', async () => {
  els.cancel.disabled = true;
  try {
    if (currentJob) await api(`/api/jobs/${currentJob}`, { method: 'DELETE' });
  } catch {
    /* the SSE stream reports the final state */
  } finally {
    els.cancel.disabled = false;
  }
});

els.again.addEventListener('click', () => {
  show();
  els.url.value = '';
  els.url.focus();
  setMessage('');
  currentJob = null;
});

/* ---------- footer: dependency check ---------- */

api('/api/health')
  .then(({ ytdlp, ffmpeg }) => {
    const missing = [!ytdlp && 'yt-dlp', !ffmpeg && 'ffmpeg'].filter(Boolean);
    if (missing.length) {
      els.status.innerHTML = '';
      const span = document.createElement('span');
      span.className = 'warn';
      span.textContent = `Missing: ${missing.join(', ')}`;
      els.status.append(span);
    } else {
      els.status.textContent = `yt-dlp ${ytdlp} · ffmpeg ${ffmpeg}`;
    }
  })
  .catch(() => {});
