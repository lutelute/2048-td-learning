// 2048 AI Dashboard — monitoring & visualization server
// Usage: node --max-old-space-size=512 scripts/dashboard.js
// Supports both 4x4 and 5x5 board sizes

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEIGHTS_DIR_5x5 = path.join(ROOT, 'weights');
const WEIGHTS_DIR_4x4 = path.join(ROOT, 'weights4x4');
const GIFS_DIR = path.join(ROOT, 'gifs');

// Per-size module cache
const modules = {
  '5x5': { NTupleNetwork: null, evaluateNetwork: null, engineMod: null, GreedyPlayer: null },
  '4x4': { NTupleNetwork: null, evaluateNetwork: null, engineMod: null, GreedyPlayer: null },
};
let currentSize = null;
let network = null;
let loadedWeightsFile = null;

async function ensureModules(size) {
  const m = modules[size];
  if (!m.NTupleNetwork) {
    if (size === '4x4') {
      ({ NTupleNetwork: m.NTupleNetwork } = await import('../src/network/ntuple4x4.js'));
      ({ evaluateNetwork: m.evaluateNetwork } = await import('../src/training/td-learning4x4.js'));
      m.engineMod = await import('../src/game/engine4x4.js');
      ({ GreedyPlayer: m.GreedyPlayer } = await import('../src/player/greedy-player4x4.js'));
    } else {
      ({ NTupleNetwork: m.NTupleNetwork } = await import('../src/network/ntuple.js'));
      ({ evaluateNetwork: m.evaluateNetwork } = await import('../src/training/td-learning.js'));
      m.engineMod = await import('../src/game/engine.js');
      ({ GreedyPlayer: m.GreedyPlayer } = await import('../src/player/greedy-player.js'));
    }
  }
  return m;
}

function weightsDir(size) {
  return size === '4x4' ? WEIGHTS_DIR_4x4 : WEIGHTS_DIR_5x5;
}

async function ensureNetwork(weightsFile, size) {
  const m = await ensureModules(size);
  // If size changed, create a new network
  if (size !== currentSize) {
    network = new m.NTupleNetwork();
    currentSize = size;
    loadedWeightsFile = null;
  }
  if (!network) {
    network = new m.NTupleNetwork();
    currentSize = size;
  }
  if (weightsFile && weightsFile !== loadedWeightsFile) {
    const fp = path.join(weightsDir(size), weightsFile);
    if (!fs.existsSync(fp)) throw new Error(`Weights file not found: ${weightsFile}`);
    if (weightsFile.endsWith('.bin')) {
      network.loadBinary(fp);
    } else {
      network.load(fp);
    }
    loadedWeightsFile = weightsFile;
    console.log(`Loaded weights [${size}]: ${weightsFile}`);
  }
  return { network, modules: m };
}

// ── Helpers ──────────────────────────────────────────

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ── Play one full game recording every step ──────────

async function playFullGame(net, m) {
  const { createBoard, cloneBoard, move, canMove, addRandomTile, maxTile, tileValue, toGrid, SIZE } = m.engineMod;
  const player = new m.GreedyPlayer(net);

  const board = createBoard();
  const steps = [];
  let cumulativeScore = 0;

  steps.push({
    grid: toGrid(board),
    direction: null,
    reward: 0,
    cumulativeScore: 0,
    vAfterstate: null,
  });

  while (true) {
    const dir = player.selectMove(board);
    if (dir === -1) break;

    const afterstate = cloneBoard(board);
    const result = move(afterstate, dir);
    const vAfter = net.evaluate(afterstate);
    cumulativeScore += result.reward;

    move(board, dir);
    addRandomTile(board);

    steps.push({
      grid: toGrid(board),
      direction: dir,
      reward: result.reward,
      cumulativeScore,
      vAfterstate: Math.round(vAfter * 100) / 100,
    });

    if (!canMove(board)) break;
  }

  return {
    steps,
    finalScore: cumulativeScore,
    maxTile: tileValue(maxTile(board)),
    totalSteps: steps.length - 1,
    boardSize: SIZE,
  };
}

// ── HTTP Server ──────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3000', 10);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  try {
    // ── API Routes ──

    if (pathname === '/api/weights' && req.method === 'GET') {
      const size = url.searchParams.get('size') || '5x5';
      const dir = weightsDir(size);
      const files = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter(f => f.endsWith('.bin') || f.endsWith('.json'))
        : [];
      return json(res, { files, size });
    }

    if (pathname === '/api/stats' && req.method === 'GET') {
      if (!network) return json(res, { error: 'No network loaded' }, 400);
      return json(res, { ...network.stats(), size: currentSize });
    }

    if (pathname === '/api/load' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.file) return json(res, { error: 'Missing file parameter' }, 400);
      const size = body.size || '5x5';
      const { network: net } = await ensureNetwork(body.file, size);
      return json(res, { ok: true, stats: net.stats(), file: body.file, size });
    }

    if (pathname === '/api/evaluate' && req.method === 'POST') {
      const body = await readBody(req);
      const n = Math.min(Math.max(parseInt(body.n) || 10, 1), 10000);
      if (!network) return json(res, { error: 'No network loaded' }, 400);
      const m = await ensureModules(currentSize);
      const result = m.evaluateNetwork(network, n);
      return json(res, { ...result, size: currentSize });
    }

    if (pathname === '/api/play' && req.method === 'POST') {
      if (!network) return json(res, { error: 'No network loaded' }, 400);
      const m = await ensureModules(currentSize);
      const result = await playFullGame(network, m);
      return json(res, result);
    }

    // ── Training Log API ──

    if (pathname === '/api/logs' && req.method === 'GET') {
      const logs = [];
      for (const name of ['train4x4.log', 'train.log']) {
        const fp = path.join(ROOT, name);
        if (fs.existsSync(fp)) logs.push(name);
      }
      return json(res, { files: logs });
    }

    if (pathname === '/api/log' && req.method === 'GET') {
      const file = url.searchParams.get('file') || 'train4x4.log';
      const fp = path.join(ROOT, path.basename(file));
      if (!fs.existsSync(fp)) return json(res, { error: 'Log not found' }, 404);
      const text = fs.readFileSync(fp, 'utf-8');
      return json(res, { text, file });
    }

    // ── GIF Gallery API ──

    if (pathname === '/api/gifs' && req.method === 'GET') {
      const files = fs.existsSync(GIFS_DIR)
        ? fs.readdirSync(GIFS_DIR).filter(f => f.endsWith('.gif')).sort()
        : [];
      return json(res, { files });
    }

    // Serve GIF files
    if (pathname.startsWith('/gifs/') && req.method === 'GET') {
      const filename = path.basename(pathname);
      const filepath = path.join(GIFS_DIR, filename);
      if (!fs.existsSync(filepath)) {
        return json(res, { error: 'Not found' }, 404);
      }
      const data = fs.readFileSync(filepath);
      res.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': data.length,
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(data);
      return;
    }

    // ── Dashboard HTML ──
    if (pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DASHBOARD_HTML);
      return;
    }

    json(res, { error: 'Not found' }, 404);
  } catch (err) {
    console.error(err);
    json(res, { error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`2048 AI Dashboard: http://localhost:${PORT}`);
});

// ── Inline HTML ──────────────────────────────────────

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>2048 AI Dashboard</title>
<style>
:root {
  --bg: #1a1b26;
  --surface: #24283b;
  --surface2: #2f3349;
  --border: #3b4261;
  --text: #c0caf5;
  --text2: #a9b1d6;
  --accent: #7aa2f7;
  --accent2: #bb9af7;
  --green: #9ece6a;
  --orange: #ff9e64;
  --red: #f7768e;
  --radius: 8px;
}
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'SF Mono','Fira Code','Consolas',monospace; background:var(--bg); color:var(--text); min-height:100vh; }
.header { background:var(--surface); border-bottom:1px solid var(--border); padding:16px 24px; display:flex; align-items:center; gap:16px; }
.header h1 { font-size:18px; color:var(--accent); font-weight:600; }
.header .status { font-size:12px; color:var(--text2); margin-left:auto; }
.size-selector { display:flex; gap:4px; }
.size-btn { padding:6px 14px; border-radius:var(--radius); font-size:12px; font-weight:600; cursor:pointer; border:1px solid var(--border); background:var(--surface2); color:var(--text2); font-family:inherit; transition:all .2s; }
.size-btn.active { background:var(--accent); color:#1a1b26; border-color:var(--accent); }
.size-btn:hover:not(.active) { border-color:var(--accent); color:var(--text); }
.tabs { display:flex; border-bottom:1px solid var(--border); background:var(--surface); padding:0 24px; }
.tab { padding:10px 20px; cursor:pointer; color:var(--text2); font-size:13px; border-bottom:2px solid transparent; transition:all .2s; }
.tab:hover { color:var(--text); }
.tab.active { color:var(--accent); border-bottom-color:var(--accent); }
.content { max-width:1200px; margin:0 auto; padding:24px; }
.panel { display:none; }
.panel.active { display:block; }

/* Controls */
.controls { display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:20px; }
select, input[type=number], input[type=text] {
  background:var(--surface2); border:1px solid var(--border); color:var(--text);
  padding:8px 12px; border-radius:var(--radius); font-size:13px; font-family:inherit;
}
select:focus, input:focus { outline:none; border-color:var(--accent); }
button {
  background:var(--accent); color:#1a1b26; border:none; padding:8px 18px;
  border-radius:var(--radius); font-size:13px; font-weight:600; cursor:pointer; font-family:inherit;
  transition:opacity .2s;
}
button:hover { opacity:0.85; }
button:disabled { opacity:0.4; cursor:not-allowed; }
.btn-secondary { background:var(--surface2); color:var(--text); border:1px solid var(--border); }

/* Cards */
.card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); padding:20px; margin-bottom:16px; }
.card h3 { font-size:14px; color:var(--accent2); margin-bottom:12px; }
.stat-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:12px; }
.stat-item { background:var(--surface2); border-radius:var(--radius); padding:14px; }
.stat-item .label { font-size:11px; color:var(--text2); text-transform:uppercase; letter-spacing:1px; }
.stat-item .value { font-size:22px; font-weight:700; color:var(--text); margin-top:4px; }

/* Table */
table { width:100%; border-collapse:collapse; font-size:13px; }
th { text-align:left; color:var(--text2); font-weight:500; padding:8px 12px; border-bottom:1px solid var(--border); }
td { padding:8px 12px; border-bottom:1px solid var(--surface2); }

/* Board — dynamic via CSS var */
.board-container { display:flex; gap:24px; align-items:flex-start; flex-wrap:wrap; }
.board { display:grid; gap:4px; background:var(--border); padding:4px; border-radius:var(--radius); }
.board.size-5 { grid-template-columns:repeat(5,64px); grid-template-rows:repeat(5,64px); }
.board.size-4 { grid-template-columns:repeat(4,64px); grid-template-rows:repeat(4,64px); }
.tile {
  display:flex; align-items:center; justify-content:center;
  font-size:14px; font-weight:700; border-radius:4px;
  background:var(--surface2); color:var(--text);
}
.tile[data-v="0"] { background:#2a2e42; color:transparent; }
.tile[data-v="2"] { background:#3d5a80; color:#e0e0e0; }
.tile[data-v="4"] { background:#4a7c59; color:#e0e0e0; }
.tile[data-v="8"] { background:#e07c3f; color:#fff; }
.tile[data-v="16"] { background:#d35f5f; color:#fff; }
.tile[data-v="32"] { background:#c74b7a; color:#fff; }
.tile[data-v="64"] { background:#a855f7; color:#fff; }
.tile[data-v="128"] { background:#7c3aed; color:#fff; }
.tile[data-v="256"] { background:#6d28d9; color:#fff; }
.tile[data-v="512"] { background:#4f46e5; color:#fff; }
.tile[data-v="1024"] { background:#2563eb; color:#fff; }
.tile[data-v="2048"] { background:#0ea5e9; color:#fff; }
.tile[data-v="4096"] { background:#06b6d4; color:#fff; }
.tile[data-v="8192"] { background:#14b8a6; color:#fff; }
.tile[data-v="16384"] { background:#10b981; color:#fff; }
.tile[data-v="32768"] { background:#f59e0b; color:#fff; }

/* Replay controls */
.replay-controls { display:flex; align-items:center; gap:12px; margin-top:16px; flex-wrap:wrap; }
.replay-controls input[type=range] { flex:1; min-width:200px; accent-color:var(--accent); }
.step-info { font-size:12px; color:var(--text2); }

/* SVG Chart */
.chart-container { position:relative; }
svg text { font-family:inherit; }

/* Spinner */
.spinner { display:inline-block; width:16px; height:16px; border:2px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin .6s linear infinite; vertical-align:middle; margin-right:8px; }
@keyframes spin { to { transform:rotate(360deg); } }

/* Log tab */
textarea {
  width:100%; min-height:200px; background:var(--surface2); border:1px solid var(--border);
  color:var(--text); padding:12px; border-radius:var(--radius); font-family:inherit; font-size:12px; resize:vertical;
}
.upload-area {
  border:2px dashed var(--border); border-radius:var(--radius); padding:32px; text-align:center;
  color:var(--text2); cursor:pointer; margin-bottom:16px; transition:border-color .2s;
}
.upload-area:hover { border-color:var(--accent); }
.upload-area input { display:none; }

/* GIF Gallery */
.gif-gallery { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:16px; }
.gif-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; cursor:pointer; transition:border-color .2s; }
.gif-card:hover { border-color:var(--accent); }
.gif-card img { width:100%; display:block; image-rendering:pixelated; }
.gif-card .gif-label { padding:8px 12px; font-size:11px; color:var(--text2); word-break:break-all; }
.gif-modal { position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); display:flex; align-items:center; justify-content:center; z-index:1000; }
.gif-modal img { max-width:90vw; max-height:90vh; image-rendering:pixelated; border-radius:var(--radius); }
</style>
</head>
<body>

<div class="header">
  <h1>2048 AI Dashboard</h1>
  <div class="size-selector">
    <button class="size-btn" data-size="4x4">4x4</button>
    <button class="size-btn active" data-size="5x5">5x5</button>
  </div>
  <div class="status" id="networkStatus">No network loaded</div>
</div>

<div class="tabs">
  <div class="tab active" data-tab="evaluate">Evaluate</div>
  <div class="tab" data-tab="replay">Game Replay</div>
  <div class="tab" data-tab="gifs">GIF Gallery</div>
  <div class="tab" data-tab="training">Training Log</div>
</div>

<div class="content">

  <!-- ── Evaluate Tab ── -->
  <div class="panel active" id="panel-evaluate">
    <div class="controls">
      <select id="weightsSelect"><option value="">Select weights...</option></select>
      <button id="loadBtn">Load</button>
      <span style="color:var(--text2)">|</span>
      <label style="font-size:13px;color:var(--text2)">Games:</label>
      <input type="number" id="evalN" value="100" min="1" max="10000" style="width:80px">
      <button id="evalBtn" disabled>Evaluate</button>
      <span id="evalSpinner" style="display:none"><span class="spinner"></span>Running...</span>
    </div>

    <div id="evalResults" style="display:none">
      <div class="card">
        <h3>Results</h3>
        <div class="stat-grid" id="evalStats"></div>
      </div>
      <div class="card">
        <h3>Reach Rates</h3>
        <table id="reachTable"><thead><tr><th>Tile</th><th>Rate</th></tr></thead><tbody></tbody></table>
      </div>
      <div class="card">
        <h3>Tile Distribution</h3>
        <div class="chart-container" id="tileChart"></div>
      </div>
    </div>
  </div>

  <!-- ── Replay Tab ── -->
  <div class="panel" id="panel-replay">
    <div class="controls">
      <button id="playBtn" disabled>Play 1 Game</button>
      <span id="playSpinner" style="display:none"><span class="spinner"></span>Playing...</span>
      <span id="replayInfo" style="font-size:13px;color:var(--text2)"></span>
    </div>

    <div id="replayArea" style="display:none">
      <div class="board-container">
        <div>
          <div class="board size-5" id="gameBoard"></div>
          <div class="replay-controls">
            <button class="btn-secondary" id="replayPrev" title="Previous">&#9664;</button>
            <button class="btn-secondary" id="replayPlayPause" title="Play/Pause">&#9654;</button>
            <button class="btn-secondary" id="replayNext" title="Next">&#9654;</button>
            <button class="btn-secondary" id="replayFast" title="Fast forward">&#9654;&#9654;</button>
            <input type="range" id="replaySlider" min="0" value="0">
            <span class="step-info" id="stepLabel">0 / 0</span>
          </div>
        </div>
        <div class="card" style="min-width:240px;flex:1">
          <h3>Step Info</h3>
          <div id="stepDetails" style="font-size:13px; line-height:1.8;"></div>
        </div>
      </div>
    </div>
  </div>

  <!-- ── GIF Gallery Tab ── -->
  <div class="panel" id="panel-gifs">
    <div class="controls">
      <button id="refreshGifsBtn">Refresh</button>
      <span id="gifCount" style="font-size:13px;color:var(--text2)"></span>
    </div>
    <div class="gif-gallery" id="gifGallery"></div>
  </div>

  <!-- ── Training Log Tab ── -->
  <div class="panel" id="panel-training">
    <div class="controls">
      <select id="logFileSelect"><option value="">Select log file...</option></select>
      <button id="loadLogBtn">Load from Server</button>
      <span style="color:var(--text2)">|</span>
      <button id="parseLogBtn" class="btn-secondary">Parse & Plot</button>
    </div>
    <div class="upload-area" id="uploadArea">
      <p>Or click to upload / paste log text below</p>
      <input type="file" id="logFileInput" accept=".txt,.log">
    </div>
    <textarea id="logText" placeholder="Paste training log output here..."></textarea>
    <div id="logCharts" style="display:none">
      <div class="card">
        <h3>Average Score vs Episode</h3>
        <div class="chart-container" id="scoreChart"></div>
      </div>
      <div class="card">
        <h3>Reach Rates Over Time</h3>
        <div class="chart-container" id="reachChart"></div>
      </div>
    </div>
  </div>

</div>

<script>
// ── Utilities ──
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const DIR_NAMES = ['Up','Right','Down','Left'];
let currentBoardSize = '5x5';

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  return res.json();
}
async function apiPost(path, body) {
  return api(path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
}

function getBoardDim() {
  return currentBoardSize === '4x4' ? 4 : 5;
}

// ── Size selector ──
$$('.size-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.size-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentBoardSize = btn.dataset.size;
    // Reset state
    $('#networkStatus').textContent = 'No network loaded';
    $('#evalBtn').disabled = true;
    $('#playBtn').disabled = true;
    $('#evalResults').style.display = 'none';
    $('#replayArea').style.display = 'none';
    loadWeightsList();
  });
});

// ── Tab switching ──
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    $('#panel-' + tab.dataset.tab).classList.add('active');
    // Auto-load GIFs when switching to gallery
    if (tab.dataset.tab === 'gifs') loadGifs();
  });
});

// ── Load weights list ──
async function loadWeightsList() {
  const data = await api('/api/weights?size=' + currentBoardSize);
  const sel = $('#weightsSelect');
  sel.innerHTML = '<option value="">Select weights...</option>';
  data.files.forEach(f => {
    const o = document.createElement('option');
    o.value = f; o.textContent = f;
    sel.appendChild(o);
  });
}
loadWeightsList();

// ── Load weights ──
$('#loadBtn').addEventListener('click', async () => {
  const file = $('#weightsSelect').value;
  if (!file) return;
  $('#loadBtn').disabled = true;
  $('#loadBtn').textContent = 'Loading...';
  try {
    const data = await apiPost('/api/load', { file, size: currentBoardSize });
    if (data.error) { alert(data.error); return; }
    $('#networkStatus').textContent = '[' + currentBoardSize + '] ' + file + ' | ' + data.stats.totalMB + ' MB | ' + data.stats.totalVariants + ' variants';
    $('#evalBtn').disabled = false;
    $('#playBtn').disabled = false;
  } catch(e) { alert('Load failed: ' + e.message); }
  finally { $('#loadBtn').disabled = false; $('#loadBtn').textContent = 'Load'; }
});

// ── Evaluate ──
$('#evalBtn').addEventListener('click', async () => {
  const n = parseInt($('#evalN').value) || 100;
  $('#evalBtn').disabled = true;
  $('#evalSpinner').style.display = 'inline';
  try {
    const data = await apiPost('/api/evaluate', { n });
    if (data.error) { alert(data.error); return; }
    showEvalResults(data);
  } catch(e) { alert('Evaluate failed: ' + e.message); }
  finally { $('#evalBtn').disabled = false; $('#evalSpinner').style.display = 'none'; }
});

function showEvalResults(data) {
  $('#evalResults').style.display = 'block';
  $('#evalStats').innerHTML =
    statItem('Avg Score', Math.round(data.avgScore).toLocaleString()) +
    statItem('Median Score', Math.round(data.medScore).toLocaleString()) +
    statItem('Games', data.numGames);

  const tbody = $('#reachTable tbody');
  tbody.innerHTML = '';
  for (const [tile, rate] of Object.entries(data.reachRates)) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + Number(tile).toLocaleString() + '</td><td>' + rate + '</td>';
    tbody.appendChild(tr);
  }

  renderTileDistChart(data.tileDist, data.numGames);
}

function statItem(label, value) {
  return '<div class="stat-item"><div class="label">' + label + '</div><div class="value">' + value + '</div></div>';
}

// ── SVG Bar Chart for tile distribution ──
function renderTileDistChart(dist, total) {
  const entries = Object.entries(dist).map(([k,v]) => [Number(k), v]).sort((a,b) => a[0] - b[0]);
  if (!entries.length) return;

  const W = 600, H = 280, pad = {t:20,r:20,b:50,l:60};
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const maxVal = Math.max(...entries.map(e => e[1]));
  const barW = Math.min(50, iw / entries.length - 4);

  let svg = '<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">';

  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const y = pad.t + ih - (ih * i / yTicks);
    const val = Math.round(maxVal * i / yTicks);
    svg += '<line x1="'+pad.l+'" y1="'+y+'" x2="'+(W-pad.r)+'" y2="'+y+'" stroke="#3b4261" stroke-width="1"/>';
    svg += '<text x="'+(pad.l-8)+'" y="'+(y+4)+'" text-anchor="end" fill="#a9b1d6" font-size="11">'+val+'</text>';
  }

  entries.forEach(([tile, count], i) => {
    const x = pad.l + (iw / entries.length) * i + (iw / entries.length - barW) / 2;
    const bh = (count / maxVal) * ih;
    const y = pad.t + ih - bh;
    const pct = (count / total * 100).toFixed(1);
    svg += '<rect x="'+x+'" y="'+y+'" width="'+barW+'" height="'+bh+'" fill="#7aa2f7" rx="3"/>';
    svg += '<text x="'+(x+barW/2)+'" y="'+(y-5)+'" text-anchor="middle" fill="#c0caf5" font-size="10">'+pct+'%</text>';
    svg += '<text x="'+(x+barW/2)+'" y="'+(H-pad.b+16)+'" text-anchor="middle" fill="#a9b1d6" font-size="11">'+(tile >= 1024 ? (tile/1024)+'k' : tile)+'</text>';
  });

  svg += '</svg>';
  $('#tileChart').innerHTML = svg;
}

// ── Replay ──
let replayData = null;
let replayIdx = 0;
let replayTimer = null;
let replaySpeed = 200;

$('#playBtn').addEventListener('click', async () => {
  $('#playBtn').disabled = true;
  $('#playSpinner').style.display = 'inline';
  stopReplay();
  try {
    const data = await apiPost('/api/play', {});
    if (data.error) { alert(data.error); return; }
    replayData = data;
    replayIdx = 0;
    const dim = data.boardSize || getBoardDim();
    const board = $('#gameBoard');
    board.className = 'board size-' + dim;
    $('#replayArea').style.display = 'block';
    $('#replaySlider').max = data.steps.length - 1;
    $('#replaySlider').value = 0;
    $('#replayInfo').textContent = 'Score: ' + data.finalScore.toLocaleString() + ' | Max: ' + data.maxTile.toLocaleString() + ' | Steps: ' + data.totalSteps;
    renderStep();
  } catch(e) { alert('Play failed: ' + e.message); }
  finally { $('#playBtn').disabled = false; $('#playSpinner').style.display = 'none'; }
});

function renderStep() {
  if (!replayData) return;
  const step = replayData.steps[replayIdx];
  const dim = replayData.boardSize || getBoardDim();
  const board = $('#gameBoard');
  board.innerHTML = '';
  for (let r = 0; r < dim; r++) {
    for (let c = 0; c < dim; c++) {
      const v = step.grid[r][c];
      const d = document.createElement('div');
      d.className = 'tile';
      d.setAttribute('data-v', v);
      d.textContent = v || '';
      board.appendChild(d);
    }
  }
  $('#stepLabel').textContent = replayIdx + ' / ' + (replayData.steps.length - 1);
  $('#replaySlider').value = replayIdx;

  let info = 'Step: ' + replayIdx + ' / ' + (replayData.steps.length - 1);
  if (step.direction !== null) {
    info += '\\nDirection: ' + DIR_NAMES[step.direction];
    info += '\\nReward: ' + step.reward.toLocaleString();
  }
  info += '\\nCumulative Score: ' + step.cumulativeScore.toLocaleString();
  if (step.vAfterstate !== null) info += '\\nV(afterstate): ' + step.vAfterstate.toLocaleString();
  $('#stepDetails').innerHTML = info.split('\\n').join('<br>');
}

$('#replaySlider').addEventListener('input', e => {
  replayIdx = parseInt(e.target.value);
  renderStep();
});

$('#replayPrev').addEventListener('click', () => {
  if (replayIdx > 0) { replayIdx--; renderStep(); }
});
$('#replayNext').addEventListener('click', () => {
  if (replayData && replayIdx < replayData.steps.length - 1) { replayIdx++; renderStep(); }
});
$('#replayPlayPause').addEventListener('click', () => {
  if (replayTimer) { stopReplay(); } else { startReplay(); }
});
$('#replayFast').addEventListener('click', () => {
  replaySpeed = replaySpeed === 200 ? 50 : 200;
  if (replayTimer) { stopReplay(); startReplay(); }
});

function startReplay() {
  if (!replayData) return;
  $('#replayPlayPause').innerHTML = '&#9646;&#9646;';
  replayTimer = setInterval(() => {
    if (replayIdx >= replayData.steps.length - 1) { stopReplay(); return; }
    replayIdx++;
    renderStep();
  }, replaySpeed);
}
function stopReplay() {
  clearInterval(replayTimer);
  replayTimer = null;
  $('#replayPlayPause').innerHTML = '&#9654;';
}

// ── GIF Gallery ──
async function loadGifs() {
  const data = await api('/api/gifs');
  const gallery = $('#gifGallery');
  gallery.innerHTML = '';
  $('#gifCount').textContent = data.files.length + ' GIFs';

  if (data.files.length === 0) {
    gallery.innerHTML = '<p style="color:var(--text2);font-size:13px;grid-column:1/-1">No GIF files found. Run training with GIF recording enabled.</p>';
    return;
  }

  data.files.forEach(f => {
    const card = document.createElement('div');
    card.className = 'gif-card';
    card.innerHTML = '<img src="/gifs/' + f + '" alt="' + f + '" loading="lazy"><div class="gif-label">' + f + '</div>';
    card.addEventListener('click', () => showGifModal('/gifs/' + f));
    gallery.appendChild(card);
  });
}

$('#refreshGifsBtn').addEventListener('click', loadGifs);

function showGifModal(src) {
  const modal = document.createElement('div');
  modal.className = 'gif-modal';
  modal.innerHTML = '<img src="' + src + '">';
  modal.addEventListener('click', () => modal.remove());
  document.body.appendChild(modal);
}

// ── Training Log ──

// Load available log files from server
async function loadLogFileList() {
  try {
    const data = await api('/api/logs');
    const sel = $('#logFileSelect');
    sel.innerHTML = '<option value="">Select log file...</option>';
    data.files.forEach(f => {
      const o = document.createElement('option');
      o.value = f; o.textContent = f;
      sel.appendChild(o);
    });
  } catch(e) {}
}
loadLogFileList();

$('#loadLogBtn').addEventListener('click', async () => {
  const file = $('#logFileSelect').value;
  if (!file) return;
  $('#loadLogBtn').disabled = true;
  $('#loadLogBtn').textContent = 'Loading...';
  try {
    const data = await api('/api/log?file=' + encodeURIComponent(file));
    if (data.error) { alert(data.error); return; }
    $('#logText').value = data.text;
    // Auto-parse
    const parsed = parseTrainingLog(data.text);
    if (parsed.length > 0) {
      $('#logCharts').style.display = 'block';
      renderScoreChart(parsed);
      renderReachRateChart(parsed);
    }
  } catch(e) { alert('Load failed: ' + e.message); }
  finally { $('#loadLogBtn').disabled = false; $('#loadLogBtn').textContent = 'Load from Server'; }
});

$('#uploadArea').addEventListener('click', () => $('#logFileInput').click());
$('#logFileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => { $('#logText').value = ev.target.result; };
  reader.readAsText(file);
});

$('#parseLogBtn').addEventListener('click', () => {
  const text = $('#logText').value;
  if (!text.trim()) return;
  const parsed = parseTrainingLog(text);
  if (parsed.length === 0) { alert('No parseable training data found.'); return; }
  $('#logCharts').style.display = 'block';
  renderScoreChart(parsed);
  renderReachRateChart(parsed);
});

function extractReachRates(line) {
  const rates = {};
  const thresholds = ['512','1024','2048','4096','8192','16384'];
  for (const t of thresholds) {
    const m = line.match(new RegExp('"' + t + '"\\s*:\\s*"([\\d.]+)%"'));
    if (m) rates['r' + t] = parseFloat(m[1]);
  }
  return rates;
}

function parseTrainingLog(text) {
  const entries = [];
  const lines = text.split('\\n');
  let lastEntry = null;

  for (const line of lines) {
    let m;

    // Episode line: "Episode 5000/100000 | Avg Score: 15921 | ..."
    m = line.match(/(?:Episode|Ep)\\s+(\\d+).*?(?:Avg\\s*(?:Score)?|avg)\\s*[=:]\\s*([\\d.]+)/i);
    if (m) {
      const entry = { episode: parseInt(m[1]), avgScore: parseFloat(m[2]) };
      Object.assign(entry, extractReachRates(line));
      entries.push(entry);
      lastEntry = entry;
      continue;
    }

    // Eval Avg Score line: "  Eval Avg Score: 32437 | Med Score: 34792"
    m = line.match(/Eval Avg Score:\\s*([\\d.]+)/);
    if (m && lastEntry) {
      lastEntry.evalAvg = parseFloat(m[1]);
      continue;
    }

    // Reach rates on separate line: '  Reach rates: {"512":"98.0%",...}'
    if (line.includes('Reach rates:') && lastEntry) {
      Object.assign(lastEntry, extractReachRates(line));
      continue;
    }

    // Fallback: "[N] avg=X" format
    m = line.match(/\\[(\\d+)\\].*?avg\\s*[=:]\\s*([\\d.]+)/i);
    if (m) {
      const entry = { episode: parseInt(m[1]), avgScore: parseFloat(m[2]) };
      Object.assign(entry, extractReachRates(line));
      entries.push(entry);
      lastEntry = entry;
    }
  }
  return entries;
}

// ── SVG Line Chart ──
function svgLineChart(datasets, labels, W, H) {
  const pad = {t:30, r:80, b:50, l:70};
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const allX = datasets[0].data.map(d => d.x);
  const allY = datasets.flatMap(ds => ds.data.map(d => d.y));
  const xMin = Math.min(...allX), xMax = Math.max(...allX);
  const yMin = Math.min(0, Math.min(...allY)), yMax = Math.max(...allY) * 1.1;

  const sx = v => pad.l + (xMax === xMin ? iw/2 : (v - xMin) / (xMax - xMin) * iw);
  const sy = v => pad.t + ih - (yMax === yMin ? ih/2 : (v - yMin) / (yMax - yMin) * ih);

  let svg = '<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">';

  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const val = yMin + (yMax - yMin) * i / yTicks;
    const y = sy(val);
    svg += '<line x1="'+pad.l+'" y1="'+y+'" x2="'+(W-pad.r)+'" y2="'+y+'" stroke="#3b4261" stroke-width="1"/>';
    svg += '<text x="'+(pad.l-8)+'" y="'+(y+4)+'" text-anchor="end" fill="#a9b1d6" font-size="11">'+(val >= 1000 ? Math.round(val/1000)+'k' : Math.round(val))+'</text>';
  }

  const xTicks = Math.min(6, allX.length);
  for (let i = 0; i < xTicks; i++) {
    const idx = Math.round(i * (allX.length - 1) / (xTicks - 1 || 1));
    const val = allX[idx];
    svg += '<text x="'+sx(val)+'" y="'+(H-pad.b+20)+'" text-anchor="middle" fill="#a9b1d6" font-size="11">'+(val >= 1000 ? (val/1000)+'k' : val)+'</text>';
  }

  svg += '<text x="'+(W/2)+'" y="'+(H-5)+'" text-anchor="middle" fill="#a9b1d6" font-size="12">'+labels.x+'</text>';

  const colors = ['#7aa2f7','#9ece6a','#ff9e64','#f7768e','#bb9af7','#0ea5e9'];

  datasets.forEach((ds, di) => {
    if (ds.data.length < 2) return;
    const pts = ds.data.map(d => sx(d.x)+','+sy(d.y)).join(' ');
    svg += '<polyline points="'+pts+'" fill="none" stroke="'+colors[di % colors.length]+'" stroke-width="2"/>';
    const ly = pad.t + di * 18;
    svg += '<line x1="'+(W-pad.r+10)+'" y1="'+ly+'" x2="'+(W-pad.r+25)+'" y2="'+ly+'" stroke="'+colors[di % colors.length]+'" stroke-width="2"/>';
    svg += '<text x="'+(W-pad.r+30)+'" y="'+(ly+4)+'" fill="#c0caf5" font-size="11">'+ds.label+'</text>';
  });

  svg += '</svg>';
  return svg;
}

function renderScoreChart(data) {
  const ds = [{ label: 'Avg Score', data: data.map(d => ({x: d.episode, y: d.avgScore})) }];
  $('#scoreChart').innerHTML = svgLineChart(ds, {x:'Episode'}, 700, 320);
}

function renderReachRateChart(data) {
  const datasets = [];
  const keys = [
    {k:'r512', label:'512'},
    {k:'r1024', label:'1024'},
    {k:'r2048', label:'2048'},
    {k:'r4096', label:'4096'},
    {k:'r8192', label:'8192'},
    {k:'r16384', label:'16384'},
  ];
  for (const {k, label} of keys) {
    const pts = data.filter(d => d[k] !== undefined).map(d => ({x: d.episode, y: d[k]}));
    if (pts.length > 0) datasets.push({label, data: pts});
  }
  if (datasets.length === 0) {
    $('#reachChart').innerHTML = '<p style="color:var(--text2);font-size:13px">No reach rate data found in log</p>';
    return;
  }
  $('#reachChart').innerHTML = svgLineChart(datasets, {x:'Episode'}, 700, 320);
}
</script>
</body>
</html>`;
