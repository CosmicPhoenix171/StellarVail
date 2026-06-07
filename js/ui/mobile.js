// Mobile mini-player sheet, mini play button, and burger menu.

import { state } from '../core/state.js';
import { audioPlayer } from '../core/dom.js';
import { resolveSongAndVersion } from '../features/audio.js';
import { showRatingPopup } from '../features/ratings.js';
import { openCommentPopup } from '../features/feedback.js';

export function closeMobileSheet() {
	document.body.classList.remove('mobile-sheet-open');
}

export function openMobileSheet() {
	if (!state.currentSongId && !state.selectedSongId) return;
	document.body.classList.add('mobile-sheet-open');
}

export function toggleMiniPlayPause() {
	if (!audioPlayer || !audioPlayer.src) return;
	if (audioPlayer.paused) {
		audioPlayer.play().catch((err) => console.warn('Playback error:', err));
	} else {
		audioPlayer.pause();
	}
}

export function openMobileRate() {
	if (!state.currentSongId) return;
	showRatingPopup();
}

export function openMobileComment() {
	if (!state.currentSongId) return;
	openCommentPopup(state.currentSongId);
}

function updateMiniPlayer() {
	const mini = document.getElementById('mobile-mini-player');
	if (!mini) return;
	const titleEl = document.getElementById('mini-player-title');
	const subEl = document.getElementById('mini-player-sub');
	const artEl = document.getElementById('mini-player-art');
	const artFallback = document.getElementById('mini-player-art-fallback');

	if (!state.currentSongId) {
		document.body.classList.remove('has-current-song');
		return;
	}

	const resolved = resolveSongAndVersion(state.currentSongId);
	if (!resolved || !resolved.song) {
		document.body.classList.remove('has-current-song');
		return;
	}

	const { song, vi } = resolved;
	const versionLabel = song.versions?.[vi]?.label || '';
	const artistText = (song.artist || '').trim();
	const subParts = [];
	if (artistText && artistText.toLowerCase() !== 'unknown') subParts.push(artistText);
	if (versionLabel) subParts.push(versionLabel);

	if (titleEl) titleEl.textContent = song.title || 'Untitled';
	if (subEl) subEl.textContent = subParts.join(' • ') || 'Now playing';

	if (artEl && artFallback) {
		if (song.art) {
			artEl.src = song.art;
			artEl.style.display = '';
			artFallback.style.display = 'none';
			artEl.onerror = () => { artEl.style.display = 'none'; artFallback.style.display = 'flex'; };
		} else {
			artEl.removeAttribute('src');
			artEl.style.display = 'none';
			artFallback.style.display = 'flex';
		}
	}

	document.body.classList.add('has-current-song');
	syncMiniPlayState();
}

function syncMiniPlayState() {
	const btn = document.getElementById('mini-play-btn');
	if (!btn || !audioPlayer) return;
	const playing = !!audioPlayer.src && !audioPlayer.paused;
	btn.textContent = playing ? '⏸' : '▶';
	btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function syncMiniProgress() {
	const bar = document.getElementById('mini-player-progress-bar');
	if (!bar || !audioPlayer) return;
	const d = audioPlayer.duration;
	if (!d || !isFinite(d)) { bar.style.width = '0%'; return; }
	const pct = Math.max(0, Math.min(100, (audioPlayer.currentTime / d) * 100));
	bar.style.width = pct + '%';
}

export function toggleMobileMenu(force) {
	const body = document.body;
	const next = typeof force === 'boolean' ? force : !body.classList.contains('mobile-menu-open');
	body.classList.toggle('mobile-menu-open', next);
	const toggle = document.getElementById('mobile-menu-toggle');
	if (toggle) toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
}

export function initMobileUI() {
	// Wire mini-player to audio events
	if (audioPlayer) {
		audioPlayer.addEventListener('play', () => { updateMiniPlayer(); syncMiniPlayState(); });
		audioPlayer.addEventListener('pause', syncMiniPlayState);
		audioPlayer.addEventListener('loadedmetadata', () => { updateMiniPlayer(); syncMiniProgress(); });
		audioPlayer.addEventListener('timeupdate', syncMiniProgress);
		audioPlayer.addEventListener('ended', () => { syncMiniPlayState(); syncMiniProgress(); });
	}
	// Close mobile menu when a control inside top-bar-right is tapped
	const topBarRight = document.querySelector('.top-bar-right');
	if (topBarRight) {
		topBarRight.addEventListener('click', (e) => {
			if (!document.body.classList.contains('mobile-menu-open')) return;
			const target = e.target.closest('button, .user-pill, .filter-chip');
			if (target) toggleMobileMenu(false);
		});
	}

	// Close sheet on Escape
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && document.body.classList.contains('mobile-sheet-open')) {
			closeMobileSheet();
		}
	});
}
