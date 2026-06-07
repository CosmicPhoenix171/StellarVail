// Entry point — wires modules together, registers global handlers for inline
// HTML onclick attributes, attaches document/window/audio listeners, and runs
// the bootstrap on DOMContentLoaded.

// Side-effect import: initializes Firebase and exposes `window.database`
// before any feature module touches it.
import './core/firebase.js';

import { state } from './core/state.js';
import { audioPlayer } from './core/dom.js';
import { shouldIgnoreHotkey } from './utils/helpers.js';

import { checkAdminMode, getClientId, updateUserDisplay, showLoginPopup, hideLoginPopup, handleLogin, handleLogout } from './features/user.js';
import { selectVersion } from './features/versions.js';
import { copySongLink } from './features/share.js';
import { setSortMode, toggleUnratedFilter } from './features/sorting.js';
import {
	togglePlaySong, playNextSong, playRandomSong, toggleShuffle,
	toggleAutoplayQueue, syncAutoplayQueueButton, toggleLoopSong, syncLoopSongButton,
	updatePlayButton, resolveSongAndVersion,
} from './features/audio.js';
import { listenedEnough } from './core/state.js';
import { incrementListenCount } from './features/listens.js';
import {
	rateSong, toggleRatingsBreakdown, deleteRating, showRatingPopup, hideRatingPopup,
} from './features/ratings.js';
import {
	openCommentPopup, closeCommentPopup, addTimestampPopup, submitFeedbackPopup,
	toggleFeedback, prefillFeedback, seekToTime,
} from './features/feedback.js';
import { loadSongs } from './features/songs.js';
import {
	ensurePlaybackAnalytics, updatePlaybackAnalyticsSnapshot,
	savePlaybackAnalytics, roundAnalyticsValue, timeBucketForSeconds,
} from './features/analytics.js';

import { toggleHideUI, openAdminMode, showUI } from './ui/hideUi.js';
import { ensureAudioAnalyser, startStarBoost, stopStarBoost } from './ui/starBoost.js';
import { initAuroraCanvas } from './ui/aurora.js';
import { initStarfield } from './ui/starfield.js';
import { initPerfMode } from './ui/perf.js';
import {
	closeMobileSheet, openMobileSheet, toggleMiniPlayPause,
	openMobileRate, openMobileComment, toggleMobileMenu, initMobileUI,
} from './ui/mobile.js';

// ── Initialise mutable identity / mode state that depends on localStorage ──
state.clientId = getClientId();
state.isAdminMode = checkAdminMode();
if (audioPlayer) {
	audioPlayer.loop = state.loopSongEnabled;
}

// ── Register inline-onclick handlers on window ──
// All functions invoked from HTML attributes (in index.html or dynamically
// generated card markup) must be globally reachable.
Object.assign(window, {
	// Navigation / chrome
	toggleMobileMenu,
	setSortMode,
	openAdminMode,
	toggleUnratedFilter,
	playRandomSong,
	toggleShuffle,
	toggleAutoplayQueue,
	toggleLoopSong,
	toggleHideUI,
	showLoginPopup,
	hideLoginPopup,
	handleLogin,
	handleLogout,
	// Mobile sheet / mini player
	closeMobileSheet,
	openMobileSheet,
	openMobileRate,
	openMobileComment,
	toggleMiniPlayPause,
	// Comment popup
	closeCommentPopup,
	addTimestampPopup,
	submitFeedbackPopup,
	// Rating popup
	hideRatingPopup,
	// Per-card / per-version actions
	selectVersion,
	togglePlaySong,
	copySongLink,
	toggleFeedback,
	openCommentPopup,
	rateSong,
	toggleRatingsBreakdown,
	seekToTime,
	prefillFeedback,
	deleteRating,
});

// ── Document-level listeners ──
// Click anywhere to show UI when hidden
document.addEventListener('click', (event) => {
	if (state.uiHidden && !event.target.closest('.app-shell')) {
		showUI();
	}
});

// Escape key shows UI
document.addEventListener('keydown', (event) => {
	if (event.code === 'Escape' && state.uiHidden) {
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

// ── Audio element listeners ──
if (audioPlayer) {
	// Autoplay next track when one finishes (if enabled, and if rated or admin)
	audioPlayer.addEventListener('ended', () => {
		savePlaybackAnalytics('ended', true);
		if (!state.autoplayQueueEnabled) {
			if (!state.isAdminMode && !state.currentSongRated) {
				showRatingPopup();
			}
			return;
		}

		if (state.isAdminMode || state.currentSongRated) {
			playNextSong();
		} else {
			showRatingPopup();
		}
	});

	// Detect if user skips forward (seeking ahead invalidates listen credit)
	audioPlayer.addEventListener('seeking', () => {
		if (state.playbackAnalytics && state.playbackAnalytics.songId === state.currentSongId) {
			state.playbackAnalytics.seekCount += 1;
		}
		const seekFrom = state.lastPlaybackTime;
		const seekTo = audioPlayer.currentTime;
		// If seeking forward by more than 2 seconds, invalidate the listen
		if (seekTo > seekFrom + 2) {
			state.listenInvalidated = true;
			if (state.playbackAnalytics && state.playbackAnalytics.songId === state.currentSongId) {
				state.playbackAnalytics.forwardSkipCount += 1;
			}
		} else if (seekTo < seekFrom - 2 && state.playbackAnalytics && state.playbackAnalytics.songId === state.currentSongId) {
			const bucket = timeBucketForSeconds(seekTo);
			state.playbackAnalytics.backwardSeekCount += 1;
			state.playbackAnalytics.replayHotspots[bucket] = (state.playbackAnalytics.replayHotspots[bucket] || 0) + 1;
		}
	});

	// Credit a listen only after 75% of the track is played (without skipping)
	audioPlayer.addEventListener('timeupdate', () => {
		// Update last known position for skip detection
		state.lastPlaybackTime = audioPlayer.currentTime;
		updatePlaybackAnalyticsSnapshot();

		if (!state.currentSongId || state.listenCredited === true || state.listenInvalidated === true) return;

		const duration = audioPlayer.duration;
		if (!duration || isNaN(duration) || duration === Infinity) return;

		if (audioPlayer.currentTime >= duration * 0.75 && state.listenCreditSongId === state.currentSongId) {
			incrementListenCount(state.currentSongId);
			state.listenCredited = true;
			if (state.playbackAnalytics && state.playbackAnalytics.songId === state.currentSongId) {
				state.playbackAnalytics.listenCredited = true;
			}
			listenedEnough.add(state.currentSongId);
		}
	});

	// Reactively brighten stars based on playback loudness
	audioPlayer.addEventListener('play', async () => {
		ensurePlaybackAnalytics(state.currentSongId);
		try {
			await ensureAudioAnalyser();
			startStarBoost();
		} catch (err) {
			console.warn('Audio analyser unavailable:', err);
		}
		// Update play button to show Pause
		if (state.currentSongId) {
			const { song, vi } = resolveSongAndVersion(state.currentSongId) || {};
			if (song) updatePlayButton(song.id, vi, true);
		}
		if (state.activeCardElement) state.activeCardElement.classList.remove('now-paused');
		// Imported lazily because the import chain otherwise becomes circular
		// at module-evaluation time (audio → nowPlaying → audio).
		const { syncSidePanelPlaybackState } = await import('./features/nowPlaying.js');
		syncSidePanelPlaybackState();
	});

	audioPlayer.addEventListener('pause', async () => {
		stopStarBoost();
		if (!audioPlayer.ended && state.playbackAnalytics && state.playbackAnalytics.songId === state.currentSongId) {
			state.playbackAnalytics.pauseCount += 1;
			state.playbackAnalytics.wasPaused = true;
			if (state.playbackAnalytics.firstStopPointSeconds === null) {
				state.playbackAnalytics.firstStopPointSeconds = roundAnalyticsValue(audioPlayer.currentTime);
			}
			savePlaybackAnalytics('pause');
		}
		// Update play button to show Resume
		if (state.currentSongId) {
			const { song, vi } = resolveSongAndVersion(state.currentSongId) || {};
			if (song) updatePlayButton(song.id, vi, false);
		}
		if (state.activeCardElement) state.activeCardElement.classList.add('now-paused');
		const { syncSidePanelPlaybackState } = await import('./features/nowPlaying.js');
		syncSidePanelPlaybackState();
	});

	audioPlayer.addEventListener('ended', stopStarBoost);
}

window.addEventListener('beforeunload', () => savePlaybackAnalytics('page-exit', true));
window.addEventListener('pagehide', () => savePlaybackAnalytics('page-exit', true));

// ── DOMContentLoaded bootstrap ──
document.addEventListener('DOMContentLoaded', () => {
	updateUserDisplay();
	setSortMode('date'); // highlight default column header
	syncAutoplayQueueButton();
	syncLoopSongButton();

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
	initMobileUI();
});

// ── Final initialisation (run immediately, like the original) ──
loadSongs();
initPerfMode();
initStarfield();
