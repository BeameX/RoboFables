const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const PORT = process.env.PORT || 8080;
const CHANNEL = (process.env.ROBOFABLES_CHANNEL || 'latest').trim();
const BUILD = (process.env.ROBOFABLES_BUILD || '').trim();
const tag = CHANNEL === 'build' ? `web-${BUILD || '1'}` : `web-${CHANNEL}`;
const API = `https://api.github.com/repos/BeameX/RoboFables/releases/tags/${tag}`;
const root = path.join(process.env.ROBOFABLES_DIR || path.join(os.tmpdir(), 'robofables-site'));
const stateFile = path.join(root, '.asset-id');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'RoboFables', Accept: 'application/vnd.github+json' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

function unzip(zipPath, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force -Path '${zipPath}' -DestinationPath '${dest}'`], { stdio: 'ignore' });
  } else {
    execFileSync('tar', ['-xf', zipPath, '-C', dest], { stdio: 'ignore' });
  }
}

async function refresh() {
  const meta = await get(API);
  if (meta.status !== 200) return;
  const rel = JSON.parse(meta.body.toString());
  const asset = (rel.assets || []).find((a) => a.name === 'site.zip');
  if (!asset) return;
  const prev = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8').trim() : '';
  if (String(asset.id) === prev && fs.existsSync(path.join(root, 'index.html'))) return;
  fs.mkdirSync(root, { recursive: true });
  const zipPath = path.join(root, 'site.zip');
  const bin = await get(asset.browser_download_url);
  fs.writeFileSync(zipPath, bin.body);
  const staging = path.join(root, 'staging');
  fs.rmSync(staging, { recursive: true, force: true });
  unzip(zipPath, staging);
  for (const name of fs.readdirSync(staging)) {
    if (name === 'staging') continue;
    const from = path.join(staging, name);
    const to = path.join(root, name);
    fs.rmSync(to, { recursive: true, force: true });
    fs.renameSync(from, to);
  }
  fs.rmSync(staging, { recursive: true, force: true });
  fs.writeFileSync(stateFile, String(asset.id));
  console.log('updated', tag, asset.id);
}

setInterval(() => { refresh().catch((err) => console.error(err.message)); }, 60 * 1000);
refresh().catch((err) => console.error(err.message));

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.json': 'application/json' };
http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(503); res.end('updating'); return;
  }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('listening', PORT, tag));
