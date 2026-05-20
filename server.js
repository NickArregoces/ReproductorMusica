const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const MEDIA_DIR = path.join(ROOT, 'media');
const PLAYLIST_FILE = path.join(ROOT, 'playlist.json');
const PORT = Number(process.env.PORT) || 3000;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg'
};

if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

function sanitizeFilename(name) {
  const base = path.basename(name, path.extname(name));
  return base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase() || 'cancion';
}

function uniqueMp3Name(original) {
  let filename = `${sanitizeFilename(original)}.mp3`;
  let fullPath = path.join(MEDIA_DIR, filename);
  let counter = 1;

  while (fs.existsSync(fullPath)) {
    filename = `${sanitizeFilename(original)}-${counter}.mp3`;
    fullPath = path.join(MEDIA_DIR, filename);
    counter += 1;
  }

  return filename;
}

function readPlaylistMeta() {
  if (!fs.existsSync(PLAYLIST_FILE)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(PLAYLIST_FILE, 'utf8'));
}

function writePlaylistMeta(entries) {
  fs.writeFileSync(PLAYLIST_FILE, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

function buildPlaylist() {
  const metaEntries = readPlaylistMeta();
  const metaByFile = new Map(metaEntries.map((entry) => [entry.file, entry]));
  const files = fs
    .readdirSync(MEDIA_DIR)
    .filter((file) => file.toLowerCase().endsWith('.mp3'))
    .sort();

  return files.map((file) => {
    const meta = metaByFile.get(file) || {};
    const titleFromFile = file.replace(/\.mp3$/i, '').replace(/-/g, ' ');

    return {
      file,
      src: `./media/${file}`,
      artist: meta.artist || 'Artista desconocido',
      song: meta.song || titleFromFile
    };
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) {
        reject(new Error('El archivo supera el límite de 50 MB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res, pathname) {
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME_TYPES[extension] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

async function handleUpload(req, res) {
  let payload;

  try {
    const rawBody = await readRequestBody(req);
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    sendJson(res, 400, { error: 'Petición inválida' });
    return;
  }

  const { filename, data, artist, title } = payload;

  if (!filename || !data) {
    sendJson(res, 400, { error: 'Archivo MP3 requerido' });
    return;
  }

  if (!filename.toLowerCase().endsWith('.mp3')) {
    sendJson(res, 400, { error: 'Solo se permiten archivos MP3' });
    return;
  }

  let fileBuffer;
  try {
    fileBuffer = Buffer.from(data, 'base64');
  } catch {
    sendJson(res, 400, { error: 'No se pudo leer el archivo' });
    return;
  }

  const savedName = uniqueMp3Name(filename);
  fs.writeFileSync(path.join(MEDIA_DIR, savedName), fileBuffer);

  const metaEntries = readPlaylistMeta();
  const titleFromFile = savedName.replace(/\.mp3$/i, '').replace(/-/g, ' ');

  metaEntries.push({
    file: savedName,
    artist: (artist || '').trim() || 'Artista desconocido',
    song: (title || '').trim() || titleFromFile
  });

  writePlaylistMeta(metaEntries);

  const playlist = buildPlaylist();
  const track = playlist.find((item) => item.file === savedName);

  sendJson(res, 201, { track, playlist });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === 'GET' && pathname === '/api/playlist') {
    sendJson(res, 200, buildPlaylist());
    return;
  }

  if (req.method === 'POST' && pathname === '/api/songs') {
    await handleUpload(req, res);
    return;
  }

  const filePath = pathname === '/' ? '/index.html' : pathname;
  serveStatic(req, res, filePath);
});

server.listen(PORT, () => {
  console.log(`Reproductor: http://localhost:${PORT}`);
});
