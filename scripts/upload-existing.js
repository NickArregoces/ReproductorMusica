const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MEDIA_DIR = path.join(ROOT, 'media');
const PLAYLIST_FILE = path.join(ROOT, 'playlist.json');

const SUPABASE_URL = 'https://dxmgcjcyvvlxdriwylhl.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR4bWdjamN5dnZseGRyaXd5bGhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMzg0MDgsImV4cCI6MjA5NDgxNDQwOH0.R7vblm5RndfM_gue-2Xqj-4Zx0UOe_1nhQORGodXgLA';
const BUCKET = 'song';

const headers = {
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  apikey: SUPABASE_ANON_KEY
};

async function storageUpload(filePath, buffer) {
  const url = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(filePath).replace(/%2F/g, '/')}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'audio/mpeg',
      'x-upsert': 'true'
    },
    body: buffer
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Storage (${response.status}): ${message}`);
  }
}

async function upsertTrack(record) {
  const url = `${SUPABASE_URL}/rest/v1/tracks?on_conflict=file_path`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(record)
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`DB (${response.status}): ${message}`);
  }
}

async function uploadTrack({ file, artist, song }) {
  const localPath = path.join(MEDIA_DIR, file);

  if (!fs.existsSync(localPath)) {
    console.warn(`Omitido (no existe): ${file}`);
    return;
  }

  const buffer = fs.readFileSync(localPath);
  await storageUpload(file, buffer);
  await upsertTrack({
    file_path: file,
    artist,
    song
  });

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${file}`;
  console.log(`OK: ${artist} — ${song}`);
  console.log(`    ${publicUrl}`);
}

async function main() {
  const playlist = JSON.parse(fs.readFileSync(PLAYLIST_FILE, 'utf8'));

  console.log(`Subiendo ${playlist.length} canción(es) al bucket "${BUCKET}"...\n`);

  for (const track of playlist) {
    await uploadTrack(track);
  }

  console.log('\nListo.');
}

main().catch((error) => {
  console.error('\nError:', error.message);
  console.error('Ejecuta supabase/setup.sql en el SQL Editor de Supabase si aún no lo hiciste.');
  process.exit(1);
});
