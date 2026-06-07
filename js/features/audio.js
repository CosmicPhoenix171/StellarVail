// Audio playback controls: play/pause/next/random/shuffle/loop and player
// initialisation. Coordinates with versions, listens, ratings and analytics.

import { state, selectedVersions } from '../core/state.js';
import { audioPlayer, playerBar, songsContainer } from '../core/dom.js';
import { basePath } from '../config/constants.js';
import { defaultVersionIndex, versionId, versionFilename } from './versions.js';
import { moveCardToPlayer } from './nowPlaying.js';
import { savePlaybackAnalytics } from './analytics.js';
import { checkIfUserRatedSong } from './ratings.js';

// Resolve the song object and version index from a songBaseId or versionId.
export function resolveSongAndVersion(songIdOrVersionId) {
	// Try exact base id match first
	let song = state.songsData.find((s) => s.id === songIdOrVersionId);
	if (song) return { song, vi: selectedVersions[song.id] ?? defaultVersionIndex(song) };
	// Try matching as a version id: {baseId}-{label}
	song = state.songsData.find((s) => s.versions && s.versions.some((_, i) => versionId(s, i) === songIdOrVersionId));
	if (song) {
		const vi = song.versions.findIndex((_, i) => versionId(song, i) === songIdOrVersionId);
		return { song, vi };
	}
	return null;
}

function resetPlayButtonsToDefault() {
	document.querySelectorAll('.play-button').forEach((btn) => {
		btn.classList.remove('playing');
		const bSong = state.songsData.find((s) => s.id === btn.dataset.songId);
		const bVi = parseInt(btn.dataset.versionIndex ?? 0);
		const bLabel = bSong?.versions?.[bVi]?.label || '';
		const hasVersions = bSong?.versions && bSong.versions.length > 1;
		btn.textContent = `▶ Play${hasVersions && bLabel ? ' ' + bLabel : ''}`;
	});
}

// Load a song into the player without playing it.
export function loadSongToPlayer(songBaseId, versionIndex) {
	const song = state.songsData.find((s) => s.id === songBaseId);
	if (!song) return;

	const vi = versionIndex ?? (selectedVersions[songBaseId] ?? defaultVersionIndex(song));
	const vid = versionId(song, vi);

	if (state.currentSongId === vid) return;
	if (state.currentSongId && state.currentSongId !== vid) savePlaybackAnalytics('switch-track', true);

	if (playerBar) playerBar.classList.remove('hidden');

	const folder = song.folder || song.filename.replace(/\.[^.]+$/i, '');
	const filename = versionFilename(song, vi);
	audioPlayer.src = `${basePath}music/${folder}/${filename}`;

	state.listenCreditSongId = vid;
	state.listenCredited = false;
	state.listenInvalidated = false;
	state.lastPlaybackTime = 0;
	state.currentSongRated = false;

	checkIfUserRatedSong(vid);
	moveCardToPlayer(song.id);

	resetPlayButtonsToDefault();

	state.currentSongId = vid;
}

export function togglePlaySong(songBaseId, versionIndex) {
	const song = state.songsData.find((s) => s.id === songBaseId);
	if (!song) return;
	const vi = versionIndex ?? (selectedVersions[songBaseId] ?? defaultVersionIndex(song));
	const vid = versionId(song, vi);

	if (state.currentSongId === vid) {
		if (audioPlayer.paused) {
			audioPlayer.play().catch((err) => console.error('Playback error:', err));
			updatePlayButton(songBaseId, vi, true);
		} else {
			audioPlayer.pause();
			updatePlayButton(songBaseId, vi, false);
		}
		return;
	}

	playSong(songBaseId, vi);
}

export function updatePlayButton(songBaseId, versionIndex /* , isPlaying */) {
	const btn = document.querySelector(`button[data-song-id="${songBaseId}"][data-version-index="${versionIndex}"]`)
		|| document.querySelector(`button.play-button[data-song-id="${songBaseId}"]`);
	if (!btn) return;
	btn.classList.add('playing');
	// Text stays as-is — the NOW PLAYING / NOW PAUSED overlay handles state display
}

export function playSong(songBaseId, versionIndex) {
	const song = state.songsData.find((s) => s.id === songBaseId);
	if (!song) return;

	const vi = versionIndex ?? (selectedVersions[songBaseId] ?? defaultVersionIndex(song));
	const vid = versionId(song, vi);
	if (state.currentSongId && state.currentSongId !== vid) savePlaybackAnalytics('switch-track', true);

	if (playerBar) playerBar.classList.remove('hidden');

	const folder = song.folder || song.filename.replace(/\.[^.]+$/i, '');
	const filename = versionFilename(song, vi);
	audioPlayer.src = `${basePath}music/${folder}/${filename}`;
	audioPlayer.play().catch((err) => console.error('Playback error:', err));

	state.listenCreditSongId = vid;
	state.listenCredited = false;
	state.listenInvalidated = false;
	state.lastPlaybackTime = 0;
	state.currentSongRated = false;

	checkIfUserRatedSong(vid);
	moveCardToPlayer(song.id);

	resetPlayButtonsToDefault();

	// Mark the playing version tab as active
	document.querySelectorAll('.version-tab').forEach((t) => t.classList.remove('tab-playing'));
	const playingTab = document.querySelector(`button.version-tab[data-song-id="${songBaseId}"][data-version-index="${vi}"]`);
	if (playingTab) playingTab.classList.add('tab-playing');

	updatePlayButton(songBaseId, vi, true);
	state.currentSongId = vid;
}

export function playNextSong() {
	if (!state.songsData.length) return;

	if (state.shuffleMode) {
		playSong(getRandomSongId());
		return;
	}

	// Read cards in their current DOM order — this reflects the active sort
	const allCards = Array.from(songsContainer.querySelectorAll('.song-card:not(.placeholder-card)'));
	const sortedBaseIds = allCards.map((card) => card.dataset.songId);

	// currentSongId might be a versionId — find the base song
	const currentBaseSong = state.songsData.find((s) =>
		s.id === state.currentSongId || (s.versions && s.versions.some((_, i) => versionId(s, i) === state.currentSongId))
	);
	const currentBaseId = currentBaseSong?.id;
	const currentIndex = sortedBaseIds.indexOf(currentBaseId);
	const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % sortedBaseIds.length;
	playSong(sortedBaseIds[nextIndex]);
}

export function playRandomSong() {
	if (!state.songsData.length) return;
	playSong(getRandomSongId());
}

export function getRandomSongId() {
	if (state.songsData.length === 1) {
		return state.songsData[0].id;
	}

	let randomId;
	do {
		randomId = state.songsData[Math.floor(Math.random() * state.songsData.length)].id;
	} while (randomId === state.currentSongId);

	return randomId;
}

export function toggleShuffle() {
	state.shuffleMode = !state.shuffleMode;
	const shuffleBtn = document.getElementById('shuffle-btn');
	if (!shuffleBtn) return;

	if (state.shuffleMode) {
		shuffleBtn.title = 'Shuffle: ON';
		shuffleBtn.classList.add('active');
	} else {
		shuffleBtn.title = 'Shuffle: OFF';
		shuffleBtn.classList.remove('active');
	}
}

export function syncAutoplayQueueButton() {
	const autoplayBtn = document.getElementById('autoplay-queue-btn');
	if (!autoplayBtn) return;

	autoplayBtn.title = state.autoplayQueueEnabled ? 'Queue Autoplay: ON' : 'Queue Autoplay: OFF';
	autoplayBtn.setAttribute('aria-pressed', state.autoplayQueueEnabled ? 'true' : 'false');
	autoplayBtn.classList.toggle('active', state.autoplayQueueEnabled);
	autoplayBtn.textContent = state.autoplayQueueEnabled ? 'Q▶' : 'Q⏸';
}

export function toggleAutoplayQueue() {
	state.autoplayQueueEnabled = !state.autoplayQueueEnabled;
	localStorage.setItem('sv_autoplay_queue', state.autoplayQueueEnabled ? '1' : '0');
	syncAutoplayQueueButton();
}

export function syncLoopSongButton() {
	const loopBtn = document.getElementById('loop-song-btn');
	if (!loopBtn) return;

	loopBtn.title = state.loopSongEnabled ? 'Loop Song: ON' : 'Loop Song: OFF';
	loopBtn.setAttribute('aria-pressed', state.loopSongEnabled ? 'true' : 'false');
	loopBtn.classList.toggle('active', state.loopSongEnabled);
	loopBtn.textContent = state.loopSongEnabled ? '🔁1' : '🔁';
	if (audioPlayer) {
		audioPlayer.loop = state.loopSongEnabled;
	}
}

export function toggleLoopSong() {
	state.loopSongEnabled = !state.loopSongEnabled;
	localStorage.setItem('sv_loop_song', state.loopSongEnabled ? '1' : '0');
	syncLoopSongButton();
}
