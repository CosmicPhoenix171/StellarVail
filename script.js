// Global state
let currentSongId = null;
let songsData = [];
let shuffleMode = false;
let activeCardElement = null;
let activeCardPlaceholder = null;
let listenCreditSongId = null;
let listenCredited = false;
let audioCtx = null;
let analyser = null;
let dataArray = null;
let starBoostRaf = null;

// DOM references
const audioPlayer = document.getElementById('audio-player');
const songsContainer = document.getElementById('songs-container');

// Autoplay next track when one finishes
audioPlayer.addEventListener('ended', () => {
	playNextSong();
});

// Credit a listen only after 75% of the track is played
audioPlayer.addEventListener('timeupdate', () => {
	if (!currentSongId || listenCredited === true) return;

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
});

audioPlayer.addEventListener('pause', stopStarBoost);
audioPlayer.addEventListener('ended', stopStarBoost);

// ===== DATA LOADING =====
async function loadSongs() {
	try {
		const response = await fetch('songs.json');
		songsData = await response.json();
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
	});
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
	card.innerHTML = `
		<div class="song-summary">
			<div class="summary-info" onclick="playSong('${song.id}')">
				<h3>${song.title}</h3>
			</div>
			<div class="summary-metrics">
				<div class="summary-rating">
					<span class="avg-rating" id="avg-rating-${song.id}">0.0</span>
					<span class="rating-count" id="rating-count-${song.id}">(0 ratings)</span>
				</div>
				<span class="listen-count" id="listen-count-${song.id}">👂 0 listens</span>
			</div>
		</div>
		<button class="play-button" onclick="playSong('${song.id}')" data-song-id="${song.id}">
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
			<div class="feedback-section">
				<h4>Comments</h4>
				<div class="feedback-form">
					<input type="text" id="feedback-name-${song.id}" placeholder="Your name (optional, default: Anonymous)" maxlength="50">
					<div class="textarea-with-timestamp">
						<textarea id="feedback-text-${song.id}" placeholder="Leave your feedback..." maxlength="500"></textarea>
						<button type="button" class="timestamp-btn" onclick="addTimestamp('${song.id}')" title="Add current timestamp">⏱️ Add Time</button>
					</div>
					<input type="hidden" id="feedback-timestamp-${song.id}" value="">
					<button onclick="submitFeedback('${song.id}')">Post Comment</button>
				</div>
				<div class="feedback-list" id="feedback-list-${song.id}">
					<p class="no-feedback">No comments yet. Be the first!</p>
				</div>
			</div>
		</div>
	`;
	return card;
}

// ===== PLAYBACK CONTROLS =====
function playSong(songId) {
	const song = songsData.find((s) => s.id === songId);
	if (!song) return;

	audioPlayer.src = `music/${song.filename}`;
	audioPlayer.play().catch((err) => console.error('Playback error:', err));

	listenCreditSongId = songId;
	listenCredited = false;
	updateNowPlayingCard(song);

	document.querySelectorAll('.play-button').forEach((btn) => {
		btn.classList.remove('playing');
		btn.textContent = '▶ Play';
	});

	const currentButton = document.querySelector(`button[data-song-id="${songId}"]`);
	if (currentButton) {
		currentButton.classList.add('playing');
		currentButton.textContent = '⏸ Playing';
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

	const currentIndex = songsData.findIndex((song) => song.id === currentSongId);
	const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % songsData.length;
	playSong(songsData[nextIndex].id);
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
			listenElement.textContent = `👂 ${count} listen${count === 1 ? '' : 's'}`;
		}
	});
}

function incrementListenCount(songId) {
	if (typeof database === 'undefined') return;

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
		// Map average magnitude to a stronger visible boost (0 to ~1.5)
		const boost = Math.min(1.5, (avg / 255) * 2);
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

function rateSong(songId, rating) {
	const ratedKey = `rated_${songId}`;
	if (localStorage.getItem(ratedKey)) {
		const messageEl = document.getElementById(`rating-message-${songId}`);
		if (messageEl) {
			messageEl.textContent = 'You already rated this song';
			setTimeout(() => {
				messageEl.textContent = 'Click stars to rate';
			}, 3000);
		}
		return;
	}

	if (typeof database === 'undefined') return;

	const ratingRef = database.ref(`songs/${songId}/ratings`).push();
	ratingRef
		.set({
			rating,
			timestamp: Date.now(),
		})
		.then(() => {
			localStorage.setItem(ratedKey, 'true');
			const messageEl = document.getElementById(`rating-message-${songId}`);
			if (messageEl) {
				messageEl.textContent = 'Thanks for rating!';
				setTimeout(() => {
					messageEl.textContent = 'Click stars to rate';
				}, 3000);
			}
		})
		.catch((error) => {
			console.error('Error saving rating:', error);
			const messageEl = document.getElementById(`rating-message-${songId}`);
			if (messageEl) messageEl.textContent = 'Error saving rating';
		});
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

				return `
					<div class="feedback-item">
						<div class="feedback-header">
							<span class="feedback-author">${fb.displayName || 'Anonymous'}</span>
							${timestampBadge}
							<span class="feedback-time">${formatTime(fb.timestamp)}</span>
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

	const feedbackRef = database.ref(`songs/${songId}/feedback`).push();
	const payload = {
		displayName,
		comment,
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

// Initialize
loadSongs();
