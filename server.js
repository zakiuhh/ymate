'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');

const PORT = Number(process.env.PORT) || 3000;
// Local only by default: this app shells out to yt-dlp and has no login.
// Set HOST=0.0.0.0 to share it on your network.
const HOST = process.env.HOST || '127.0.0.1';

function findYtDlp() {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH;
  const exe = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  for (const dir of [__dirname, path.join(__dirname, 'bin')]) {
    const candidate = path.join(dir, exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'yt-dlp'; // fall back to PATH
}

function findFfmpeg() {
  const p = process.env.FFMPEG_PATH;
  if (!p) return 'ffmpeg';
  try {
    return fs.statSync(p).isDirectory() ? path.join(p, 'ffmpeg') : p;
  } catch {
    return p;
  }
}

const YTDLP = findYtDlp();
const FFMPEG = findFfmpeg();
const DEFAULT_DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || path.join(__dirname, 'downloads'));
const SETTINGS_FILE = path.join(__dirname, 'settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Chosen in the UI (saved in settings.json); falls back to DOWNLOAD_DIR / ./downloads.
let downloadDir = path.resolve(loadSettings().downloadDir || DEFAULT_DOWNLOAD_DIR);
let openWhenDone = loadSettings().openWhenDone !== false; // open the file manager after each download

function saveSettings() {
  return fsp.writeFile(SETTINGS_FILE, JSON.stringify({ downloadDir, openWhenDone }, null, 2));
}
const PUBLIC_DIR = path.join(__dirname, 'public');

const ALLOWED_HOSTS = ['youtube.com', 'youtu.be', 'youtube-nocookie.com'];
const QUALITIES = new Set(['best', '2160', '1440', '1080', '720', '480', '360', '240', '144', 'audio']);

const COMMON_ARGS = [
  '--no-playlist',
  '--ignore-config',
  '--encoding', 'utf-8',
  '--js-runtimes', `node:${process.execPath}`, // YouTube extraction needs a JS runtime
  ...(process.env.FFMPEG_PATH ? ['--ffmpeg-location', process.env.FFMPEG_PATH] : []),
];

const CHILD_ENV = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
};

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // yt-dlp spawns ffmpeg; take the whole tree down.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

function lastError(stderr) {
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errLine = [...lines].reverse().find((l) => l.startsWith('ERROR:'));
  const line = errLine || lines[lines.length - 1] || 'Something went wrong.';
  return line.replace(/^ERROR:\s*/, '').replace(/^\[[^\]]+\]\s+[\w-]+:\s*/, '');
}

function friendlySpawnError(err) {
  if (err.code === 'ENOENT') {
    return new Error(`Could not run yt-dlp ("${YTDLP}"). Set YTDLP_PATH in .env to its full path.`);
  }
  return err;
}

function parseYouTubeUrl(raw) {
  if (typeof raw !== 'string') return null;
  let u;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  const ok = ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  return ok ? u.toString() : null;
}

function runYtDlp(args, { timeout = 90_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, args, { windowsHide: true, env: CHILD_ENV });
    const out = [];
    let err = '';
    const timer = setTimeout(() => {
      killTree(child);
      reject(new Error('Timed out while talking to YouTube.'));
    }, timeout);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(friendlySpawnError(e));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
      else reject(new Error(lastError(err)));
    });
  });
}

function probe(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10_000, windowsHide: true, env: CHILD_ENV }, (e, stdout) => {
      resolve(e ? null : String(stdout).split(/\r?\n/)[0].trim());
    });
  });
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

function readJson(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Request too large.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function sendFile(req, res, file, size) {
  const name = path.basename(file);
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const stream = fs.createReadStream(file);
  stream.on('open', () => {
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(name).toLowerCase()] || 'application/octet-stream',
      'Content-Length': size,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
    if (req.method === 'HEAD') {
      res.end();
      stream.destroy();
    } else {
      stream.pipe(res);
    }
  });
  stream.on('error', () => {
    if (!res.headersSent) sendJson(res, 404, { error: 'File not found. It may have been moved or deleted.' });
    else res.destroy();
  });
  res.on('close', () => stream.destroy());
}

const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

// Accepts a pasted path (quotes allowed), makes sure it exists and is writable.
async function validateFolder(input) {
  if (typeof input !== 'string') throw new Error('Enter a folder path.');
  const cleaned = input.trim().replace(/^["']+|["']+$/g, '');
  if (!cleaned) throw new Error('Enter a folder path.');
  if (!path.isAbsolute(cleaned)) throw new Error('Use a full path, like C:\\Users\\you\\Videos.');
  const dir = path.resolve(cleaned);
  try {
    await fsp.mkdir(dir, { recursive: true });
    const probeFile = path.join(dir, `.ymate-write-test-${process.pid}`);
    await fsp.writeFile(probeFile, '');
    await fsp.rm(probeFile, { force: true });
  } catch (e) {
    throw new Error(`Can\u2019t write to that folder (${e.code || e.message}).`);
  }
  return dir;
}

let activePicker = null;

function runPicker(cmd, args, env) {
  if (activePicker) activePicker.kill(); // replace a dialog that's still open
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { timeout: 5 * 60_000, windowsHide: false, env: { ...process.env, ...env }, encoding: 'utf8' },
      (err, stdout) => {
        if (err && err.code === 'ENOENT') return reject(new Error('Folder picker isn\u2019t available. Type the path instead.'));
        resolve(String(stdout || '').trim() || null); // cancelled or replaced -> empty output
      },
    );
    activePicker = child;
    child.on('close', () => {
      if (activePicker === child) activePicker = null;
    });
  });
}

// Opens the OS folder chooser on the machine running the server.
function pickFolder(startDir) {
  if (process.platform === 'win32') {
    const script = [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      'Add-Type -AssemblyName System.Windows.Forms',
      // An invisible, shown, always-on-top owner keeps the dialog in front of the browser.
      '$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0; StartPosition = "CenterScreen"; Width = 1; Height = 1 }',
      '$owner.Show()',
      '$owner.Activate()',
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$d.Description = 'Choose where to save downloads'",
      '$d.SelectedPath = $env:YMATE_START',
      "if ($d.ShowDialog($owner) -eq 'OK') { $d.SelectedPath }",
      '$owner.Close()',
    ].join('; ');
    return runPicker('powershell.exe', ['-NoProfile', '-STA', '-Command', script], { YMATE_START: startDir });
  }
  if (process.platform === 'darwin') {
    return runPicker('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose where to save downloads")']);
  }
  return runPicker('zenity', ['--file-selection', '--directory', '--filename', startDir + path.sep]);
}

function revealInFolder(file) {
  let child;
  if (process.platform === 'win32') {
    child = spawn('explorer.exe', [`/select,"${file}"`], { windowsHide: false, windowsVerbatimArguments: true });
  } else if (process.platform === 'darwin') {
    child = spawn('open', ['-R', file]);
  } else {
    child = spawn('xdg-open', [path.dirname(file)]);
  }
  child.on('error', () => {});
  child.unref();
}

async function uniquePath(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = path.join(dir, name);
  for (let i = 1; fs.existsSync(candidate); i++) {
    candidate = path.join(dir, `${base} (${i})${ext}`);
  }
  return candidate;
}

/* ------------------------------------------------------------------ */
/* video info                                                         */
/* ------------------------------------------------------------------ */

async function getInfo(url) {
  const raw = await runYtDlp([...COMMON_ARGS, '--no-warnings', '-J', '--', url]);
  const info = JSON.parse(raw);

  const heights = (info.formats || [])
    .filter((f) => f.vcodec && f.vcodec !== 'none' && f.height)
    .map((f) => f.height);
  const maxHeight = heights.length ? Math.max(...heights) : 0;
  const presets = [2160, 1440, 1080, 720, 480, 360, 240, 144].filter((h) => maxHeight >= h);

  return {
    title: info.title,
    uploader: info.uploader || info.channel || '',
    duration: info.duration || null,
    thumbnail: info.thumbnail || null,
    isLive: Boolean(info.is_live),
    heights: presets,
    maxHeight,
  };
}

/* ------------------------------------------------------------------ */
/* download jobs                                                      */
/* ------------------------------------------------------------------ */

const jobs = new Map();

const PROGRESS_PREFIX = 'PROG|';
const PROGRESS_TEMPLATE =
  'download:' +
  PROGRESS_PREFIX +
  '%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s';

const num = (s) => {
  const n = Number(s);
  return s && s !== 'NA' && Number.isFinite(n) ? n : null;
};

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    percent: Math.round(job.percent * 10) / 10,
    speed: job.speed,
    eta: job.eta,
    filename: job.file ? path.basename(job.file) : null,
    folder: job.outDir,
    size: job.size,
    error: job.error,
  };
}

function emit(job) {
  const payload = `data: ${JSON.stringify(publicJob(job))}\n\n`;
  for (const res of job.listeners) res.write(payload);
}

function buildDownloadArgs(url, quality, jobDir) {
  const args = [
    ...COMMON_ARGS,
    '--no-warnings',
    '--newline',
    '--windows-filenames',
    '--trim-filenames', '150',
    '-P', jobDir,
    '-o', '%(title)s [%(id)s].%(ext)s',
    '--progress-template', PROGRESS_TEMPLATE,
  ];

  if (quality === 'audio') {
    args.push('-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    // Prefer H.264/AAC in MP4 (plays everywhere); fall back to whatever is best.
    const sort = quality === 'best' ? 'res,ext:mp4:m4a' : `res:${quality},ext:mp4:m4a`;
    args.push('-f', 'bv*+ba/b', '-S', sort, '--merge-output-format', 'mp4');
  }

  args.push('--', url);
  return args;
}

function startJob(url, quality, fromLocal) {
  const id = crypto.randomBytes(8).toString('hex');
  const outDir = downloadDir; // fixed for this job even if the setting changes mid-download
  const jobDir = path.join(outDir, `.tmp-${id}`);
  fs.mkdirSync(jobDir, { recursive: true });

  const job = {
    id,
    status: 'starting',
    stage: 'Starting',
    percent: 0,
    speed: null,
    eta: null,
    file: null,
    size: null,
    error: null,
    cancelled: false,
    listeners: new Set(),
    child: null,
    dir: jobDir,
    outDir,
    autoOpen: fromLocal && openWhenDone,
  };
  jobs.set(id, job);

  const audioOnly = quality === 'audio';
  const totalStreams = audioOnly ? 1 : 2; // video + audio, merged by ffmpeg
  let streamIndex = 0;
  let stderr = '';
  let buffer = '';

  const child = spawn(YTDLP, buildDownloadArgs(url, quality, jobDir), {
    windowsHide: true,
    env: CHILD_ENV,
  });
  job.child = child;

  const handleLine = (line) => {
    if (line.startsWith(PROGRESS_PREFIX)) {
      const [downloaded, total, estimate, speed, eta] = line
        .slice(PROGRESS_PREFIX.length)
        .split('|')
        .map(num);
      const size = total || estimate;
      const fraction = size ? Math.min(downloaded / size, 1) : 0;
      const idx = Math.min(Math.max(streamIndex, 1), totalStreams);
      const overall = (((idx - 1) + fraction) / totalStreams) * 100;

      job.status = 'downloading';
      job.stage = audioOnly || idx > 1 ? 'Downloading audio' : 'Downloading video';
      job.percent = Math.max(job.percent, Math.min(overall, 99));
      job.speed = speed;
      job.eta = eta;
      emit(job);
    } else if (line.startsWith('[download] Destination:')) {
      streamIndex += 1;
    } else if (/^\[(Merger|ExtractAudio|VideoRemuxer|Fixup\w*|VideoConvertor)\]/.test(line)) {
      job.status = 'processing';
      job.stage = audioOnly ? 'Converting to MP3' : 'Merging with ffmpeg';
      job.percent = 99;
      job.speed = null;
      job.eta = null;
      emit(job);
    }
  };

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    lines.forEach(handleLine);
  });
  child.stderr.on('data', (d) => (stderr += d));

  child.on('error', (e) => {
    job.status = 'error';
    job.error = friendlySpawnError(e).message;
    emit(job);
    fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
  });

  child.on('close', async (code) => {
    if (job.status === 'error') return;

    if (job.cancelled) {
      job.status = 'cancelled';
      job.stage = 'Cancelled';
      emit(job);
      await fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
      return;
    }

    try {
      if (code !== 0) throw new Error(lastError(stderr));

      const names = (await fsp.readdir(jobDir)).filter(
        (n) => !/\.(part|ytdl|temp)$/i.test(n) && !/\.f\d+\./.test(n),
      );
      if (!names.length) throw new Error('Download finished but no file was produced.');

      // If several files exist, the largest is the real output.
      const stats = await Promise.all(
        names.map(async (n) => ({ n, size: (await fsp.stat(path.join(jobDir, n))).size })),
      );
      stats.sort((a, b) => b.size - a.size);
      const winner = stats[0];

      const finalPath = await uniquePath(outDir, winner.n);
      await fsp.rename(path.join(jobDir, winner.n), finalPath);

      job.file = finalPath;
      job.size = winner.size;
      if (job.autoOpen) revealInFolder(finalPath);

      job.status = 'done';
      job.stage = 'Done';
      job.percent = 100;
      job.speed = null;
      job.eta = null;
    } catch (e) {
      job.status = 'error';
      job.error = e.message;
    }

    emit(job);
    await fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    setTimeout(() => jobs.delete(id), 60 * 60 * 1000).unref();
  });

  return job;
}

/* ------------------------------------------------------------------ */
/* routes                                                             */
/* ------------------------------------------------------------------ */

// Block other websites from driving this app through the visitor's browser.
function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function handleApi(req, res, pathname) {
  if (req.method !== 'GET' && !isSameOrigin(req)) {
    return sendJson(res, 403, { error: 'Cross-origin request blocked.' });
  }
  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      const [ytdlp, ffmpeg] = await Promise.all([
        probe(YTDLP, ['--version']),
        probe(FFMPEG, ['-version']),
      ]);
      return sendJson(res, 200, { ytdlp, ffmpeg: ffmpeg ? ffmpeg.replace(/^ffmpeg version\s+/, '').split(/[\s-]/)[0] : null });
    }

    if (req.method === 'GET' && pathname === '/api/settings') {
      return sendJson(res, 200, { downloadDir, openWhenDone, local: isLocal(req) });
    }

    if (req.method === 'POST' && pathname === '/api/settings') {
      if (!isLocal(req)) return sendJson(res, 403, { error: 'Only the computer running ymate can change this.' });
      const body = await readJson(req);
      if (body.downloadDir !== undefined) {
        try {
          downloadDir = await validateFolder(body.downloadDir);
        } catch (e) {
          return sendJson(res, 400, { error: e.message });
        }
      }
      if (typeof body.openWhenDone === 'boolean') openWhenDone = body.openWhenDone;
      await saveSettings();
      return sendJson(res, 200, { downloadDir, openWhenDone });
    }

    if (req.method === 'POST' && pathname === '/api/pick-folder') {
      if (!isLocal(req)) return sendJson(res, 403, { error: 'Only the computer running ymate can change this.' });
      try {
        return sendJson(res, 200, { path: await pickFolder(downloadDir) });
      } catch (e) {
        return sendJson(res, 501, { error: e.message });
      }
    }

    if (req.method === 'POST' && pathname === '/api/info') {
      const { url } = await readJson(req);
      const clean = parseYouTubeUrl(url);
      if (!clean) return sendJson(res, 400, { error: 'That doesn\u2019t look like a YouTube link.' });
      return sendJson(res, 200, await getInfo(clean));
    }

    if (req.method === 'POST' && pathname === '/api/download') {
      const { url, quality = 'best' } = await readJson(req);
      const clean = parseYouTubeUrl(url);
      if (!clean) return sendJson(res, 400, { error: 'That doesn\u2019t look like a YouTube link.' });
      if (!QUALITIES.has(String(quality))) return sendJson(res, 400, { error: 'Unknown quality.' });
      const job = startJob(clean, String(quality), isLocal(req));
      return sendJson(res, 202, { id: job.id });
    }

    // Saved files are served by name so links survive a server restart.
    const fm = pathname.match(/^\/api\/files\/([^/]+)$/);
    if (fm && (req.method === 'GET' || req.method === 'HEAD')) {
      let name;
      try {
        name = decodeURIComponent(fm[1]);
      } catch {
        return sendJson(res, 400, { error: 'Bad file name.' });
      }
      if (name !== path.basename(name) || name.startsWith('.')) {
        return sendJson(res, 400, { error: 'Bad file name.' });
      }
      const file = path.join(downloadDir, name);
      const stat = await fsp.stat(file).catch(() => null);
      if (!stat || !stat.isFile()) {
        return sendJson(res, 404, { error: 'File not found. It may have been moved or deleted.' });
      }
      return sendFile(req, res, file, stat.size);
    }

    const m = pathname.match(/^\/api\/jobs\/([a-f0-9]+)(?:\/(events|file|reveal))?$/);
    if (m) {
      const job = jobs.get(m[1]);
      if (!job) return sendJson(res, 404, { error: 'Job not found.' });

      if (req.method === 'GET' && m[2] === 'events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        res.write(`data: ${JSON.stringify(publicJob(job))}\n\n`);
        job.listeners.add(res);
        req.on('close', () => job.listeners.delete(res));
        return;
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && m[2] === 'file') {
        if (job.status !== 'done' || !job.file) return sendJson(res, 409, { error: 'File is not ready.' });
        return sendFile(req, res, job.file, job.size);
      }

      if (req.method === 'POST' && m[2] === 'reveal') {
        if (!isLocal(req)) return sendJson(res, 403, { error: 'Only the computer running ymate can do this.' });
        if (!job.file) return sendJson(res, 409, { error: 'File is not ready.' });
        revealInFolder(job.file);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'DELETE' && !m[2]) {
        job.cancelled = true;
        killTree(job.child);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'GET' && !m[2]) return sendJson(res, 200, publicJob(job));
    }

    sendJson(res, 404, { error: 'Not found.' });
  } catch (e) {
    sendJson(res, 500, { error: e.message || 'Unexpected error.' });
  }
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (pathname.startsWith('/api/')) handleApi(req, res, pathname);
  else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, pathname);
  else res.writeHead(405).end();
});

try {
  fs.mkdirSync(downloadDir, { recursive: true });
} catch (e) {
  console.warn(`! Can't use saved folder "${downloadDir}" (${e.code}). Using ${DEFAULT_DOWNLOAD_DIR}`);
  downloadDir = DEFAULT_DOWNLOAD_DIR;
  fs.mkdirSync(downloadDir, { recursive: true });
}
// Clean up leftovers from a previous crash.
for (const n of fs.readdirSync(downloadDir)) {
  if (n.startsWith('.tmp-')) fs.rmSync(path.join(downloadDir, n), { recursive: true, force: true });
}

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try another one, e.g. PORT=${PORT + 1} in .env`);
  } else {
    console.error(e.message);
  }
  process.exit(1);
});

function lanAddresses() {
  return Object.values(require('node:os').networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
}

server.listen(PORT, HOST, async () => {
  console.log(`\n  ymate is running`);
  console.log(`  Local:    http://localhost:${PORT}`);
  if (HOST === '0.0.0.0' || HOST === '::') {
    for (const ip of lanAddresses()) console.log(`  Network:  http://${ip}:${PORT}`);
    console.log('  (Anyone on your network can use this. There is no login.)');
  }
  console.log(`  Saving to ${downloadDir}\n`);
  const [ytdlp, ffmpeg] = await Promise.all([probe(YTDLP, ['--version']), probe(FFMPEG, ['-version'])]);
  console.log(ytdlp ? `  yt-dlp ${ytdlp}` : `  ! yt-dlp not found ("${YTDLP}"). See README, "Setup".`);
  console.log(ffmpeg ? '  ffmpeg ok' : '  ! ffmpeg not found. See README, "Setup".');
  console.log('');
});

process.on('SIGINT', () => {
  for (const job of jobs.values()) killTree(job.child);
  process.exit(0);
});
