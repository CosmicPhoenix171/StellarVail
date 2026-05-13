// Global state
let currentSongId = null;
let songsData = [];
let shuffleMode = false;
let activeCardElement = null;
let selectedCardElement = null;
let selectedSongId = null;
let listenCreditSongId = null;
let listenCredited = false;
let listenInvalidated = false; // True if user skipped forward
let lastPlaybackTime = 0; // Track last known playback position
let audioCtx = null;
let analyser = null;
let dataArray = null;
let starBoostRaf = null;
let clientId = getClientId();
let songStats = {}; // Track rating and listen data for sorting
let sortDebounceTimer = null;
let pendingRating = null; // { songId, rating } stored when a guest tries to rate
// Usernames that get admin powers (all ratings visible, listen count not incremented)
const ADMIN_USERNAMES = ['Phoenix'];

function checkAdminMode() {
	const username = localStorage.getItem('sv_username');
	return ADMIN_USERNAMES.includes(username);
}

let isAdminMode = checkAdminMode();
const listenedEnough = new Set(); // version IDs where user has passed 75%
const basePath = '';

// Songs the current listener has heard (any version). Persisted in localStorage.
const heardSongs = new Set(JSON.parse(localStorage.getItem('sv_heard') || '[]'));
// Individual versions the listener has heard or rated. Persisted in localStorage.
const heardVersions = new Set(JSON.parse(localStorage.getItem('sv_heard_v') || '[]'));

// Tracks selected version index per song card: { [songBaseId]: index }
const selectedVersions = {};

// Returns the Firebase ID for a given song + version index
function versionId(song, versionIndex) {
	const vi = versionIndex ?? (selectedVersions[song.id] ?? 0);
	if (!song.versions || song.versions.length <= 1 || vi === 0) return song.id;
	const label = song.versions[vi].label.toLowerCase().replace(/[^a-z0-9]/g, '');
	return `${song.id}-${label}`;
}

// Returns the audio filename for a given song + version index
function versionFilename(song, versionIndex) {
	const vi = versionIndex ?? (selectedVersions[song.id] ?? 0);
	if (song.versions && song.versions[vi]) return song.versions[vi].filename;
	return song.filename;
}

// Format date string (YYYY-MM-DD) to readable format
function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

// DOM references
const audioPlayer = document.getElementById('audio-player');
const songsContainer = document.getElementById('songs-container');
const playerBar = document.querySelector('.player-bar');

// ===== HIDE UI MODE =====
let uiHidden = false;

function toggleHideUI() {
	uiHidden = !uiHidden;
	document.body.classList.toggle('hide-ui-mode', uiHidden);
}

function showUI() {
	if (uiHidden) {
		uiHidden = false;
		document.body.classList.remove('hide-ui-mode');
	}
}

// Click anywhere to show UI when hidden
document.addEventListener('click', (event) => {
	if (uiHidden && !event.target.closest('.app-shell')) {
		showUI();
	}
});

// Escape key shows UI
document.addEventListener('keydown', (event) => {
	if (event.code === 'Escape' && uiHidden) {
		showUI();
	}
});

// Spacebar toggles play/pause (except when typing in inputs/textareas/buttons)
document.addEventListener('keydown', (event) => {
	if (event.code !== 'Space') return;
	if (shouldIgnoreHotkey(event)) return;
	event.preventDefault();

	if (!audioPlayer || !audioPlayer.src) return;

	if (audioPlayer.paused) {
		audioPlayer.play().catch((err) => console.warn('Playback error:', err));
	} else {
		audioPlayer.pause();
	}
});

// Track if current song has been rated this session
let currentSongRated = false;

// Autoplay next track when one finishes (if rated, or if admin)
audioPlayer.addEventListener('ended', () => {
	if (isAdminMode || currentSongRated) {
		playNextSong();
	} else {
		showRatingPopup();
	}
});

// Detect if user skips forward (seeking ahead invalidates listen credit)
audioPlayer.addEventListener('seeking', () => {
	// If seeking forward by more than 2 seconds, invalidate the listen
	if (audioPlayer.currentTime > lastPlaybackTime + 2) {
		listenInvalidated = true;
	}
});

// Credit a listen only after 75% of the track is played (without skipping)
audioPlayer.addEventListener('timeupdate', () => {
	// Update last known position for skip detection
	lastPlaybackTime = audioPlayer.currentTime;
	
	if (!currentSongId || listenCredited === true || listenInvalidated === true) return;

	const duration = audioPlayer.duration;
	if (!duration || isNaN(duration) || duration === Infinity) return;

	if (audioPlayer.currentTime >= duration * 0.75 && listenCreditSongId === currentSongId) {
		incrementListenCount(currentSongId);
		listenCredited = true;
		listenedEnough.add(currentSongId);
	}
});

// Reactively brighten stars based on playback loudness
audioPlayer.addEventListener('play', async () => {
	try {
		await ensureAudioAnalyser();
		startStarBoost();
	} catch (err) {
		console.warn('Audio analyser unavailable:', err);
	}
	// Update play button to show Pause
	if (currentSongId) {
		const { song, vi } = resolveSongAndVersion(currentSongId) || {};
		if (song) updatePlayButton(song.id, vi, true);
	}
	if (activeCardElement) activeCardElement.classList.remove('now-paused');
	syncSidePanelPlaybackState();
});

audioPlayer.addEventListener('pause', () => {
	stopStarBoost();
	// Update play button to show Resume
	if (currentSongId) {
		const { song, vi } = resolveSongAndVersion(currentSongId) || {};
		if (song) updatePlayButton(song.id, vi, false);
	}
	if (activeCardElement) activeCardElement.classList.add('now-paused');
	syncSidePanelPlaybackState();
});

audioPlayer.addEventListener('ended', stopStarBoost);

// ===== SONG SORTING =====
let currentSortMode = 'date'; // 'rating', 'date', 'listens', 'comments', 'title'
let currentSortDir = 'desc'; // 'asc' or 'desc'
let filterUnrated = false; // show only songs user hasn't rated yet

function setSortMode(mode) {
	if (mode === currentSortMode) {
		currentSortDir = currentSortDir === 'desc' ? 'asc' : 'desc';
	} else {
		currentSortMode = mode;
		currentSortDir = 'desc';
	}
	
	// Update old button states (hidden bar kept for compatibility)
	document.querySelectorAll('.sort-btn').forEach(btn => btn.classList.remove('active'));
	const activeBtn = document.getElementById(`sort-${mode}-btn`);
	if (activeBtn) activeBtn.classList.add('active');

	// Update column header highlight + arrow
	const colMap = { title: 'sch-title', date: 'sch-date', rating: 'sch-rating', listens: 'sch-listens', comments: 'sch-comments' };
	document.querySelectorAll('.sch-sortable').forEach(el => {
		el.classList.remove('sch-active');
		const arrow = el.querySelector('.sort-arrow');
		if (arrow) arrow.textContent = '';
	});
	const activeCol = document.getElementById(colMap[mode]);
	if (activeCol) {
		activeCol.classList.add('sch-active');
		const arrow = activeCol.querySelector('.sort-arrow');
		if (arrow) arrow.textContent = currentSortDir === 'desc' ? ' ▼' : ' ▲';
	}
	
	// Re-sort immediately
	sortSongCards();
}

function debouncedSortSongs() {
	// Debounce to avoid sorting on every Firebase update
	if (sortDebounceTimer) clearTimeout(sortDebounceTimer);
	sortDebounceTimer = setTimeout(sortSongCards, 300);
}

function sortSongCards() {
	// Get all cards from the songs container, excluding placeholder and the active card in Now Playing
	const cards = Array.from(songsContainer.querySelectorAll('.song-card:not(.placeholder-card)'));
	
	// Also need to consider the placeholder's position for sorting
	if (cards.length === 0) return;

	let sortableItems = [...cards];

	sortableItems.sort((a, b) => {
		const idA = a.dataset.songId;
		const idB = b.dataset.songId;
		
		if (!idA || !idB) return 0;
		
		if (currentSortMode === 'title') {
			const songA = songsData.find(s => s.id === idA);
			const songB = songsData.find(s => s.id === idB);
			return (songA?.title || '').localeCompare(songB?.title || '');
		} else if (currentSortMode === 'date') {
			// Sort by date (newest first)
			const songA = songsData.find(s => s.id === idA);
			const songB = songsData.find(s => s.id === idB);
			const dateA = songA?.dateAdded ? new Date(songA.dateAdded).getTime() : 0;
			const dateB = songB?.dateAdded ? new Date(songB.dateAdded).getTime() : 0;
			
			if (dateB !== dateA) {
				return dateB - dateA;
			}
			// Secondary: rating
			const statsA = songStats[idA] || { rating: 0 };
			const statsB = songStats[idB] || { rating: 0 };
			return statsB.rating - statsA.rating;
		} else if (currentSortMode === 'listens') {
			// Sort by listen count (highest first)
			const statsA = songStats[idA] || { rating: 0, listens: 0 };
			const statsB = songStats[idB] || { rating: 0, listens: 0 };
			if (statsB.listens !== statsA.listens) {
				return statsB.listens - statsA.listens;
			}
			// Secondary: rating
			return statsB.rating - statsA.rating;
		} else if (currentSortMode === 'comments') {
			const statsA = songStats[idA] || { comments: 0 };
			const statsB = songStats[idB] || { comments: 0 };
			return (statsB.comments || 0) - (statsA.comments || 0);
		} else {
			// Sort by rating
			const statsA = songStats[idA] || { rating: 0, listens: 0 };
			const statsB = songStats[idB] || { rating: 0, listens: 0 };

			// Primary: rating (higher first)
			if (statsB.rating !== statsA.rating) {
				return statsB.rating - statsA.rating;
			}
			// Secondary: listens (higher first)
			return statsB.listens - statsA.listens;
		}
	});

	// Apply sort direction
	if (currentSortDir === 'asc') sortableItems.reverse();

	// Re-append in sorted order (moves existing DOM nodes)
	sortableItems.forEach(item => songsContainer.appendChild(item));
	
	// Mark top 12 highest-rated songs with golden glow
	markTop12RatedSongs();
	// Re-apply unrated filter after sort
	applyUnratedFilter();
}

function toggleUnratedFilter() {
	filterUnrated = !filterUnrated;
	const btn = document.getElementById('filter-unrated-btn');
	if (btn) btn.classList.toggle('filter-chip-active', filterUnrated);
	applyUnratedFilter();
}

function applyUnratedFilter() {
	const cards = songsContainer.querySelectorAll('.song-card:not(.placeholder-card)');
	cards.forEach(card => {
		if (!filterUnrated) {
			card.style.display = '';
			return;
		}
		// Card is "rated" if any summary-rating inside it has had rating-hidden removed
		const rated = card.querySelector('.summary-rating:not(.rating-hidden)') !== null;
		card.style.display = rated ? 'none' : '';
	});
}

// Mark top 12 highest-rated songs with a golden glow
function markTop12RatedSongs() {
	// Get cards from the songs container
	const allCards = Array.from(songsContainer.querySelectorAll('.song-card'));
	
	// Sort by rating to find top 12 (regardless of current sort mode)
	const sortedByRating = [...allCards].sort((a, b) => {
		const idA = a.dataset.songId;
		const idB = b.dataset.songId;
		const statsA = songStats[idA] || { rating: 0, listens: 0 };
		const statsB = songStats[idB] || { rating: 0, listens: 0 };
		
		// Primary: rating (higher first)
		if (statsB.rating !== statsA.rating) {
			return statsB.rating - statsA.rating;
		}
		// Secondary: listens (higher first)
		return statsB.listens - statsA.listens;
	});
	
	// Get top 12 song IDs
	const top12Ids = new Set(sortedByRating.slice(0, 12).map(card => card.dataset.songId));
	
	// Apply or remove the top-rated class
	allCards.forEach(card => {
		const songId = card.dataset.songId;
		const stats = songStats[songId] || { rating: 0 };
		// Only mark as top-rated if they have at least some rating
		if (top12Ids.has(songId) && stats.rating > 0) {
			card.classList.add('top-rated');
		} else {
			card.classList.remove('top-rated');
		}
	});
}

// ===== DATA LOADING =====

// Legacy ID mapping - maps filename to old Firebase ID to preserve ratings/listens
const legacyIdMap = {
	'Tik.wav': 'song1',
	'before morning rise.wav': 'song2',
	'Broken.wav': 'song3',
	'UNREAD.wav': 'song4',
	'burn-it.wav': 'song5',
	'Chemical  Beat.wav': 'song6',
	'Demons.wav': 'song8',
	'Dream escape.wav': 'song9',
	'Emotion.wav': 'song10',
	'fantasy or reality.wav': 'song11',
	'Feel.wav': 'song12',
	'Hide Away.wav': 'song13',
	'Laser Fury.wav': 'song14',
	'midnight Ride.wav': 'song15',
	'Neon Riff.wav': 'song16',
	'Not enough.wav': 'song17',
	'Villain.wav': 'song18',
	'where.wav': 'song19'
};

async function loadSongs() {
	try {
		const indexRes = await fetch(`${basePath}music/index.json`);
		const folders = await indexRes.json();

		// Load each song's info.json from its folder
		const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

		const results = await Promise.all(
			folders.map(async (folder) => {
				try {
					const infoRes = await fetch(`${basePath}music/${folder}/info.json`);
					const info = await infoRes.json();
					const filename = info.filename;
					const baseName = filename.replace(/\.wav$/i, '');
					const safeId = baseName.toLowerCase().replace(/\s+/g, '-').replace(/[.#$\[\]'"]/g, '');
					const id = info.id || legacyIdMap[filename] || safeId;
					return {
						id,
						title: info.title || baseName,
						filename,
						folder,
						dateAdded: info.dateAdded || today,
						artist: info.artist || '',
						description: info.description || '',
						versions: info.versions || null,
						art: info.art ? `${basePath}music/${folder}/${info.art}` : null
					};
				} catch (err) {
					console.warn(`Could not load info.json for folder "${folder}":`, err);
					return null;
				}
			})
		);

		songsData = results.filter(Boolean);
		renderSongs();
	} catch (error) {
		console.error('Error loading songs:', error);
		songsContainer.innerHTML = '<p style="color: white;">Error loading songs. Please check music/index.json.</p>';
	}
}

function renderSongs() {
	songsContainer.innerHTML = '';

	songsData.forEach((song) => {
		selectedVersions[song.id] = 0; // default to first version
		const songCard = createSongCard(song);
		songsContainer.appendChild(songCard);

		// Load Firebase data for every version of the song
		const versionCount = song.versions ? song.versions.length : 1;
		for (let i = 0; i < versionCount; i++) {
			const vid = versionId(song, i);
			loadRatingData(vid, song.id, i);
			loadListenCount(vid);
			loadFeedback(vid);
			checkUserHasRated(vid);
		}
	});
	
	// Sort immediately after render (especially for date sorting)
	sortSongCards();
	// Re-check aurora now that songs are in the DOM
	if (window._updateAurora) window._updateAurora();

	const playingBaseSongId = resolveSongAndVersion(currentSongId)?.song?.id;
	const defaultSongId = playingBaseSongId || selectedSongId || songsContainer.querySelector('.song-card')?.dataset.songId;
	if (defaultSongId) {
		selectSong(defaultSongId, { scroll: false });
	}
	if (playingBaseSongId) {
		moveCardToPlayer(playingBaseSongId);
	}
}

function createSongCard(song) {
	const card = document.createElement('div');
	const isNew = !heardSongs.has(song.id) && !isAdminMode;
	card.className = `song-card${isNew ? ' is-new' : ''}`;
	card.id = `card-${song.id}`;
	card.dataset.songId = song.id;
	card.addEventListener('click', () => selectSong(song.id));

	const artistValue = (song.artist || '').trim();
	const descriptionValue = (song.description || '').trim();
	const artistIsPlaceholder = !artistValue || ['your name', 'artist name'].includes(artistValue.toLowerCase());
	const descriptionIsPlaceholder = !descriptionValue || descriptionValue.toLowerCase().startsWith('description of your');
	const artistHtml = artistIsPlaceholder ? '' : `<p class="artist">${song.artist}</p>`;
	const descriptionHtml = descriptionIsPlaceholder ? '' : `<p class="description">${song.description}</p>`;
	const detailHeaderHtml = artistHtml || descriptionHtml ? `<div class="detail-header">${artistHtml}${descriptionHtml}</div>` : '';
	const ratingHiddenClass = isAdminMode ? '' : 'rating-hidden';

	// Format date for display
	const dateAdded = song.dateAdded ? formatDate(song.dateAdded) : 'Unknown date';
	const dateHtml = `<span class="date-added">${dateAdded}</span>`;

	// Build version tabs HTML — always shown; single-version songs get an "Original" tab
	const hasVersions = song.versions && song.versions.length > 1;
	const tabVersions = song.versions || [{ filename: song.filename, label: 'Original' }];
	const versionTabsHtml = `
		<div class="version-tabs" id="version-tabs-${song.id}">
			${tabVersions.map((v, i) => {
				const vid = versionId(song, i);
				const isUnheard = !heardVersions.has(vid) && !isAdminMode;
				return `
				<button class="version-tab${i === 0 ? ' active' : ''}${isUnheard ? ' version-new' : ''}"
					data-song-id="${song.id}"
					data-version-index="${i}"
					data-tab="true"
					onclick="selectVersion('${song.id}', ${i})">
					${v.label}
				</button>`;
			}).join('')}
		</div>`;

	// Version panels — one per version, each with its own metrics/rating/comments
	const versionPanelsHtml = (song.versions || [{ filename: song.filename, label: '' }]).map((v, i) => {
		const vid = versionId(song, i);
		// Use per-version date if available, else fall back to song date, else placeholder
		const vDate = v.dateAdded ? formatDate(v.dateAdded) : (dateAdded || 'Unknown date');
		const vDateHtml = `<span class="date-added">${vDate}</span>`;
		return `
		<div class="version-panel${i === 0 ? ' active' : ''}" id="version-panel-${song.id}-${i}">
			<div class="card-meta-row">
				${vDateHtml}
				<div class="summary-rating ${ratingHiddenClass}" id="summary-rating-${vid}">
					<div class="summary-stars" id="summary-stars-${vid}" aria-hidden="true">
						${Array.from({ length: 5 }, () => '<span class="summary-star">★</span>').join('')}
					</div>
					<span class="summary-user-rating" id="summary-user-rating-${vid}"></span>
					<span class="avg-rating" id="avg-rating-${vid}">Avg 0.0★</span>
					<span class="rating-count" id="rating-count-${vid}">(0 ratings)</span>
				</div>
				<span class="listen-count" id="listen-count-${vid}">0 listens</span>
				<span class="comment-count" id="comment-count-${vid}" title="Comments" onclick="event.stopPropagation(); toggleFeedback('${vid}')">
					<svg class="comment-bubble" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
					</svg>
					<span class="comment-number">0</span>
				</span>
			</div>
			<div class="play-button-wrap" onclick="togglePlaySong('${song.id}', ${i})">
				<button class="play-button version-play-btn${!heardVersions.has(vid) && !isAdminMode ? ' version-new' : ''}" onclick="event.stopPropagation(); togglePlaySong('${song.id}', ${i})" data-song-id="${song.id}" data-version-index="${i}">
					▶ Play${hasVersions ? ' ' + v.label : ''}
				</button>
			</div>
			<div class="detail-section" id="detail-section-${vid}">
				${i === 0 ? detailHeaderHtml : ''}
				${isAdminMode ? '' : `<div class="rating-section">
					<h4 class="np-section-heading">⭐ Ratings</h4>
					<div class="rating-stars" id="rating-stars-${vid}">
						${[1, 2, 3, 4, 5].map((n) => '<span class="star" data-rating="' + n + '" onclick="rateSong(\'' + vid + '\', ' + n + ')">★</span>').join('')}
					</div>
					<p class="rating-message" id="rating-message-${vid}">Click stars to rate</p>
				</div>`}
				${isAdminMode ? `<div class="ratings-breakdown" id="ratings-breakdown-${vid}">
					<div class="ratings-breakdown-header" onclick="toggleRatingsBreakdown('${vid}')">
						<h4>👤 Individual Ratings</h4>
						<button type="button" class="feedback-toggle ratings-breakdown-toggle" id="ratings-toggle-${vid}">▲</button>
					</div>
					<div class="ratings-breakdown-list" id="ratings-list-${vid}"></div>
				</div>` : ''}
				<div class="feedback-section" id="feedback-section-${vid}">
					<div class="feedback-header-row">
						<div class="feedback-header-left">
							<h4>Comments</h4>
							<p class="feedback-hint" id="feedback-hint-${vid}">No comments yet. Be the first to leave feedback.</p>
						</div>
						<button type="button" class="add-comment-btn" onclick="openCommentPopup('${vid}')">+ Add Comment</button>
					</div>
					<div class="feedback-list" id="feedback-list-${vid}">
						<p class="no-feedback">No comments yet. Be the first!</p>
					</div>
				</div>
			</div>
		</div>`;
	}).join('');

	const newBadgeHtml = (!heardSongs.has(song.id) && !isAdminMode)
		? `<div class="new-badge">NEW</div>` : '';
	const albumArtHtml = `
		<div class="album-art-wrap">
			${song.art
				? `<img class="album-art" src="${song.art}" alt="${song.title} cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
				   <div class="album-art-placeholder" style="display:none"></div>`
				: `<div class="album-art-placeholder"></div>`
			}
			<div class="art-text-overlay">
				<h3 class="art-title">${song.title}</h3>
				<div class="art-overlay-bottom">
					${versionTabsHtml}
					<div class="art-meta-chips">
						<span class="art-chip art-chip-date">${dateAdded}</span>
						<span class="art-chip art-chip-rating" id="art-rating-${song.id}"></span>
						<span class="art-chip art-chip-listens" id="art-listen-${song.id}">0 listens</span>
					</div>
				</div>
			</div>
		</div>`;
	card.innerHTML = `
		${newBadgeHtml}
		${albumArtHtml}
		<div class="card-title-row">
			<h3 class="card-title">${song.title}</h3>
		</div>
		${versionPanelsHtml}
	`;
	return card;
}

// Switch which version is shown/highlighted on a card
function selectVersion(songBaseId, index) {
	selectedVersions[songBaseId] = index;

	// Update tab active state
	const tabs = document.querySelectorAll(`#version-tabs-${songBaseId} .version-tab`);
	tabs.forEach((t, i) => t.classList.toggle('active', i === index));

	// Show only the selected version panel
	const song = songsData.find(s => s.id === songBaseId);
	if (!song || !song.versions) return;
	song.versions.forEach((_, i) => {
		const panel = document.getElementById(`version-panel-${songBaseId}-${i}`);
		if (panel) panel.classList.toggle('active', i === index);
	});

	selectSong(songBaseId, { scroll: false });

	// If any version of this song is currently playing, switch audio to the selected version
	const isPlayingThisSong = song.versions
		? song.versions.some((_, i) => versionId(song, i) === currentSongId)
		: currentSongId === song.id;
	if (isPlayingThisSong) {
		const filename = versionFilename(song, index);
		const folder = song.folder || song.filename.replace(/\.wav$/i, '');
		const wasPaused = audioPlayer.paused;
		audioPlayer.src = `${basePath}music/${folder}/${filename}`;
		if (!wasPaused) audioPlayer.play().catch(() => {});
		currentSongId = versionId(song, index);

		// Move the playing icon to the newly-selected tab
		document.querySelectorAll('.version-tab').forEach(t => t.classList.remove('tab-playing'));
		const newPlayingTab = document.querySelector(`button.version-tab[data-song-id="${songBaseId}"][data-version-index="${index}"]`);
		if (newPlayingTab) newPlayingTab.classList.add('tab-playing');
		moveCardToPlayer(songBaseId);
	}
}

// ===== PLAYBACK CONTROLS =====

// Resolve the song object and version index from a songBaseId or versionId
function resolveSongAndVersion(songIdOrVersionId) {
	// Try exact base id match first
	let song = songsData.find(s => s.id === songIdOrVersionId);
	if (song) return { song, vi: selectedVersions[song.id] ?? 0 };
	// Try matching as a version id: {baseId}-{label}
	song = songsData.find(s => s.versions && s.versions.some((_, i) => versionId(s, i) === songIdOrVersionId));
	if (song) {
		const vi = song.versions.findIndex((_, i) => versionId(song, i) === songIdOrVersionId);
		return { song, vi };
	}
	return null;
}

// Load a song into the player without playing it
function loadSongToPlayer(songBaseId, versionIndex) {
	const song = songsData.find(s => s.id === songBaseId);
	if (!song) return;

	const vi = versionIndex ?? (selectedVersions[songBaseId] ?? 0);
	const vid = versionId(song, vi);

	if (currentSongId === vid) return;

	if (playerBar) playerBar.classList.remove('hidden');

	const folder = song.folder || song.filename.replace(/\.wav$/i, '');
	const filename = versionFilename(song, vi);
	audioPlayer.src = `${basePath}music/${folder}/${filename}`;

	listenCreditSongId = vid;
	listenCredited = false;
	listenInvalidated = false;
	lastPlaybackTime = 0;
	currentSongRated = false;

	checkIfUserRatedSong(vid);
	moveCardToPlayer(song.id);

	document.querySelectorAll('.play-button').forEach((btn) => {
		btn.classList.remove('playing');
		const bSong = songsData.find(s => s.id === btn.dataset.songId);
		const bVi = parseInt(btn.dataset.versionIndex ?? 0);
		const bLabel = bSong?.versions?.[bVi]?.label || '';
		const hasVersions = bSong?.versions && bSong.versions.length > 1;
		btn.textContent = `▶ Play${hasVersions && bLabel ? ' ' + bLabel : ''}`;
	});

	currentSongId = vid;
}

function togglePlaySong(songBaseId, versionIndex) {
	const song = songsData.find(s => s.id === songBaseId);
	if (!song) return;
	const vi = versionIndex ?? (selectedVersions[songBaseId] ?? 0);
	const vid = versionId(song, vi);

	if (currentSongId === vid) {
		if (audioPlayer.paused) {
			audioPlayer.play().catch(err => console.error('Playback error:', err));
			updatePlayButton(songBaseId, vi, true);
		} else {
			audioPlayer.pause();
			updatePlayButton(songBaseId, vi, false);
		}
		return;
	}

	playSong(songBaseId, vi);
}

function updatePlayButton(songBaseId, versionIndex, isPlaying) {
	const btn = document.querySelector(`button[data-song-id="${songBaseId}"][data-version-index="${versionIndex}"]`)
		|| document.querySelector(`button.play-button[data-song-id="${songBaseId}"]`);
	if (!btn) return;
	btn.classList.add('playing');
	// Text stays as-is — the NOW PLAYING / NOW PAUSED overlay handles state display
}

function playSong(songBaseId, versionIndex) {
	const song = songsData.find(s => s.id === songBaseId);
	if (!song) return;

	const vi = versionIndex ?? (selectedVersions[songBaseId] ?? 0);
	const vid = versionId(song, vi);

	if (playerBar) playerBar.classList.remove('hidden');

	const folder = song.folder || song.filename.replace(/\.wav$/i, '');
	const filename = versionFilename(song, vi);
	audioPlayer.src = `${basePath}music/${folder}/${filename}`;
	audioPlayer.play().catch(err => console.error('Playback error:', err));

	listenCreditSongId = vid;
	listenCredited = false;
	listenInvalidated = false;
	lastPlaybackTime = 0;
	currentSongRated = false;

	checkIfUserRatedSong(vid);
	moveCardToPlayer(song.id);

	// Reset all play buttons to default state
	document.querySelectorAll('.play-button').forEach((btn) => {
		btn.classList.remove('playing');
		const bSong = songsData.find(s => s.id === btn.dataset.songId);
		const bVi = parseInt(btn.dataset.versionIndex ?? 0);
		const bLabel = bSong?.versions?.[bVi]?.label || '';
		const hasVersions = bSong?.versions && bSong.versions.length > 1;
		btn.textContent = `▶ Play${hasVersions && bLabel ? ' ' + bLabel : ''}`;
	});

	// Mark the playing version tab as active
	document.querySelectorAll('.version-tab').forEach(t => t.classList.remove('tab-playing'));
	const playingTab = document.querySelector(`button.version-tab[data-song-id="${songBaseId}"][data-version-index="${vi}"]`);
	if (playingTab) playingTab.classList.add('tab-playing');

	updatePlayButton(songBaseId, vi, true);
	currentSongId = vid;
}

function updateNowPlayingCard(song) {
	moveCardToPlayer(song.id);
}

function syncSidePanelPlaybackState() {
	const sidePanel = document.getElementById('now-playing-side-panel');
	const currentBaseSongId = resolveSongAndVersion(currentSongId)?.song?.id;
	const isShowingCurrentSong = !!selectedSongId && selectedSongId === currentBaseSongId;
	if (!sidePanel) return;

	sidePanel.classList.toggle('show-playback-state', isShowingCurrentSong);
	sidePanel.classList.toggle('now-paused', isShowingCurrentSong && !!currentSongId && audioPlayer.paused);
}

function renderNowPlayingPanel(songId) {
	const sidePanel = document.getElementById('now-playing-side-panel');
	const card = document.getElementById(`card-${songId}`);
	if (!sidePanel || !card) return;

	const clone = card.cloneNode(true);
	clone.classList.remove('song-card');
	clone.classList.remove('in-now-playing', 'is-new', 'top-rated', 'now-paused');
	clone.classList.add('song-card-panel');
	clone.removeAttribute('id');
	clone.querySelector('.new-badge')?.remove();
	clone.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'));

	sidePanel.innerHTML = '';
	sidePanel.appendChild(clone);
	sidePanel.classList.add('active');
	syncSidePanelPlaybackState();
}

function selectSong(songId, options = {}) {
	const { scroll = true } = options;
	const card = document.getElementById(`card-${songId}`);
	if (!card) return;

	// Clear selection highlight from previous card
	if (selectedCardElement && selectedCardElement !== card) {
		selectedCardElement.classList.remove('panel-selected');
	}

	selectedSongId = songId;
	selectedCardElement = card;
	card.classList.add('panel-selected');

	if (scroll) {
		card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	renderNowPlayingPanel(songId);
}

function moveCardToPlayer(songId) {
	// Deactivate previously playing card row highlight
	if (activeCardElement) {
		if (activeCardElement.dataset.songId !== songId) {
			activeCardElement.classList.remove('in-now-playing');
		}
	}

	const card = document.getElementById(`card-${songId}`);
	if (!card) return;

	const isNewActiveCard = activeCardElement !== card;
	activeCardElement = card;

	// Highlight the list row
	card.classList.add('in-now-playing');
	if (isNewActiveCard) {
		card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	selectSong(songId, { scroll: false });
}

function playNextSong() {
	if (!songsData.length) return;

	if (shuffleMode) {
		playSong(getRandomSongId());
		return;
	}

	// Read cards in their current DOM order — this reflects the active sort
	const allCards = Array.from(songsContainer.querySelectorAll('.song-card:not(.placeholder-card)'));
	const sortedBaseIds = allCards.map(card => card.dataset.songId);

	// currentSongId might be a versionId — find the base song
	const currentBaseSong = songsData.find(s =>
		s.id === currentSongId || (s.versions && s.versions.some((_, i) => versionId(s, i) === currentSongId))
	);
	const currentBaseId = currentBaseSong?.id;
	const currentIndex = sortedBaseIds.indexOf(currentBaseId);
	const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % sortedBaseIds.length;
	playSong(sortedBaseIds[nextIndex]);
}

function playRandomSong() {
	if (!songsData.length) return;
	playSong(getRandomSongId());
}

function getRandomSongId() {
	if (songsData.length === 1) {
		return songsData[0].id;
	}

	let randomId;
	do {
		randomId = songsData[Math.floor(Math.random() * songsData.length)].id;
	} while (randomId === currentSongId);

	return randomId;
}

function toggleShuffle() {
	shuffleMode = !shuffleMode;
	const shuffleBtn = document.getElementById('shuffle-btn');
	if (!shuffleBtn) return;

	if (shuffleMode) {
		shuffleBtn.title = 'Shuffle: ON';
		shuffleBtn.classList.add('active');
	} else {
		shuffleBtn.title = 'Shuffle: OFF';
		shuffleBtn.classList.remove('active');
	}
	updateQueue();
}

// ===== LISTEN COUNT =====
function loadListenCount(songId) {
	if (typeof database === 'undefined') return;

	const listensRef = database.ref(`songs/${songId}/listens`);
	listensRef.on('value', (snapshot) => {
		const count = snapshot.val() || 0;
		const listenElement = document.getElementById(`listen-count-${songId}`);
		if (listenElement) {
			listenElement.textContent = `${count} listen${count === 1 ? '' : 's'}`;
		}
		// Track for sorting
		// Aggregate listens under the base song ID for sorting
		const baseSong = songsData.find(s =>
			s.id === songId || (s.versions && s.versions.some((_, i) => versionId(s, i) === songId))
		);
		const statKey = baseSong ? baseSong.id : songId;
		if (!songStats[statKey]) songStats[statKey] = { rating: 0, listens: 0 };
		songStats[statKey].listens = (songStats[statKey].listens || 0) + count;
		// Update art overlay listen count with running total
		const artListenEl = document.getElementById(`art-listen-${statKey}`);
		if (artListenEl) {
			const total = songStats[statKey].listens;
			artListenEl.textContent = `${total} listen${total === 1 ? '' : 's'}`;
		}
		debouncedSortSongs();
	});
}

// Mark a base song as heard and remove its NEW badge (called on full listen or on rating)
function markSongHeard(baseId) {
	if (isAdminMode || heardSongs.has(baseId)) return;
	heardSongs.add(baseId);
	localStorage.setItem('sv_heard', JSON.stringify([...heardSongs]));
	const card = document.getElementById(`card-${baseId}`);
	if (card) {
		card.classList.remove('is-new');
		const badge = card.querySelector('.new-badge');
		if (badge) badge.remove();
	}
}

// Mark a specific version as heard/rated: remove button glow + tab highlight.
// Only removes the card NEW badge once every version has been heard/rated.
function markVersionHeard(vid, songBaseId, versionIndex) {
	if (isAdminMode || heardVersions.has(vid)) return;
	heardVersions.add(vid);
	localStorage.setItem('sv_heard_v', JSON.stringify([...heardVersions]));
	// Remove glow from play button
	const btn = document.querySelector(
		`button.play-button[data-song-id="${songBaseId}"][data-version-index="${versionIndex}"]`
	);
	if (btn) btn.classList.remove('version-new');
	// Remove highlight from version tab
	const tab = document.querySelector(
		`button.version-tab[data-song-id="${songBaseId}"][data-version-index="${versionIndex}"]`
	);
	if (tab) tab.classList.remove('version-new');

	// Remove the card-level NEW badge only when every version is now heard/rated
	const song = songsData.find(s => s.id === songBaseId);
	const versionCount = song?.versions ? song.versions.length : 1;
	const allHeard = Array.from({ length: versionCount }, (_, i) => versionId(song, i))
		.every(v => heardVersions.has(v));
	if (allHeard) markSongHeard(songBaseId);
}

function incrementListenCount(songId) {
	if (typeof database === 'undefined') return;
	if (isAdminMode) return; // Don't count listens on admin page

	const listensRef = database.ref(`songs/${songId}/listens`);
	listensRef.transaction((currentCount) => (currentCount || 0) + 1);

	// Resolve the base song and mark the specific version as heard
	const baseSong = songsData.find(s =>
		s.id === songId || (s.versions && s.versions.some((_, i) => versionId(s, i) === songId))
	);
	if (baseSong) {
		const vi = baseSong.versions
			? baseSong.versions.findIndex((_, i) => versionId(baseSong, i) === songId)
			: 0;
		markVersionHeard(songId, baseSong.id, vi >= 0 ? vi : 0);
	}
}

// ===== STAR BOOST (AUDIO REACTIVE) =====
async function ensureAudioAnalyser() {
	if (audioCtx && analyser && dataArray) return;

	const AudioContext = window.AudioContext || window.webkitAudioContext;
	if (!AudioContext) throw new Error('Web Audio not supported');

	audioCtx = audioCtx || new AudioContext();
	await audioCtx.resume();

	const source = audioCtx.createMediaElementSource(audioPlayer);
	analyser = audioCtx.createAnalyser();
	analyser.fftSize = 256;
	const bufferLength = analyser.frequencyBinCount;
	dataArray = new Uint8Array(bufferLength);

	// Connect: source -> analyser -> destination
	source.connect(analyser);
	analyser.connect(audioCtx.destination);
}

function startStarBoost() {
	if (!analyser || !dataArray) return;

	if (starBoostRaf) cancelAnimationFrame(starBoostRaf);

	const tick = () => {
		if (audioPlayer.paused) {
			document.documentElement.style.setProperty('--star-boost', '0');
			starBoostRaf = requestAnimationFrame(tick);
			return;
		}

		analyser.getByteFrequencyData(dataArray);
		// Focus on low/mid bins for beat-like energy (first 64 bins)
		const bins = Math.min(64, dataArray.length);
		let sum = 0;
		for (let i = 0; i < bins; i++) sum += dataArray[i];
		const avg = sum / bins;
		// Map average magnitude to a stronger visible boost (0 to ~2)
		const boost = Math.min(2, (avg / 255) * 3);
		document.documentElement.style.setProperty('--star-boost', boost.toFixed(3));

		starBoostRaf = requestAnimationFrame(tick);
	};

	starBoostRaf = requestAnimationFrame(tick);
}

function stopStarBoost() {
	if (starBoostRaf) cancelAnimationFrame(starBoostRaf);
	starBoostRaf = null;
	document.documentElement.style.setProperty('--star-boost', '0');
}

// ===== RATINGS =====
function loadRatingData(songId, songBaseId, versionIndex) {
	if (typeof database === 'undefined') return;
	// songBaseId is used to aggregate sort stats (use the base song id for card sorting)
	const statKey = songBaseId || songId;

	const ratingsRef = database.ref(`songs/${songId}/ratings`);
	ratingsRef.on('value', (snapshot) => {
		const ratings = snapshot.val();
		let sum = 0;
		let count = 0;
		let guestCount = 0;

		if (ratings) {
			Object.entries(ratings).forEach(([key, rating]) => {
				if (key.startsWith('guest_')) {
					guestCount++;
					return; // Skip guests in the score
				}
				sum += rating.rating;
				count += 1;
			});
		}

		const average = count > 0 ? (sum / count).toFixed(1) : '0.0';
		const avgElement = document.getElementById(`avg-rating-${songId}`);
		const countElement = document.getElementById(`rating-count-${songId}`);
		const pendingHint = guestCount > 0 ? ` · ${guestCount} pending` : '';
		if (avgElement) avgElement.textContent = `Avg ${average}★`;
		if (countElement) countElement.textContent = `(${count} rating${count === 1 ? '' : 's'}${isAdminMode ? pendingHint : ''})`;

		// Sync art overlay rating chip (base song, first version only)
		const artRatingEl = document.getElementById(`art-rating-${songBaseId}`);
		if (artRatingEl && versionIndex === 0) {
			if (count > 0) {
				artRatingEl.textContent = `★ ${average}`;
				artRatingEl.style.display = '';
			} else {
				artRatingEl.style.display = 'none';
			}
		}

		updateStarsDisplay(songId, parseFloat(average));

		// Admin mode: show individual user ratings
		if (isAdminMode && ratings) {
			const breakdownList = document.getElementById(`ratings-list-${songId}`);
			if (breakdownList) {
				const entries = Object.entries(ratings)
					.map(([id, data]) => ({ userId: id, ...data }))
					.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

				if (entries.length === 0) {
					breakdownList.innerHTML = '<p class="no-ratings-yet">No ratings yet.</p>';
				} else {
					breakdownList.innerHTML = entries.map(entry => {
						const name = formatRaterName(entry.userId);
						const isGuestEntry = entry.userId.startsWith('guest_');
						const guestTag = isGuestEntry ? '<span class="guest-tag">pending</span>' : '';
						const stars = '★'.repeat(entry.rating) + '☆'.repeat(5 - entry.rating);
						const timeAgo = entry.timestamp ? formatTime(entry.timestamp) : '';
						const deleteBtn = `<button class="admin-delete-rating" onclick="deleteRating('${songId}', '${entry.userId}')" title="Delete this rating">✕</button>`;
						return `
							<div class="rating-entry ${isGuestEntry ? 'guest-entry' : ''}">
								<span class="rater-name">${escapeHtml(name)}${guestTag}</span>
								<span class="rater-stars" data-rating="${entry.rating}">${stars}</span>
								<span class="rater-time">${timeAgo}</span>
								${deleteBtn}
							</div>
						`;
					}).join('');
				}
			}
		}
		
		// Track for sorting — aggregate across all versions for card-level sort
		if (!songStats[statKey]) songStats[statKey] = { rating: 0, listens: 0 };
		// For multi-version songs, use the highest-rated version for sorting
		if (parseFloat(average) > (songStats[statKey].rating || 0)) {
			songStats[statKey].rating = parseFloat(average);
		}
		debouncedSortSongs();
	});
}

function updateStarsDisplay(songId, average) {
	// Only fill stars with the community average after the user has rated this version.
	// Until then the stars stay empty so the average doesn't influence their choice.
	const summaryEl = document.getElementById(`summary-rating-${songId}`);
	const userHasRated = summaryEl && !summaryEl.classList.contains('rating-hidden');
	if (!userHasRated) return;

	// Fill the interactive rating widget
	const starsContainer = document.getElementById(`rating-stars-${songId}`);
	if (starsContainer) {
		starsContainer.querySelectorAll('.star').forEach((star, index) => {
			if (index < Math.round(average)) {
				star.classList.add('filled');
			} else {
				star.classList.remove('filled');
			}
		});
	}

	// Fill the big display summary stars with the community average
	const summaryStars = document.getElementById(`summary-stars-${songId}`);
	if (summaryStars) {
		summaryStars.querySelectorAll('.summary-star').forEach((star, index) => {
			star.classList.toggle('user-rated', index < Math.round(average));
		});
	}
}

function revealRating(songId) {
	const ratingEl = document.getElementById(`summary-rating-${songId}`);
	if (ratingEl) {
		ratingEl.classList.remove('rating-hidden');
		// Now that the user has rated, fill stars with the community average
		const avgEl = document.getElementById(`avg-rating-${songId}`);
		if (avgEl) updateStarsDisplay(songId, parseFloat(avgEl.textContent.replace(/[^\d.]/g, '')) || 0);
	}
	// If the unrated filter is active, hide this card now that it's been rated
	if (filterUnrated) applyUnratedFilter();
}

function updateSummaryStars(songId, rating) {
	// Summary stars now show community average (handled by updateStarsDisplay).
	// This function is kept for compatibility but no longer overwrites the display.
	// The user's personal rating is shown via the summary-user-rating text element.
}

function checkUserHasRated(songId) {
	if (typeof database === 'undefined') return;

	const userRatingRef = database.ref(`songs/${songId}/ratings/${clientId}`);
	userRatingRef.once('value', (snapshot) => {
		if (snapshot.exists()) {
			revealRating(songId);
			// Show user's current rating on the stars
			const userRating = snapshot.val().rating;
			highlightUserRating(songId, userRating);
			// User already rated — treat as heard, remove version glow (card badge only goes if all versions heard)
			const ratedBase = songsData.find(s =>
				s.id === songId || (s.versions && s.versions.some((_, i) => versionId(s, i) === songId))
			);
			if (ratedBase) {
				const rvi = ratedBase.versions
					? ratedBase.versions.findIndex((_, i) => versionId(ratedBase, i) === songId)
					: 0;
				markVersionHeard(songId, ratedBase.id, rvi >= 0 ? rvi : 0);
			}
		}
	});
}

// Highlight the stars to show user's current rating
function highlightUserRating(songId, rating) {
	const starsContainer = document.getElementById(`rating-stars-${songId}`);
	const messageEl = document.getElementById(`rating-message-${songId}`);
	const summaryUserRatingEl = document.getElementById(`summary-user-rating-${songId}`);
	
	if (starsContainer) {
		const stars = starsContainer.querySelectorAll('.star');
		stars.forEach((star, index) => {
			if (index < rating) {
				star.classList.add('user-rated');
			} else {
				star.classList.remove('user-rated');
			}
		});
	}

	updateSummaryStars(songId, rating);
	if (summaryUserRatingEl) {
		summaryUserRatingEl.textContent = `Yours ${rating}★`;
	}
	
	if (messageEl) {
		messageEl.textContent = `Your rating: ${rating}★ (click to change)`;
	}
}

// Check if user already rated a song (for auto-play decision)
function checkIfUserRatedSong(songId) {
	if (typeof database === 'undefined') return;

	const userRatingRef = database.ref(`songs/${songId}/ratings/${clientId}`);
	userRatingRef.once('value', (snapshot) => {
		if (snapshot.exists()) {
			currentSongRated = true;
		}
	});
}

function isGuest() {
	return !localStorage.getItem('sv_username');
}

function rateSong(songId, rating) {
	if (typeof database === 'undefined') return;

	// If the user is a guest, prompt them to create a username first
	if (isGuest() && !isAdminMode) {
		pendingRating = { songId, rating };
		showLoginPopup(true); // true = triggered by rating
		return;
	}

	// Block rating if the user hasn't listened to at least 75% of this version
	if (!listenedEnough.has(songId) && !isAdminMode) {
		showNotListenedPopup();
		return;
	}

	const ratingRef = database.ref(`songs/${songId}/ratings/${clientId}`);
	ratingRef
		.set({
			rating,
			timestamp: Date.now(),
		})
		.then(() => {
			// Show updated rating on stars
			highlightUserRating(songId, rating);
			
			const messageEl = document.getElementById(`rating-message-${songId}`);
			if (messageEl) {
				messageEl.textContent = 'Rating updated!';
				setTimeout(() => {
					messageEl.textContent = `Your rating: ${rating}★ (click to change)`;
				}, 1500);
			}
			// Reveal the rating now that user has rated
			revealRating(songId);
			// Mark current song as rated
			if (songId === currentSongId) {
				currentSongRated = true;
			}
			// Rating counts as having heard the song — remove the NEW badge
			const ratedBaseSong = songsData.find(s =>
				s.id === songId || (s.versions && s.versions.some((_, i) => versionId(s, i) === songId))
			);
			if (ratedBaseSong) {
				const rvi = ratedBaseSong.versions
					? ratedBaseSong.versions.findIndex((_, i) => versionId(ratedBaseSong, i) === songId)
					: 0;
				markVersionHeard(songId, ratedBaseSong.id, rvi >= 0 ? rvi : 0);
				if (selectedSongId === ratedBaseSong.id) {
					renderNowPlayingPanel(selectedSongId);
				}
			}
		})
		.catch((error) => {
			console.error('Error saving rating:', error);
			const messageEl = document.getElementById(`rating-message-${songId}`);
			if (messageEl) messageEl.textContent = 'Error saving rating';
		});
}

// ===== RATING POPUP =====
function showRatingPopup() {
	const popup = document.getElementById('rating-popup');
	const songTitle = document.getElementById('rating-popup-song-title');
	const starsContainer = document.getElementById('rating-popup-stars');
	
	if (!popup || !currentSongId) return;
	
	// Get current song title (currentSongId may be a versionId)
	const resolved = resolveSongAndVersion(currentSongId);
	if (songTitle && resolved) {
		const { song, vi } = resolved;
		const vLabel = song.versions?.[vi]?.label;
		songTitle.textContent = vLabel ? `${song.title} — ${vLabel}` : song.title;
	}
	
	// Reset stars
	const stars = starsContainer.querySelectorAll('.popup-star');
	stars.forEach(star => {
		star.classList.remove('selected', 'hovered');
	});
	
	popup.style.display = 'flex';
	
	// Setup star hover effects
	stars.forEach((star, index) => {
		star.onmouseenter = () => {
			stars.forEach((s, i) => {
				s.classList.toggle('hovered', i <= index);
			});
		};
		star.onmouseleave = () => {
			stars.forEach(s => s.classList.remove('hovered'));
		};
		star.onclick = () => {
			const rating = parseInt(star.dataset.rating);
			rateSong(currentSongId, rating);
			hideRatingPopup();
			playNextSong();
		};
	});
	
	// Setup skip button
	const skipBtn = document.getElementById('rating-popup-skip');
	if (skipBtn) {
		skipBtn.onclick = () => {
			hideRatingPopup();
			playNextSong();
		};
	}
}

function hideRatingPopup() {
	const popup = document.getElementById('rating-popup');
	if (popup) {
		popup.style.display = 'none';
	}
}

// ===== FEEDBACK =====
function loadFeedback(songId) {
	if (typeof database === 'undefined') return;

	const feedbackRef = database.ref(`songs/${songId}/feedback`);
	feedbackRef.on('value', (snapshot) => {
		const feedbackList = document.getElementById(`feedback-list-${songId}`);
		const commentCountEl = document.getElementById(`comment-count-${songId}`);
		
		const feedbacks = snapshot.val();
		const commentCount = feedbacks ? Object.keys(feedbacks).length : 0;

		// Track in songStats for sorting
		if (!songStats[songId]) songStats[songId] = { rating: 0, listens: 0 };
		songStats[songId].comments = commentCount;
		
		// Update comment count in card header
		if (commentCountEl) {
			const numberEl = commentCountEl.querySelector('.comment-number');
			if (numberEl) {
				numberEl.textContent = commentCount;
			}
		}

		// Update hint text
		const hintEl = document.getElementById(`feedback-hint-${songId}`);
		if (hintEl) {
			hintEl.textContent = commentCount > 0
				? `${commentCount} comment${commentCount === 1 ? '' : 's'}`
				: 'No comments yet. Be the first to leave feedback.';
		}
		
		if (!feedbackList) return;

		if (!feedbacks) {
			feedbackList.innerHTML = '<p class="no-feedback">No comments yet. Be the first!</p>';
			return;
		}

		const feedbackArray = Object.entries(feedbacks)
			.map(([key, value]) => ({ id: key, ...value }))
			.sort((a, b) => b.timestamp - a.timestamp);

		feedbackList.innerHTML = feedbackArray
			.map((fb) => {
				const timestampBadge =
					fb.songTimestamp !== undefined
						? `<span class="timestamp-badge" onclick="seekToTime('${songId}', ${fb.songTimestamp})" title="Jump to ${formatSongTime(fb.songTimestamp)}">⏱️ ${formatSongTime(fb.songTimestamp)}</span>`
						: '';

				const isMine = fb.clientId === clientId;
				const encodedComment = encodeURIComponent(fb.comment || '');
				const encodedName = encodeURIComponent(fb.displayName || 'Anonymous');
				const timestampAttr = fb.songTimestamp !== undefined ? `data-song-timestamp="${fb.songTimestamp}"` : '';
				const editBtn = isMine
					? `<button class="edit-feedback-btn" data-comment="${encodedComment}" data-name="${encodedName}" ${timestampAttr} onclick="prefillFeedback('${songId}', this)">✏️ Edit</button>`
					: '';

				const youTag = isMine ? '<span class="you-pill">You</span>' : '';

				return `
					<div class="feedback-item">
						<div class="feedback-header">
							<span class="feedback-author">${fb.displayName || 'Anonymous'}</span>${youTag}
							${timestampBadge}
							<span class="feedback-time">${formatTime(fb.timestamp)}</span>
							${editBtn}
						</div>
						<p class="feedback-text">${escapeHtml(fb.comment)}</p>
					</div>
				`;
			})
			.join('');
	});
}

// ===== COMMENT POPUP =====
let commentPopupVid = null;

function openCommentPopup(vid) {
	commentPopupVid = vid;
	const popup = document.getElementById('comment-popup');
	const titleEl = document.getElementById('comment-popup-song-title');
	const textarea = document.getElementById('comment-popup-text');
	const tsInput = document.getElementById('comment-popup-timestamp');
	if (!popup) return;
	// Try to get a label from the version tab
	const tabEl = document.querySelector(`[data-song-id][data-version-index][data-tab="true"][onclick*="'${vid.split('-')[0]}'"]`);
	if (titleEl) titleEl.textContent = '';
	if (textarea) textarea.value = '';
	if (tsInput) tsInput.value = '';
	popup.style.display = 'flex';
	if (textarea) textarea.focus();
}

function closeCommentPopup() {
	const popup = document.getElementById('comment-popup');
	if (popup) popup.style.display = 'none';
	commentPopupVid = null;
}

function addTimestampPopup() {
	if (!audioPlayer.src || audioPlayer.paused) {
		alert('Please play the song first to add a timestamp');
		return;
	}
	const currentTime = audioPlayer.currentTime;
	const tsInput = document.getElementById('comment-popup-timestamp');
	const textarea = document.getElementById('comment-popup-text');
	if (tsInput) tsInput.value = currentTime.toFixed(2);
	if (textarea) {
		const timeStr = formatSongTime(currentTime);
		const prefix = textarea.value ? ' ' : '';
		textarea.value += `${prefix}[${timeStr}]`;
		textarea.focus();
	}
}

function submitFeedbackPopup() {
	if (!commentPopupVid) return;
	const songId = commentPopupVid;
	const textarea = document.getElementById('comment-popup-text');
	const tsInput = document.getElementById('comment-popup-timestamp');
	const comment = textarea ? textarea.value.trim() : '';
	if (!comment) { alert('Please enter a comment'); return; }
	const displayName = localStorage.getItem('sv_username') || 'Anonymous';
	const songTimestamp = tsInput && tsInput.value ? parseFloat(tsInput.value) : undefined;
	if (typeof database === 'undefined') return;
	const feedbackRef = database.ref(`songs/${songId}/feedback/${clientId}`);
	const payload = { displayName, comment, clientId, timestamp: Date.now() };
	if (typeof songTimestamp === 'number' && !Number.isNaN(songTimestamp)) payload.songTimestamp = songTimestamp;
	feedbackRef.set(payload)
		.then(() => { closeCommentPopup(); })
		.catch((error) => { console.error('Error saving feedback:', error); alert('Error posting comment. Please try again.'); });
}

function submitFeedback(songId) {
	const textInput = document.getElementById(`feedback-text-${songId}`);
	const timestampInput = document.getElementById(`feedback-timestamp-${songId}`);

	const comment = textInput.value.trim();
	if (!comment) {
		alert('Please enter a comment');
		return;
	}

	const displayName = localStorage.getItem('sv_username') || 'Anonymous';
	const songTimestamp = timestampInput.value ? parseFloat(timestampInput.value) : undefined;

	if (typeof database === 'undefined') return;

	const feedbackRef = database.ref(`songs/${songId}/feedback/${clientId}`);
	const payload = {
		displayName,
		comment,
		clientId,
		timestamp: Date.now(),
	};
	if (typeof songTimestamp === 'number' && !Number.isNaN(songTimestamp)) {
		payload.songTimestamp = songTimestamp;
	}

	feedbackRef
		.set(payload)
		.then(() => {
			textInput.value = '';
			timestampInput.value = '';
		})
		.catch((error) => {
			console.error('Error saving feedback:', error);
			alert('Error posting comment. Please try again.');
		});
}

function toggleFeedback(songId) {
	const section = document.getElementById(`feedback-section-${songId}`);
	const body = document.getElementById(`feedback-body-${songId}`);
	const toggleBtn = section ? section.querySelector('.feedback-toggle') : null;
	if (!section || !body) return;

	const collapsed = section.classList.toggle('collapsed');
	body.style.display = collapsed ? 'none' : 'flex';
	if (toggleBtn) {
		toggleBtn.textContent = collapsed ? '▼' : '▲';
	}
}

// ===== UTILITIES =====
function addTimestamp(songId) {
	if (!audioPlayer.src || audioPlayer.paused) {
		alert('Please play the song first to add a timestamp');
		return;
	}

	const currentTime = audioPlayer.currentTime;
	const timestampInput = document.getElementById(`feedback-timestamp-${songId}`);
	timestampInput.value = currentTime.toFixed(2);

	const textarea = document.getElementById(`feedback-text-${songId}`);
	const timeStr = formatSongTime(currentTime);
	const prefix = textarea.value ? ' ' : '';
	textarea.value += `${prefix}[${timeStr}]`;
	textarea.focus();
}

function formatSongTime(seconds) {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function seekToTime(songId, seconds) {
	const song = songsData.find((s) => s.id === songId);
	if (!song) return;

	if (currentSongId !== songId) {
		playSong(songId);
	}

	setTimeout(() => {
		audioPlayer.currentTime = seconds;
		audioPlayer.play().catch(() => {});
	}, 200);
}

function formatTime(timestamp) {
	const date = new Date(timestamp);
	const now = new Date();
	const diffMs = now - date;
	const diffMins = Math.floor(diffMs / 60000);

	if (diffMins < 1) return 'Just now';
	if (diffMins < 60) return `${diffMins} min ago`;

	const diffHours = Math.floor(diffMins / 60);
	if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;

	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;

	return date.toLocaleDateString();
}

function escapeHtml(text) {
	const div = document.createElement('div');
	div.textContent = text;
	return div.innerHTML;
}

function shouldIgnoreHotkey(event) {
	const tag = (event.target && event.target.tagName) ? event.target.tagName.toUpperCase() : '';
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || event.target?.isContentEditable;
}

// Prefill feedback form with an existing comment so the current device can edit/overwrite it.
function prefillFeedback(songId, buttonEl) {
	if (!buttonEl) return;
	const comment = decodeURIComponent(buttonEl.getAttribute('data-comment') || '');
	const tsAttr = buttonEl.getAttribute('data-song-timestamp');
	const songTimestamp = tsAttr ? parseFloat(tsAttr) : '';

	const textInput = document.getElementById(`feedback-text-${songId}`);
	const timestampInput = document.getElementById(`feedback-timestamp-${songId}`);

	if (textInput) {
		textInput.value = comment || '';
		textInput.focus();
		textInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}
	if (timestampInput) {
		timestampInput.value = songTimestamp !== '' && !Number.isNaN(songTimestamp) ? songTimestamp : '';
	}
}

// Persist a client-scoped identifier so guests can update their own rating.
function getClientId() {
	const key = 'sv_client_id';
	const usernameKey = 'sv_username';
	
	// Check if user has a username set
	const username = localStorage.getItem(usernameKey);
	if (username) {
		return `user_${sanitizeUsername(username)}`;
	}
	
	// Otherwise use guest ID
	const existing = localStorage.getItem(key);
	if (existing) return existing;
	const newId = `guest_${Math.random().toString(36).slice(2, 10)}`;
	localStorage.setItem(key, newId);
	return newId;
}

// Format a Firebase rating key into a readable display name
function formatRaterName(userId) {
	if (userId.startsWith('user_')) {
		return userId.slice(5).replace(/_/g, ' ');
	}
	if (userId.startsWith('guest_')) {
		return 'Guest ' + userId.slice(6, 10);
	}
	return userId;
}

function toggleRatingsBreakdown(songId) {
	const list = document.getElementById(`ratings-list-${songId}`);
	const toggle = document.getElementById(`ratings-toggle-${songId}`);
	if (!list) return;
	const isCollapsed = list.classList.toggle('collapsed');
	if (toggle) toggle.textContent = isCollapsed ? '▼' : '▲';
}

// Admin: delete a specific rating entry from Firebase
function deleteRating(songId, raterUserId) {
	if (!isAdminMode || typeof database === 'undefined') return;
	if (!confirm(`Delete rating from ${formatRaterName(raterUserId)}?`)) return;

	database.ref(`songs/${songId}/ratings/${raterUserId}`).remove()
		.then(() => console.log(`Deleted rating ${raterUserId} from ${songId}`))
		.catch(err => console.error('Error deleting rating:', err));
}

// Admin: purge ALL guest ratings across every song
function purgeAllGuestRatings() {
	if (!isAdminMode || typeof database === 'undefined') return;
	if (!confirm('Delete ALL guest ratings across every song? This cannot be undone.')) return;

	const songsRef = database.ref('songs');
	songsRef.once('value', snapshot => {
		const songs = snapshot.val();
		if (!songs) return;

		const updates = {};
		let count = 0;

		Object.keys(songs).forEach(songId => {
			const song = songs[songId];
			if (song.ratings) {
				Object.keys(song.ratings).forEach(raterId => {
					if (raterId.startsWith('guest_')) {
						updates[`songs/${songId}/ratings/${raterId}`] = null;
						count++;
					}
				});
			}
		});

		if (count === 0) {
			alert('No guest ratings found.');
			return;
		}

		database.ref().update(updates)
			.then(() => alert(`Purged ${count} guest rating(s).`))
			.catch(err => console.error('Error purging guest ratings:', err));
	});
}

function sanitizeUsername(name) {
	// Remove special characters that Firebase doesn't allow in paths
	return name.toLowerCase().replace(/[.#$\[\]\/\\'"]/g, '').replace(/\s+/g, '_').slice(0, 20);
}

function getDisplayName() {
	const username = localStorage.getItem('sv_username');
	return username || 'Guest';
}

function updateUserDisplay() {
	const displayEl = document.getElementById('user-name-display');
	if (displayEl) {
		const name = getDisplayName();
		displayEl.textContent = isAdminMode ? `${name} ★` : name;
		
		// Update status dot color
		const statusDot = displayEl.previousElementSibling;
		if (statusDot && statusDot.classList.contains('status-dot')) {
			if (isAdminMode) {
				statusDot.style.background = '#ff00ff';
				statusDot.style.boxShadow = '0 0 8px #ff00ff';
			} else if (name !== 'Guest') {
				statusDot.style.background = '#00ff88';
				statusDot.style.boxShadow = '0 0 8px #00ff88';
			} else {
				statusDot.style.background = '';
				statusDot.style.boxShadow = '';
			}
		}
	}
}

function showNotListenedPopup() {
	const popup = document.getElementById('not-listened-popup');
	if (!popup) return;
	popup.style.display = 'flex';
	// Auto-dismiss after 3 seconds
	clearTimeout(showNotListenedPopup._timer);
	showNotListenedPopup._timer = setTimeout(() => {
		popup.style.display = 'none';
	}, 3000);
}

function showLoginPopup(fromRating) {
	const popup = document.getElementById('login-popup');
	const usernameInput = document.getElementById('login-username');
	const logoutBtn = document.getElementById('logout-btn');
	const statusEl = document.getElementById('login-status');
	const hintEl = popup ? popup.querySelector('.login-hint') : null;
	
	if (!popup) return;
	
	// Update hint text based on context
	if (hintEl) {
		if (fromRating) {
			hintEl.textContent = 'Create a username to rate songs and save your ratings!';
		} else {
			hintEl.textContent = 'Enter a username to sync your ratings across devices';
		}
	}
	
	// Check if already signed in
	const currentUsername = localStorage.getItem('sv_username');
	if (currentUsername) {
		usernameInput.value = currentUsername;
		logoutBtn.style.display = 'inline-block';
		statusEl.textContent = `Signed in as ${currentUsername}`;
		statusEl.classList.remove('error');
	} else {
		usernameInput.value = '';
		logoutBtn.style.display = 'none';
		statusEl.textContent = '';
	}
	
	popup.style.display = 'flex';
	usernameInput.focus();
	
	// Setup event handlers
	const submitBtn = document.getElementById('login-submit-btn');
	const cancelBtn = document.getElementById('login-cancel-btn');
	
	submitBtn.onclick = () => handleLogin();
	cancelBtn.onclick = () => hideLoginPopup();
	logoutBtn.onclick = () => handleLogout();
	
	usernameInput.onkeydown = (e) => {
		if (e.key === 'Enter') handleLogin();
		if (e.key === 'Escape') hideLoginPopup();
	};
}

function hideLoginPopup() {
	const popup = document.getElementById('login-popup');
	if (popup) {
		popup.style.display = 'none';
	}
	// Clear any pending rating if user cancelled
	pendingRating = null;
}

function handleLogin() {
	const usernameInput = document.getElementById('login-username');
	const statusEl = document.getElementById('login-status');
	
	const username = usernameInput.value.trim();
	
	if (!username) {
		statusEl.textContent = 'Please enter a username';
		statusEl.classList.add('error');
		return;
	}
	
	if (username.length < 2) {
		statusEl.textContent = 'Username must be at least 2 characters';
		statusEl.classList.add('error');
		return;
	}
	
	// Get the old guest ID before switching
	const oldGuestId = localStorage.getItem('sv_client_id');
	const newUserId = `user_${sanitizeUsername(username)}`;
	
	// Save username and update clientId
	localStorage.setItem('sv_username', username);
	clientId = getClientId(); // Refresh clientId with new username
	const wasAdmin = isAdminMode;
	isAdminMode = checkAdminMode();
	
	statusEl.textContent = 'Signing in...';
	statusEl.classList.remove('error');
	
	// Transfer guest ratings to the new user account
	if (oldGuestId && typeof database !== 'undefined') {
		transferGuestRatings(oldGuestId, newUserId, () => {
			statusEl.textContent = `Signed in as ${username}${isAdminMode ? ' (Admin)' : ''}!`;
			updateUserDisplay();
			if (isAdminMode !== wasAdmin && songsData.length) renderSongs();
			applyPendingRating();
			setTimeout(() => hideLoginPopup(), 1000);
		});
	} else {
		statusEl.textContent = `Signed in as ${username}${isAdminMode ? ' (Admin)' : ''}!`;
		updateUserDisplay();
		if (isAdminMode !== wasAdmin && songsData.length) renderSongs();
		applyPendingRating();
		setTimeout(() => hideLoginPopup(), 1000);
	}
}

// Apply a rating that was deferred while the user was still a guest
function applyPendingRating() {
	if (!pendingRating) return;
	const { songId, rating } = pendingRating;
	pendingRating = null;
	rateSong(songId, rating);
}

// Transfer ratings & feedback from guest account to user account, then delete old guest data
function transferGuestRatings(oldGuestId, newUserId, callback) {
	const songsRef = database.ref('songs');
	
	songsRef.once('value', (snapshot) => {
		const songs = snapshot.val();
		if (!songs) {
			callback();
			return;
		}
		
		const updates = {};
		let transferCount = 0;
		
		// Look through all songs for ratings and feedback from the old guest ID
		Object.keys(songs).forEach(songId => {
			const song = songs[songId];

			// Transfer ratings
			if (song.ratings && song.ratings[oldGuestId]) {
				if (!song.ratings[newUserId]) {
					// Move the guest rating to the user account
					updates[`songs/${songId}/ratings/${newUserId}`] = song.ratings[oldGuestId];
					transferCount++;
				}
				// Delete the old guest rating either way
				updates[`songs/${songId}/ratings/${oldGuestId}`] = null;
			}

			// Transfer feedback / comments
			if (song.feedback && song.feedback[oldGuestId]) {
				if (!song.feedback[newUserId]) {
					// Copy feedback and update the stored clientId & displayName
					const fb = { ...song.feedback[oldGuestId] };
					fb.clientId = newUserId;
					if (!fb.displayName || fb.displayName === 'Anonymous' || fb.displayName.startsWith('Guest')) {
						fb.displayName = localStorage.getItem('sv_username') || fb.displayName;
					}
					updates[`songs/${songId}/feedback/${newUserId}`] = fb;
				}
				// Delete the old guest feedback either way
				updates[`songs/${songId}/feedback/${oldGuestId}`] = null;
			}
		});
		
		if (Object.keys(updates).length > 0) {
			database.ref().update(updates)
				.then(() => {
					console.log(`Transferred ${transferCount} ratings to new account and cleaned up guest data`);
					callback();
				})
				.catch((err) => {
					console.error('Error transferring guest data:', err);
					callback();
				});
		} else {
			callback();
		}
	});
}

function handleLogout() {
	const wasAdmin = isAdminMode;
	localStorage.removeItem('sv_username');
	clientId = getClientId(); // Refresh to guest ID
	isAdminMode = checkAdminMode();
	
	const statusEl = document.getElementById('login-status');
	const logoutBtn = document.getElementById('logout-btn');
	const usernameInput = document.getElementById('login-username');
	
	statusEl.textContent = 'Signed out';
	statusEl.classList.remove('error');
	logoutBtn.style.display = 'none';
	usernameInput.value = '';
	
	updateUserDisplay();
	if (isAdminMode !== wasAdmin && songsData.length) renderSongs();
	
	setTimeout(() => {
		hideLoginPopup();
	}, 1000);
}

// Initialize user display on load
document.addEventListener('DOMContentLoaded', () => {
	updateUserDisplay();
	setSortMode('date'); // highlight default column header

	// Hide aurora hint when song list is scrolled to the end
	const songsGrid = document.getElementById('songs-container');
	const listPanel = songsGrid?.closest('.list-player-panel');
	if (songsGrid && listPanel) {
		window._updateAurora = () => {
			const atBottom = songsGrid.scrollTop + songsGrid.clientHeight >= songsGrid.scrollHeight - 4;
			listPanel.classList.toggle('at-bottom', atBottom);
		};
		songsGrid.addEventListener('scroll', window._updateAurora, { passive: true });
		window._updateAurora();
	}

	initAuroraCanvas();
});

// ===== AURORA WAVE CANVAS =====
function initAuroraCanvas() {
	const canvas = document.getElementById('aurora-canvas');
	if (!canvas) return;
	const ctx = canvas.getContext('2d');

	function resize() {
		canvas.width = canvas.offsetWidth;
		canvas.height = canvas.offsetHeight;
	}
	resize();
	const ro = new ResizeObserver(resize);
	ro.observe(canvas);

	const TWO_PI = Math.PI * 2;

	// Aurora color palette for color transitions
	const AURORA_PALETTE = [
		[0,   255, 140],  // green
		[0,   240, 160],  // green-teal
		[0,   220, 190],  // teal
		[30,  200, 210],  // teal-cyan
		[0,   190, 255],  // cyan
		[0,   210, 230],  // cyan-blue
		[40,  130, 255],  // blue
		[100, 80,  255],  // blue-purple
		[160, 0,   255],  // purple
		[220, 60,  200],  // pink
	];

	function makeWave(r, g, b, yFrac, amp, freq, speed, phase, lw, blur, alpha) {
		const [tr, tg, tb] = AURORA_PALETTE[Math.floor(Math.random() * AURORA_PALETTE.length)];
		// second independent color for the band gradient
		const c2 = AURORA_PALETTE[Math.floor(Math.random() * AURORA_PALETTE.length)];
		return {
			// primary color
			cr: r, cg: g, cb: b,
			tr, tg, tb,
			colorSpeed: 0.0003 + Math.random() * 0.0005,
			colorTimer: 600 + Math.floor(Math.random() * 600),
			// secondary color (the other end of the band)
			cr2: c2[0], cg2: c2[1], cb2: c2[2],
			tr2: c2[0], tg2: c2[1], tb2: c2[2],
			color2Speed: 0.0002 + Math.random() * 0.0004,
			color2Timer: 800 + Math.floor(Math.random() * 700),
			yFrac, amp, freq, speed, phase, lw, blur, alpha,
			driftVel: (Math.random() > 0.5 ? 1 : -1) * (0.001 + Math.random() * 0.002),
			driftTarget: 0,
			driftTimer: 400 + Math.floor(Math.random() * 600),
			driftOffset: 0,
			// color band scrolls independently
			bandOffset: Math.random(),
			bandSpeed: (Math.random() > 0.5 ? 1 : -1) * (0.0008 + Math.random() * 0.0012),
		};
	}

	// Wave bands — from bottom (yFrac near 1.0) to top (yFrac near 0)
	const waves = [
		makeWave(0,   255, 140, 0.98, 8,  1.8, 0.004, 0,    14, 22, 0.85),
		makeWave(0,   240, 160, 0.93, 12, 2.2, 0.003, 1.1,  10, 18, 0.80),
		makeWave(0,   220, 190, 0.87, 16, 1.5, 0.0035,2.3,  8,  16, 0.72),
		makeWave(30,  200, 210, 0.80, 20, 2.8, 0.0025,0.7,  6,  14, 0.60),
		makeWave(0,   190, 255, 0.72, 26, 1.9, 0.002, 3.5,  5,  12, 0.42),
		makeWave(0,   210, 230, 0.64, 30, 2.4, 0.0018,1.8,  4,  10, 0.30),
	];

	// Vertical rays — anchored to specific wave bands, rooted at a point on the wave
	// Each ray's base x, y, and tilt are computed live from the wave each frame
	const rays = Array.from({ length: 240 }, () => {
		// Attach to one of the lower 7 waves (the visible colored ones)
		const waveIndex = Math.floor(Math.random() * 7);
		return {
			waveIndex,
			xFrac: Math.random(),           // where along the wave (0–1)
			width: 1 + Math.random() * 2.5, // 1–3.5px crisp line
			glowWidth: 8 + Math.random() * 20,
			height: 60 + Math.random() * 160, // ray length in px
			opacity: 0.30 + Math.random() * 0.50,
			pulseSpeed: 0.004 + Math.random() * 0.009,
			pulsePhase: Math.random() * TWO_PI,
		};
	});

	function drawFrame() {
		const w = canvas.width;
		const h = canvas.height;
		ctx.clearRect(0, 0, w, h);

		// Build a lookup: waveIndex → rays attached to that wave
		const raysByWave = new Map();
		rays.forEach(ray => {
			if (!raysByWave.has(ray.waveIndex)) raysByWave.set(ray.waveIndex, []);
			raysByWave.get(ray.waveIndex).push(ray);
		});

		// Draw wave bands — fill, then rays clipped inside the fill, then stroke on top
		waves.forEach((w_, wi) => {
			// ── Drift: ease velocity toward target, randomly flip direction ──
			w_.driftTimer--;
			if (w_.driftTimer <= 0) {
				// pick a new target velocity in a random direction, slow down first
				w_.driftTarget = (Math.random() > 0.5 ? 1 : -1) * (0.001 + Math.random() * 0.002);
				w_.driftTimer = 500 + Math.floor(Math.random() * 600);
			}
			// easing: drift velocity creeps toward target (slows through zero on direction change)
			w_.driftVel += (w_.driftTarget - w_.driftVel) * 0.012;
			w_.driftOffset += w_.driftVel;

			// ── Color 1: lerp toward target ──
			w_.colorTimer--;
			if (w_.colorTimer <= 0) {
				const [tr, tg, tb] = AURORA_PALETTE[Math.floor(Math.random() * AURORA_PALETTE.length)];
				w_.tr = tr; w_.tg = tg; w_.tb = tb;
				w_.colorTimer = 400 + Math.floor(Math.random() * 500);
			}
			w_.cr += (w_.tr - w_.cr) * w_.colorSpeed;
			w_.cg += (w_.tg - w_.cg) * w_.colorSpeed;
			w_.cb += (w_.tb - w_.cb) * w_.colorSpeed;

			// ── Color 2: separate lerp for the band's second color ──
			w_.color2Timer--;
			if (w_.color2Timer <= 0) {
				const [tr2, tg2, tb2] = AURORA_PALETTE[Math.floor(Math.random() * AURORA_PALETTE.length)];
				w_.tr2 = tr2; w_.tg2 = tg2; w_.tb2 = tb2;
				w_.color2Timer = 500 + Math.floor(Math.random() * 600);
			}
			w_.cr2 += (w_.tr2 - w_.cr2) * w_.color2Speed;
			w_.cg2 += (w_.tg2 - w_.cg2) * w_.color2Speed;
			w_.cb2 += (w_.tb2 - w_.cb2) * w_.color2Speed;

			const r  = Math.round(w_.cr),  g  = Math.round(w_.cg),  b  = Math.round(w_.cb);
			const r2 = Math.round(w_.cr2), g2 = Math.round(w_.cg2), b2 = Math.round(w_.cb2);

			w_.phase += w_.speed;
			const yBase = h * w_.yFrac;

			// Collect wave points once — include driftOffset in phase
			const pts = [];
			const totalPhase = w_.phase + w_.driftOffset;
			for (let x = 0; x <= w; x += 2) {
				pts.push([x, yBase + Math.sin((x / w) * w_.freq * TWO_PI + totalPhase) * w_.amp]);
			}

			// Band center scrolls left/right with the wave's drift (0–1, wrapping)
			w_.bandOffset = ((w_.bandOffset + w_.bandSpeed) % 1.0 + 1.0) % 1.0;
			const bandPos = w_.bandOffset;

			// Build fill path (wave line → bottom-right → bottom-left → close)
			const buildFillPath = () => {
				ctx.beginPath();
				pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
				ctx.lineTo(w, h);
				ctx.lineTo(0, h);
				ctx.closePath();
			};

			const buildRayClipPath = () => {
				ctx.beginPath();
				pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
				ctx.lineTo(w, 0);
				ctx.lineTo(0, 0);
				ctx.closePath();
			};

			// Fill: blend horizontal color band with vertical fade — all in one gradient pair
			// Use a canvas offscreen trick: draw with horizontal grad, alpha driven by vertical position
			buildFillPath();
			const bp0 = Math.max(0, bandPos - 0.25);
			const bp1 = bandPos;
			const bp2 = Math.min(1, bandPos + 0.25);

			const simpleFill = ctx.createLinearGradient(0, 0, w, 0);
			simpleFill.addColorStop(0,  `rgba(${r2},${g2},${b2},${(w_.alpha * 0.35).toFixed(3)})`);
			if (bp0 > 0) simpleFill.addColorStop(bp0, `rgba(${r2},${g2},${b2},${(w_.alpha * 0.35).toFixed(3)})`);
			simpleFill.addColorStop(bp1, `rgba(${r},${g},${b},${(w_.alpha * 0.55).toFixed(3)})`);
			if (bp2 < 1) simpleFill.addColorStop(bp2, `rgba(${r2},${g2},${b2},${(w_.alpha * 0.35).toFixed(3)})`);
			simpleFill.addColorStop(1,  `rgba(${r2},${g2},${b2},${(w_.alpha * 0.35).toFixed(3)})`);
			ctx.fillStyle = simpleFill;
			ctx.fill();

			// Rays: clipped above the hard line so they rise into the curtain
			const waveRays = raysByWave.get(wi);
			if (waveRays) {
				ctx.save();
				buildRayClipPath();
				ctx.clip();

				const raySegments = waveRays.map(ray => {
					ray.pulsePhase += ray.pulseSpeed;
					const op = ray.opacity * (0.5 + 0.5 * Math.sin(ray.pulsePhase));
					const xPos = ray.xFrac * w;
					const rootY = yBase + Math.sin((xPos / w) * w_.freq * TWO_PI + totalPhase) * w_.amp;
					const topY = rootY - ray.height;
					return { ray, op, xPos, rootY, rayH: ray.height, topY };
				}).sort((a, b) => a.xPos - b.xPos);

				// Continuous curtain fabric: bottom follows the bright edge roots, top follows ripple heights.
				if (raySegments.length >= 2) {
					let avgOpacity = 0;
					let gapOpacity = 0;
					for (let i = 0; i < raySegments.length; i++) {
						avgOpacity += raySegments[i].op;
						if (i < raySegments.length - 1) {
							const gap = raySegments[i + 1].xPos - raySegments[i].xPos;
							const maxGap = w * 0.07;
							gapOpacity += Math.max(0, 1 - gap / maxGap);
						}
					}
					avgOpacity /= raySegments.length;
					gapOpacity /= Math.max(1, raySegments.length - 1);
					const sheetAlpha = Math.max(0.08, avgOpacity * (0.38 + w_.alpha * 0.78) * gapOpacity);

					const fabricGrad = ctx.createLinearGradient(0, yBase, 0, Math.min(...raySegments.map(segment => segment.topY)));
					fabricGrad.addColorStop(0, `rgba(${r},${g},${b},${sheetAlpha.toFixed(3)})`);
					fabricGrad.addColorStop(0.45, `rgba(${r},${g},${b},${(sheetAlpha * 0.55).toFixed(3)})`);
					fabricGrad.addColorStop(1, `rgba(${r},${g},${b},0)`);

					ctx.shadowBlur = 18;
					ctx.shadowColor = `rgba(${r},${g},${b},${(sheetAlpha * 0.85).toFixed(3)})`;
					ctx.fillStyle = fabricGrad;
					ctx.beginPath();
					ctx.moveTo(raySegments[0].xPos, raySegments[0].rootY);
					for (let i = 1; i < raySegments.length; i++) {
						const prev = raySegments[i - 1];
						const curr = raySegments[i];
						const controlX = (prev.xPos + curr.xPos) / 2;
						const controlY = (prev.rootY + curr.rootY) / 2;
						ctx.quadraticCurveTo(prev.xPos, prev.rootY, controlX, controlY);
					}
					const last = raySegments[raySegments.length - 1];
					ctx.lineTo(last.xPos, last.rootY);
					ctx.lineTo(last.xPos, last.topY);
					for (let i = raySegments.length - 2; i >= 0; i--) {
						const next = raySegments[i + 1];
						const curr = raySegments[i];
						const controlX = (next.xPos + curr.xPos) / 2;
						const controlY = (next.topY + curr.topY) / 2;
						ctx.quadraticCurveTo(next.xPos, next.topY, controlX, controlY);
					}
					ctx.lineTo(raySegments[0].xPos, raySegments[0].topY);
					ctx.closePath();
					ctx.fill();
					ctx.shadowBlur = 0;
				}

				raySegments.forEach(({ ray, op, xPos, rootY, rayH }) => {

					ctx.save();
					ctx.translate(xPos, rootY);
					// no rotation — rays stay perfectly vertical

					// Glow halo — rises upward from the bottom edge
					const haloGrad = ctx.createLinearGradient(0, 0, 0, -rayH);
					haloGrad.addColorStop(0,   `rgba(${r},${g},${b},${(op * 0.40).toFixed(3)})`);
					haloGrad.addColorStop(0.5, `rgba(${r},${g},${b},${(op * 0.15).toFixed(3)})`);
					haloGrad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
					ctx.fillStyle = haloGrad;
					ctx.fillRect(-ray.glowWidth / 2, -rayH, ray.glowWidth, rayH);

					// Crisp ripple line rising upward
					const lineGrad = ctx.createLinearGradient(0, 0, 0, -rayH);
					lineGrad.addColorStop(0,    `rgba(${r},${g},${b},${op.toFixed(3)})`);
					lineGrad.addColorStop(0.55, `rgba(${r},${g},${b},${(op * 0.35).toFixed(3)})`);
					lineGrad.addColorStop(1,    `rgba(${r},${g},${b},0)`);
					ctx.strokeStyle = lineGrad;
					ctx.lineWidth = ray.width;
					ctx.beginPath();
					ctx.moveTo(0, 0);
					ctx.lineTo(0, -rayH);
					ctx.stroke();

					ctx.restore();
				});

				ctx.restore(); // remove clip
			}

			// Stroke: horizontal band gradient for the wave line itself
			ctx.beginPath();
			pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
			const strokeGrad = ctx.createLinearGradient(0, 0, w, 0);
			strokeGrad.addColorStop(0,  `rgba(${r2},${g2},${b2},${w_.alpha})`);
			if (bp0 > 0) strokeGrad.addColorStop(bp0, `rgba(${r2},${g2},${b2},${w_.alpha})`);
			strokeGrad.addColorStop(bp1, `rgba(${r},${g},${b},${Math.min(1, w_.alpha * 1.4).toFixed(3)})`);
			if (bp2 < 1) strokeGrad.addColorStop(bp2, `rgba(${r2},${g2},${b2},${w_.alpha})`);
			strokeGrad.addColorStop(1,  `rgba(${r2},${g2},${b2},${w_.alpha})`);
			ctx.shadowBlur = w_.blur;
			ctx.shadowColor = `rgba(${r},${g},${b},${w_.alpha})`;
			ctx.strokeStyle = strokeGrad;
			ctx.lineWidth = w_.lw;
			ctx.lineCap = 'round';
			ctx.stroke();
			ctx.shadowBlur = 0;
		});

		requestAnimationFrame(drawFrame);
	}

	drawFrame();
}

// ===== PERFORMANCE MODE (always on) =====
function initPerfMode() {
	document.body.classList.add('low-perf-mode');
}

// ===== STARFIELD (TRAVELING THROUGH SPACE) =====
const starfieldCanvas = document.getElementById('starfield');
const starfieldCtx = starfieldCanvas ? starfieldCanvas.getContext('2d') : null;
let stars = [];
const STAR_COUNT = 200;
const BASE_SPEED = 0.3;
const BEAT_SPEED_MULTIPLIER = 2;

// Star colors that shift with the beat
const starColors = [
	{ r: 255, g: 255, b: 255 },  // White
	{ r: 0, g: 243, b: 255 },    // Cyan
	{ r: 189, g: 0, b: 255 },    // Purple
	{ r: 255, g: 0, b: 255 },    // Magenta
	{ r: 255, g: 200, b: 255 },  // Pink-white
];

function initStarfield() {
	if (!starfieldCanvas || !starfieldCtx) return;
	
	resizeStarfield();
	window.addEventListener('resize', resizeStarfield);
	
	// Initialize stars
	for (let i = 0; i < STAR_COUNT; i++) {
		stars.push(createStar());
	}
	
	animateStarfield();
}

function resizeStarfield() {
	if (!starfieldCanvas) return;
	starfieldCanvas.width = window.innerWidth;
	starfieldCanvas.height = window.innerHeight;
}

function createStar(fromCenter = false) {
	const canvas = starfieldCanvas;
	const centerX = canvas.width / 2;
	const centerY = canvas.height / 2;
	
	// Random angle from center - this determines direction of travel
	const angle = Math.random() * Math.PI * 2;
	// Start distance - new stars start near center, initial stars are spread out
	const startDist = fromCenter ? (5 + Math.random() * 30) : Math.random() * Math.max(canvas.width, canvas.height) / 2;
	
	return {
		x: centerX + Math.cos(angle) * startDist,
		y: centerY + Math.sin(angle) * startDist,
		z: fromCenter ? (600 + Math.random() * 400) : Math.random() * 1000, // New stars start medium-far
		vx: Math.cos(angle), // Store velocity direction
		vy: Math.sin(angle),
		colorIndex: Math.floor(Math.random() * starColors.length),
		twinkle: Math.random() * Math.PI * 2, // Phase for twinkling
	};
}

function animateStarfield() {
	if (!starfieldCanvas || !starfieldCtx) return;
	
	const ctx = starfieldCtx;
	const canvas = starfieldCanvas;
	const centerX = canvas.width / 2;
	const centerY = canvas.height / 2;
	
	// Check if audio is playing
	const isPlaying = audioPlayer && !audioPlayer.paused;
	
	// Get current beat intensity from CSS variable
	const boost = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--star-boost')) || 0;
	
	// Clear canvas completely (transparent so background shows through)
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	
	// Update and draw stars
	for (let i = 0; i < stars.length; i++) {
		const star = stars[i];
		
		// Only move stars when music is playing
		if (isPlaying) {
			const speed = BASE_SPEED + (boost * BEAT_SPEED_MULTIPLIER);
			// Speed increases as star gets closer (perspective acceleration)
			const depthFactor = 1 + (1000 - star.z) / 800;
			const moveSpeed = speed * depthFactor;
			
			// Move star outward using stored velocity direction - faster outward movement
			star.x += star.vx * moveSpeed * 2.5;
			star.y += star.vy * moveSpeed * 2.5;
			star.z -= moveSpeed; // Come closer slower so stars reach edges
			star.twinkle += 0.1;
			
			// Only despawn when star is actually off screen - no z-based despawn
			if (star.x < -50 || star.x > canvas.width + 50 || 
			    star.y < -50 || star.y > canvas.height + 50) {
				// Respawn from center
				stars[i] = createStar(true);
				continue;
			}
		}
		
		// Calculate size based on depth (closer = bigger) - reduced by 25%
		const size = Math.max(0.4, (1000 - star.z) / 267);
		
		// Twinkle effect
		const twinkle = 0.5 + Math.sin(star.twinkle) * 0.5;
		
		// Color shift with beat
		const colorShift = boost * 0.5;
		const colorIdx1 = star.colorIndex;
		const colorIdx2 = (star.colorIndex + 1) % starColors.length;
		const c1 = starColors[colorIdx1];
		const c2 = starColors[colorIdx2];
		
		const r = Math.round(c1.r + (c2.r - c1.r) * colorShift);
		const g = Math.round(c1.g + (c2.g - c1.g) * colorShift);
		const b = Math.round(c1.b + (c2.b - c1.b) * colorShift);
		
		// Draw star with glow
		const alpha = twinkle * (0.6 + boost * 0.4);
		
		// Outer glow
		const glowSize = size * (2 + boost * 2);
		const gradient = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, glowSize);
		gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
		gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, ${alpha * 0.3})`);
		gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
		
		ctx.beginPath();
		ctx.arc(star.x, star.y, glowSize, 0, Math.PI * 2);
		ctx.fillStyle = gradient;
		ctx.fill();
		
		// Core
		ctx.beginPath();
		ctx.arc(star.x, star.y, size, 0, Math.PI * 2);
		ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
		ctx.fill();
	}
	
	requestAnimationFrame(animateStarfield);
}

// Initialize
loadSongs();
initPerfMode();
initStarfield();
