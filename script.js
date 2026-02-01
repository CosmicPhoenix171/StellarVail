// Global state
let currentSongId = null;
let songsData = [];
let shuffleMode = false;
let activeCardElement = null;
let activeCardPlaceholder = null;
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
const isAdminMode = window.location.pathname.includes('/admin');
const basePath = isAdminMode ? '../' : '';

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

// Hide player until a song is selected
if (playerBar) playerBar.classList.add('hidden');

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

// Autoplay next track when one finishes (if rated)
audioPlayer.addEventListener('ended', () => {
	if (currentSongRated) {
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
	if (currentSongId) updatePlayButton(currentSongId, true);
});

audioPlayer.addEventListener('pause', () => {
	stopStarBoost();
	// Update play button to show Resume
	if (currentSongId) updatePlayButton(currentSongId, false);
});

audioPlayer.addEventListener('ended', stopStarBoost);

// ===== SONG SORTING =====
let currentSortMode = 'date'; // 'rating' or 'date'

function setSortMode(mode) {
	currentSortMode = mode;
	
	// Update button states
	document.querySelectorAll('.sort-btn').forEach(btn => btn.classList.remove('active'));
	const activeBtn = document.getElementById(`sort-${mode}-btn`);
	if (activeBtn) activeBtn.classList.add('active');
	
	// Re-sort immediately
	sortSongCards();
}

function debouncedSortSongs() {
	// Debounce to avoid sorting on every Firebase update
	if (sortDebounceTimer) clearTimeout(sortDebounceTimer);
	sortDebounceTimer = setTimeout(sortSongCards, 300);
}

function sortSongCards() {
	const cards = Array.from(songsContainer.querySelectorAll('.song-card:not(.placeholder-card)'));
	if (cards.length === 0) return;

	cards.sort((a, b) => {
		const idA = a.dataset.songId;
		const idB = b.dataset.songId;
		
		if (currentSortMode === 'date') {
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
		} else {
			// Sort by rating (default)
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

	// Re-append in sorted order (moves existing DOM nodes)
	cards.forEach(card => songsContainer.appendChild(card));
}

// ===== DATA LOADING =====

// Legacy ID mapping - maps filename to old Firebase ID to preserve ratings/listens
const legacyIdMap = {
	'Tik.wav': 'song1',
	'before morning rise.wav': 'song2',
	'Broken.wav': 'song3',
	'1 Unread.wav': 'song4',
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
		const response = await fetch(`${basePath}songs.json`);
		const songs = await response.json();
		
		// Get today's date for songs without dateAdded
		const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
		
		// Auto-generate id, title, and date from filename
		songsData = songs
			.filter(song => song.filename && song.filename !== '.wav') // Skip empty entries
			.map(song => {
				const baseName = song.filename.replace(/\.wav$/i, '');
				// Remove characters not allowed in Firebase paths or that break HTML/JS: . # $ [ ] ' "
				const safeId = baseName.toLowerCase().replace(/\s+/g, '-').replace(/[.#$\[\]'"]/g, '');
				// Use legacy ID if available to preserve Firebase data
				const id = song.id || legacyIdMap[song.filename] || safeId;
				return {
					id: id,
					title: song.title || baseName,
					filename: song.filename,
					dateAdded: song.dateAdded || today
				};
			});
		
		renderSongs();
	} catch (error) {
		console.error('Error loading songs:', error);
		songsContainer.innerHTML = '<p style="color: white;">Error loading songs. Please check songs.json file.</p>';
	}
}

function renderSongs() {
	songsContainer.innerHTML = '';

	songsData.forEach((song) => {
		const songCard = createSongCard(song);
		songsContainer.appendChild(songCard);

		loadRatingData(song.id);
		loadListenCount(song.id);
		loadFeedback(song.id);
		checkUserHasRated(song.id);
	});
	
	// Sort immediately after render (especially for date sorting)
	sortSongCards();
}

function createSongCard(song) {
	const card = document.createElement('div');
	card.className = 'song-card';
	card.id = `card-${song.id}`;
	card.dataset.songId = song.id;

	const artistValue = (song.artist || '').trim();
	const descriptionValue = (song.description || '').trim();
	const artistIsPlaceholder = !artistValue || ['your name', 'artist name'].includes(artistValue.toLowerCase());
	const descriptionIsPlaceholder = !descriptionValue || descriptionValue.toLowerCase().startsWith('description of your');
	const artistHtml = artistIsPlaceholder ? '' : `<p class="artist">${song.artist}</p>`;
	const descriptionHtml = descriptionIsPlaceholder ? '' : `<p class="description">${song.description}</p>`;
	const detailHeaderHtml = artistHtml || descriptionHtml ? `<div class="detail-header">${artistHtml}${descriptionHtml}</div>` : '';
	const ratingHiddenClass = isAdminMode ? '' : 'rating-hidden';
	
	// Format date for display
	const dateAdded = song.dateAdded ? formatDate(song.dateAdded) : '';
	const dateHtml = dateAdded ? `<span class="date-added">${dateAdded}</span>` : '';
	
	card.innerHTML = `
		<div class="song-summary">
			<div class="summary-info">
				<h3>${song.title}</h3>
				${dateHtml}
			</div>
			<div class="summary-metrics">
				<div class="summary-rating ${ratingHiddenClass}" id="summary-rating-${song.id}">
					<span class="avg-rating" id="avg-rating-${song.id}">0.0</span>
					<span class="rating-count" id="rating-count-${song.id}">(0 ratings)</span>
				</div>
				<span class="listen-count" id="listen-count-${song.id}">0 listens</span>
			</div>
		</div>
		<button class="play-button" onclick="togglePlaySong('${song.id}')" data-song-id="${song.id}">
			▶ Play
		</button>
		<div class="detail-section">
			${detailHeaderHtml}
			<div class="rating-section">
				<div class="rating-stars" id="rating-stars-${song.id}">
					${[1, 2, 3, 4, 5].map((i) => `<span class="star" data-rating="${i}" onclick="rateSong('${song.id}', ${i})">★</span>`).join('')}
				</div>
				<p class="rating-message" id="rating-message-${song.id}">Click stars to rate</p>
			</div>
			<div class="feedback-section collapsed" id="feedback-section-${song.id}">
				<div class="feedback-header-row">
					<h4>Comments</h4>
					<button type="button" class="feedback-toggle" onclick="toggleFeedback('${song.id}')">▼</button>
				</div>
				<div class="feedback-body" id="feedback-body-${song.id}">
					<div class="feedback-form">
						<input type="text" id="feedback-name-${song.id}" placeholder="Name (optional)" maxlength="50">
						<textarea id="feedback-text-${song.id}" placeholder="Write a comment..." maxlength="500"></textarea>
						<input type="hidden" id="feedback-timestamp-${song.id}" value="">
						<div class="feedback-actions">
							<button type="button" class="timestamp-btn" onclick="addTimestamp('${song.id}')" title="Add current timestamp">⏱ Timestamp</button>
							<button class="submit-btn" onclick="submitFeedback('${song.id}')">Post</button>
						</div>
					</div>
					<div class="feedback-list" id="feedback-list-${song.id}">
						<p class="no-feedback">No comments yet. Be the first!</p>
					</div>
				</div>
			</div>
		</div>
	`;
	return card;
}

// ===== PLAYBACK CONTROLS =====
function togglePlaySong(songId) {
	// If this is the current song, toggle play/pause
	if (currentSongId === songId) {
		if (audioPlayer.paused) {
			audioPlayer.play().catch((err) => console.error('Playback error:', err));
			updatePlayButton(songId, true);
		} else {
			audioPlayer.pause();
			updatePlayButton(songId, false);
		}
		return;
	}
	
	// Otherwise, play the new song
	playSong(songId);
}

function updatePlayButton(songId, isPlaying) {
	const button = document.querySelector(`button[data-song-id="${songId}"]`);
	if (button) {
		if (isPlaying) {
			button.classList.add('playing');
			button.textContent = '⏸ Pause';
		} else {
			button.classList.add('playing'); // Keep playing class to show it's the current song
			button.textContent = '▶ Resume';
		}
	}
}

function playSong(songId) {
	const song = songsData.find((s) => s.id === songId);
	if (!song) return;

	if (playerBar) playerBar.classList.remove('hidden');

	audioPlayer.src = `${basePath}music/${song.filename}`;
	audioPlayer.play().catch((err) => console.error('Playback error:', err));

	listenCreditSongId = songId;
	listenCredited = false;
	listenInvalidated = false; // Reset skip detection for new song
	lastPlaybackTime = 0; // Reset playback position tracker
	currentSongRated = false; // Reset rating status for new song
	
	// Check if user already rated this song
	checkIfUserRatedSong(songId);
	
	updateNowPlayingCard(song);

	document.querySelectorAll('.play-button').forEach((btn) => {
		btn.classList.remove('playing');
		btn.textContent = '▶ Play';
	});

	const currentButton = document.querySelector(`button[data-song-id="${songId}"]`);
	if (currentButton) {
		currentButton.classList.add('playing');
		currentButton.textContent = '⏸ Pause';
	}

	currentSongId = songId;
}

function updateNowPlayingCard(song) {
	const card = document.getElementById('now-playing-card');
	if (!card) return;

	moveCardToPlayer(song.id);
}

function moveCardToPlayer(songId) {
	const nowPlayingContainer = document.getElementById('now-playing-card');
	if (!nowPlayingContainer) return;

	// If the requested song is already in the player, nothing to do
	if (activeCardElement && activeCardElement.dataset.songId === songId) {
		return;
	}

	// Restore previously active card back to the list
	if (activeCardElement && activeCardPlaceholder) {
		activeCardElement.classList.remove('in-now-playing');
		activeCardPlaceholder.replaceWith(activeCardElement);
		activeCardElement = null;
		activeCardPlaceholder = null;
	}

	const card = document.getElementById(`card-${songId}`);
	if (!card) {
		nowPlayingContainer.innerHTML = '<p class="no-song-playing">Select a song to play</p>';
		return;
	}

	const placeholder = document.createElement('div');
	placeholder.className = 'song-card placeholder-card';
	placeholder.innerHTML = '<p class="placeholder-text">Playing in the Now Playing panel</p>';

	card.parentNode.replaceChild(placeholder, card);

	card.classList.add('in-now-playing');
	nowPlayingContainer.innerHTML = '';
	nowPlayingContainer.appendChild(card);

	activeCardElement = card;
	activeCardPlaceholder = placeholder;
}

function playNextSong() {
	if (!songsData.length) return;

	if (shuffleMode) {
		playSong(getRandomSongId());
		return;
	}

	// Get sorted order from DOM - include placeholder cards to find current song's position
	const allCards = Array.from(songsContainer.querySelectorAll('.song-card'));
	// Map to song IDs - for placeholder, use the active card's ID
	const sortedIds = allCards.map(card => {
		if (card.classList.contains('placeholder-card') && activeCardElement) {
			return activeCardElement.dataset.songId;
		}
		return card.dataset.songId;
	});
	
	const currentIndex = sortedIds.indexOf(currentSongId);
	const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % sortedIds.length;
	playSong(sortedIds[nextIndex]);
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
		shuffleBtn.textContent = '🔀 Shuffle: ON';
		shuffleBtn.classList.add('active');
	} else {
		shuffleBtn.textContent = '🔀 Shuffle: OFF';
		shuffleBtn.classList.remove('active');
	}
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
		if (!songStats[songId]) songStats[songId] = { rating: 0, listens: 0 };
		songStats[songId].listens = count;
		debouncedSortSongs();
	});
}

function incrementListenCount(songId) {
	if (typeof database === 'undefined') return;
	if (isAdminMode) return; // Don't count listens on admin page

	const listensRef = database.ref(`songs/${songId}/listens`);
	listensRef.transaction((currentCount) => (currentCount || 0) + 1);
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
function loadRatingData(songId) {
	if (typeof database === 'undefined') return;

	const ratingsRef = database.ref(`songs/${songId}/ratings`);
	ratingsRef.on('value', (snapshot) => {
		const ratings = snapshot.val();
		let sum = 0;
		let count = 0;

		if (ratings) {
			Object.values(ratings).forEach((rating) => {
				sum += rating.rating;
				count += 1;
			});
		}

		const average = count > 0 ? (sum / count).toFixed(1) : '0.0';
		const avgElement = document.getElementById(`avg-rating-${songId}`);
		const countElement = document.getElementById(`rating-count-${songId}`);
		if (avgElement) avgElement.textContent = average;
		if (countElement) countElement.textContent = `(${count} rating${count === 1 ? '' : 's'})`;

		updateStarsDisplay(songId, parseFloat(average));
		
		// Track for sorting
		if (!songStats[songId]) songStats[songId] = { rating: 0, listens: 0 };
		songStats[songId].rating = parseFloat(average);
		debouncedSortSongs();
	});
}

function updateStarsDisplay(songId, average) {
	const starsContainer = document.getElementById(`rating-stars-${songId}`);
	if (!starsContainer) return;

	starsContainer.querySelectorAll('.star').forEach((star, index) => {
		if (index < Math.round(average)) {
			star.classList.add('filled');
		} else {
			star.classList.remove('filled');
		}
	});
}

function revealRating(songId) {
	const ratingEl = document.getElementById(`summary-rating-${songId}`);
	if (ratingEl) {
		ratingEl.classList.remove('rating-hidden');
	}
}

function checkUserHasRated(songId) {
	if (typeof database === 'undefined') return;

	const userRatingRef = database.ref(`songs/${songId}/ratings/${clientId}`);
	userRatingRef.once('value', (snapshot) => {
		if (snapshot.exists()) {
			revealRating(songId);
		}
	});
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

function rateSong(songId, rating) {
	if (typeof database === 'undefined') return;

	const ratingRef = database.ref(`songs/${songId}/ratings/${clientId}`);
	ratingRef
		.set({
			rating,
			timestamp: Date.now(),
		})
		.then(() => {
			const messageEl = document.getElementById(`rating-message-${songId}`);
			if (messageEl) {
				messageEl.textContent = 'Rating saved';
				setTimeout(() => {
					messageEl.textContent = 'Click stars to rate';
				}, 2500);
			}
			// Reveal the rating now that user has rated
			revealRating(songId);
			// Mark current song as rated
			if (songId === currentSongId) {
				currentSongRated = true;
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
	
	// Get current song title
	const currentSong = allSongs.find(s => s.id === currentSongId);
	if (songTitle && currentSong) {
		songTitle.textContent = currentSong.title;
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
		if (!feedbackList) return;

		const feedbacks = snapshot.val();
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

function submitFeedback(songId) {
	const nameInput = document.getElementById(`feedback-name-${songId}`);
	const textInput = document.getElementById(`feedback-text-${songId}`);
	const timestampInput = document.getElementById(`feedback-timestamp-${songId}`);

	const comment = textInput.value.trim();
	if (!comment) {
		alert('Please enter a comment');
		return;
	}

	const displayName = nameInput.value.trim() || 'Anonymous';
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
			nameInput.value = '';
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
	const name = decodeURIComponent(buttonEl.getAttribute('data-name') || '');
	const comment = decodeURIComponent(buttonEl.getAttribute('data-comment') || '');
	const tsAttr = buttonEl.getAttribute('data-song-timestamp');
	const songTimestamp = tsAttr ? parseFloat(tsAttr) : '';

	const nameInput = document.getElementById(`feedback-name-${songId}`);
	const textInput = document.getElementById(`feedback-text-${songId}`);
	const timestampInput = document.getElementById(`feedback-timestamp-${songId}`);

	if (nameInput) nameInput.value = name || '';
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
	const existing = localStorage.getItem(key);
	if (existing) return existing;
	const newId = `guest_${Math.random().toString(36).slice(2, 10)}`;
	localStorage.setItem(key, newId);
	return newId;
}

// ===== PERFORMANCE MODE =====
function togglePerfMode() {
	document.body.classList.toggle('low-perf-mode');
	const isLowPerf = document.body.classList.contains('low-perf-mode');
	localStorage.setItem('sv_low_perf', isLowPerf ? '1' : '0');
	
	const btn = document.getElementById('perf-btn');
	if (btn) {
		btn.textContent = isLowPerf ? '⚡ Perf: ON' : '⚡ Perf';
		btn.title = isLowPerf ? 'Low performance mode ON - click to disable' : 'Toggle low performance mode';
	}
}

function initPerfMode() {
	// Check saved preference
	const savedPref = localStorage.getItem('sv_low_perf');
	if (savedPref === '1') {
		document.body.classList.add('low-perf-mode');
		const btn = document.getElementById('perf-btn');
		if (btn) btn.textContent = '⚡ Perf: ON';
		return;
	}
	
	// Auto-detect low performance (no GPU / low frame rate)
	let frameCount = 0;
	let lastTime = performance.now();
	
	function measureFPS(timestamp) {
		frameCount++;
		if (timestamp - lastTime >= 1000) {
			const fps = frameCount;
			frameCount = 0;
			lastTime = timestamp;
			
			// If FPS is below 30, suggest low-perf mode
			if (fps < 30 && !document.body.classList.contains('low-perf-mode')) {
				console.log('Low FPS detected (' + fps + '), enabling low-perf mode');
				document.body.classList.add('low-perf-mode');
				localStorage.setItem('sv_low_perf', '1');
				const btn = document.getElementById('perf-btn');
				if (btn) btn.textContent = '⚡ Perf: ON';
				return; // Stop measuring
			}
			
			// Stop after 3 seconds of measurement
			if (timestamp - startTime > 3000) return;
		}
		requestAnimationFrame(measureFPS);
	}
	
	const startTime = performance.now();
	requestAnimationFrame(measureFPS);
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
