const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let playlist = [];

function trackFromRow(row) {
  const { data } = supabaseClient.storage.from(STORAGE_BUCKET).getPublicUrl(row.file_path);
  return {
    id: row.id,
    file: row.file_path,
    src: data.publicUrl,
    artist: row.artist,
    song: row.song
  };
}

function buildStoragePath(fileName) {
  const safe = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9.-]/g, '-')
    .toLowerCase();
  return `${Date.now()}-${safe.endsWith('.mp3') ? safe : `${safe}.mp3`}`;
}

const audio = document.getElementById('audio');
const playPause = document.getElementById('play');
const progress = document.getElementById('progress');
const timeStart = document.getElementById('timeStart');
const timeEnd = document.getElementById('timeEnd');
const artistEl = document.getElementById('artist');
const songEl = document.getElementById('song');
const coverEl = document.getElementById('cover');
const coverPlaceholder = document.getElementById('coverPlaceholder');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');
const btnPlaylist = document.getElementById('btnPlaylist');
const btnBackFromPlaylist = document.getElementById('btnBackFromPlaylist');
const btnClosePlaylist = document.getElementById('btnClosePlaylist');
const btnShuffle = document.getElementById('btnShuffle');
const btnRepeatOne = document.getElementById('btnRepeatOne');
const btnRepeatAll = document.getElementById('btnRepeatAll');
const playerView = document.getElementById('playerView');
const playlistView = document.getElementById('playlistView');
const playlistList = document.getElementById('playlistList');
const btnAddSong = document.getElementById('btnAddSong');
const songInput = document.getElementById('songInput');
const uploadStatus = document.getElementById('uploadStatus');

const tagCache = new Map();

let currentIndex = 0;
let isSeeking = false;
let isShuffle = false;
let repeatMode = 'off';
let shuffleOrder = [];
let shufflePosition = 0;
let coverObjectUrl = null;

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '00:00';
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function setPlayPauseUI(isPlaying) {
  playPause.querySelector('.play-btn').classList.toggle('hide', isPlaying);
  playPause.querySelector('.pause-btn').classList.toggle('hide', !isPlaying);
}

function setProgress(percent) {
  const value = Math.min(100, Math.max(0, percent));
  progress.value = value;
  progress.style.setProperty('--value', `${value}%`);
}

function updateProgress() {
  if (!audio.duration || isSeeking) {
    return;
  }
  setProgress((audio.currentTime / audio.duration) * 100);
  timeStart.textContent = formatTime(audio.currentTime);
}

function coverUrlFromPicture(picture) {
  if (!picture?.data) {
    return null;
  }

  return URL.createObjectURL(
    new Blob([new Uint8Array(picture.data)], { type: picture.format })
  );
}

function releaseCoverUrl(url) {
  if (!url) {
    return;
  }

  const cachedUrls = [...tagCache.values()]
    .map((tags) => tags?.coverUrl)
    .filter(Boolean);

  if (!cachedUrls.includes(url)) {
    URL.revokeObjectURL(url);
  }
}

function showCoverPlaceholder(alt = '') {
  if (coverObjectUrl) {
    releaseCoverUrl(coverObjectUrl);
    coverObjectUrl = null;
  }

  coverEl.hidden = true;
  coverEl.removeAttribute('src');
  coverEl.alt = alt;
  coverPlaceholder.hidden = false;
}

function showEmbeddedCover(url, alt) {
  if (coverObjectUrl && coverObjectUrl !== url) {
    releaseCoverUrl(coverObjectUrl);
  }

  coverObjectUrl = url;
  coverPlaceholder.hidden = true;
  coverEl.hidden = false;
  coverEl.alt = alt;
  coverEl.style.opacity = '0';
  coverEl.onerror = () => showCoverPlaceholder(alt);
  coverEl.onload = () => {
    coverEl.style.opacity = '1';
  };
  coverEl.src = url;

  if (coverEl.complete) {
    coverEl.style.opacity = '1';
  }
}

function readMediaTags(src) {
  if (tagCache.has(src)) {
    return Promise.resolve(tagCache.get(src));
  }

  if (typeof jsmediatags === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const onSuccess = (tag) => {
      const tags = tag.tags ?? {};
      const result = {
        artist: tags.artist || tags.albumartist || null,
        title: tags.title || null,
        coverUrl: coverUrlFromPicture(tags.picture)
      };
      tagCache.set(src, result);
      resolve(result);
    };

    const onError = () => {
      tagCache.set(src, null);
      resolve(null);
    };

    const isRemote = src.startsWith('http://') || src.startsWith('https://');

    if (isRemote) {
      fetch(src)
        .then((response) => response.blob())
        .then((blob) => window.jsmediatags.read(blob, { onSuccess, onError }))
        .catch(onError);
      return;
    }

    window.jsmediatags.read(src, { onSuccess, onError });
  });
}

function cacheTagsFromFile(src, tags) {
  if (!tags) {
    tagCache.set(src, null);
    return;
  }

  tagCache.set(src, {
    artist: tags.artist || tags.albumartist || null,
    title: tags.title || null,
    coverUrl: coverUrlFromPicture(tags.picture)
  });
}

async function applyEmbeddedMetadata(track) {
  const tags = await readMediaTags(track.src);

  if (tags?.artist) {
    artistEl.textContent = tags.artist;
  }
  if (tags?.title) {
    songEl.textContent = tags.title;
  }

  const alt = `${artistEl.textContent} - ${songEl.textContent}`;

  if (tags?.coverUrl) {
    showEmbeddedCover(tags.coverUrl, alt);
    return;
  }

  showCoverPlaceholder(alt);
}

function buildShuffleOrder() {
  shuffleOrder = playlist.map((_, index) => index);
  for (let i = shuffleOrder.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffleOrder[i], shuffleOrder[j]] = [shuffleOrder[j], shuffleOrder[i]];
  }
  shufflePosition = Math.max(0, shuffleOrder.indexOf(currentIndex));
}

function syncShufflePosition() {
  if (!isShuffle) {
    return;
  }
  shufflePosition = shuffleOrder.indexOf(currentIndex);
  if (shufflePosition === -1) {
    buildShuffleOrder();
  }
}

function getNextIndex() {
  if (repeatMode === 'one') {
    return currentIndex;
  }

  if (isShuffle) {
    if (shufflePosition >= shuffleOrder.length - 1) {
      if (repeatMode === 'all') {
        buildShuffleOrder();
        shufflePosition = 0;
        return shuffleOrder[0];
      }
      return currentIndex;
    }
    shufflePosition += 1;
    return shuffleOrder[shufflePosition];
  }

  if (currentIndex >= playlist.length - 1) {
    return repeatMode === 'all' ? 0 : currentIndex;
  }

  return currentIndex + 1;
}

function getPrevIndex() {
  if (repeatMode === 'one') {
    return currentIndex;
  }

  if (isShuffle) {
    if (shufflePosition <= 0) {
      return repeatMode === 'all' ? shuffleOrder[shuffleOrder.length - 1] : currentIndex;
    }
    shufflePosition -= 1;
    return shuffleOrder[shufflePosition];
  }

  if (currentIndex <= 0) {
    return repeatMode === 'all' ? playlist.length - 1 : currentIndex;
  }

  return currentIndex - 1;
}

function setModeButtonState(button, active) {
  button.classList.toggle('is-active', active);
  button.setAttribute('aria-pressed', String(active));
}

function updateModeButtons() {
  setModeButtonState(btnShuffle, isShuffle);
  setModeButtonState(btnRepeatOne, repeatMode === 'one');
  setModeButtonState(btnRepeatAll, repeatMode === 'all');
}

function loadTrack(index, autoplay = false) {
  currentIndex = index;
  const track = playlist[index];

  audio.src = track.src;
  artistEl.textContent = track.artist;
  songEl.textContent = track.song;
  showCoverPlaceholder(`${track.artist} - ${track.song}`);
  applyEmbeddedMetadata(track);

  setProgress(0);
  timeStart.textContent = '00:00';
  timeEnd.textContent = '00:00';

  syncShufflePosition();
  highlightPlaylistItem();
  audio.load();

  if (autoplay) {
    audio.play().then(() => setPlayPauseUI(true)).catch(() => setPlayPauseUI(false));
  } else {
    setPlayPauseUI(false);
  }
}

function highlightPlaylistItem() {
  playlistList.querySelectorAll('li').forEach((item, index) => {
    item.classList.toggle('player__playlist-item--active', index === currentIndex);
  });
}

function play() {
  audio.play().then(() => setPlayPauseUI(true)).catch(() => setPlayPauseUI(false));
}

function pause() {
  audio.pause();
  setPlayPauseUI(false);
}

function togglePlayPause() {
  if (audio.paused || audio.ended) {
    play();
  } else {
    pause();
  }
}

function prevTrack() {
  loadTrack(getPrevIndex(), true);
}

function nextTrack() {
  loadTrack(getNextIndex(), true);
}

function onTrackEnded() {
  if (repeatMode === 'one') {
    audio.currentTime = 0;
    play();
    return;
  }

  const nextIndex = getNextIndex();
  if (nextIndex === currentIndex) {
    setPlayPauseUI(false);
    return;
  }

  loadTrack(nextIndex, true);
}

function showPlaylist() {
  playerView.classList.add('hide');
  playlistView.classList.remove('hide');
}

function showPlayer() {
  playlistView.classList.add('hide');
  playerView.classList.remove('hide');
}

function readTagsFromFile(file) {
  return new Promise((resolve) => {
    if (typeof jsmediatags === 'undefined') {
      resolve(null);
      return;
    }

    window.jsmediatags.read(file, {
      onSuccess(tag) {
        resolve(tag.tags ?? null);
      },
      onError() {
        resolve(null);
      }
    });
  });
}

function showUploadStatus(message, isError = false) {
  uploadStatus.hidden = false;
  uploadStatus.textContent = message;
  uploadStatus.classList.toggle('is-error', isError);
}

function hideUploadStatus() {
  uploadStatus.hidden = true;
  uploadStatus.classList.remove('is-error');
}

function isMp3File(file) {
  const name = file.name.toLowerCase();
  return name.endsWith('.mp3') || file.type === 'audio/mpeg' || file.type === 'audio/mp3';
}

async function fetchPlaylist() {
  const { data, error } = await supabaseClient
    .from('tracks')
    .select('id, file_path, artist, song')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Supabase playlist:', error.message);
    if (error.message.includes('tracks')) {
      showUploadStatus(
        'Falta la tabla tracks. Ejecuta supabase/setup.sql en Supabase → SQL Editor.',
        true
      );
    }
    return [];
  }

  return (data ?? []).map(trackFromRow);
}

function setPlaylist(tracks) {
  playlist = tracks;
  tagCache.clear();
  renderPlaylist();

  if (playlist.length === 0) {
    return;
  }

  if (currentIndex >= playlist.length) {
    currentIndex = 0;
  }
}

function renderPlaylist() {
  playlistList.innerHTML = '';

  playlist.forEach((track, index) => {
    const item = document.createElement('li');
    item.className = 'player__playlist-item';
    item.textContent = `${track.artist} — ${track.song}`;
    item.addEventListener('click', () => {
      loadTrack(index, true);
      showPlayer();
    });
    playlistList.appendChild(item);
  });

  highlightPlaylistItem();
}

async function uploadSong(file) {
  if (!isMp3File(file)) {
    showUploadStatus('Solo se permiten archivos MP3', true);
    return;
  }

  showUploadStatus('Subiendo a Supabase...');

  const tags = await readTagsFromFile(file);
  const filePath = buildStoragePath(file.name);
  const titleFromFile = file.name.replace(/\.mp3$/i, '').replace(/-/g, ' ');
  const artist = tags?.artist || 'Artista desconocido';
  const song = tags?.title || titleFromFile;

  try {
    const { error: uploadError } = await supabaseClient.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, { contentType: 'audio/mpeg' });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const { error: dbError } = await supabaseClient.from('tracks').insert({
      file_path: filePath,
      artist,
      song
    });

    if (dbError) {
      throw new Error(dbError.message);
    }

    const tracks = await fetchPlaylist();
    setPlaylist(tracks);
    const { data: urlData } = supabaseClient.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
    cacheTagsFromFile(urlData.publicUrl, tags);

    const newIndex = tracks.findIndex((track) => track.file === filePath);
    loadTrack(newIndex >= 0 ? newIndex : tracks.length - 1, true);
    showUploadStatus('Canción guardada');
    setTimeout(hideUploadStatus, 2500);
  } catch (error) {
    showUploadStatus(error.message, true);
  }
}

async function handleSongSelected(event) {
  const file = event.target.files?.[0];
  event.target.value = '';

  if (!file) {
    return;
  }

  await uploadSong(file);
}

playPause.addEventListener('click', togglePlayPause);
btnPrev.addEventListener('click', prevTrack);
btnNext.addEventListener('click', nextTrack);
btnPlaylist.addEventListener('click', showPlaylist);
btnClosePlaylist.addEventListener('click', showPlayer);
btnBackFromPlaylist.addEventListener('click', showPlayer);
btnAddSong.addEventListener('click', () => songInput.click());
songInput.addEventListener('change', handleSongSelected);

btnShuffle.addEventListener('click', () => {
  isShuffle = !isShuffle;
  if (isShuffle) {
    buildShuffleOrder();
  }
  updateModeButtons();
});

btnRepeatOne.addEventListener('click', () => {
  repeatMode = repeatMode === 'one' ? 'off' : 'one';
  updateModeButtons();
});

btnRepeatAll.addEventListener('click', () => {
  repeatMode = repeatMode === 'all' ? 'off' : 'all';
  updateModeButtons();
});

progress.addEventListener('input', () => {
  isSeeking = true;
  setProgress(Number(progress.value));
  if (audio.duration) {
    audio.currentTime = (progress.value / 100) * audio.duration;
    timeStart.textContent = formatTime(audio.currentTime);
  }
});

progress.addEventListener('change', () => {
  isSeeking = false;
});

audio.addEventListener('timeupdate', updateProgress);
audio.addEventListener('loadedmetadata', () => {
  timeEnd.textContent = formatTime(audio.duration);
});
audio.addEventListener('ended', onTrackEnded);

async function init() {
  setPlaylist(await fetchPlaylist());
  updateModeButtons();

  if (playlist.length > 0) {
    loadTrack(0);
    return;
  }

  showUploadStatus(
    'No hay canciones. Ejecuta setup.sql en Supabase o usa Agregar canción.',
    true
  );
}

init();
