// Now Playing panel: which card is selected/highlighted/cloned into the side panel.

import { state } from '../core/state.js';
import { audioPlayer } from '../core/dom.js';
import { resolveSongAndVersion } from './audio.js';

export function syncSidePanelPlaybackState() {
	const sidePanel = document.getElementById('now-playing-side-panel');
	const currentBaseSongId = resolveSongAndVersion(state.currentSongId)?.song?.id;
	const isShowingCurrentSong = !!state.selectedSongId && state.selectedSongId === currentBaseSongId;
	if (!sidePanel) return;

	sidePanel.classList.toggle('show-playback-state', isShowingCurrentSong);
	sidePanel.classList.toggle('now-paused', isShowingCurrentSong && !!state.currentSongId && audioPlayer.paused);
}

export function renderNowPlayingPanel(songId) {
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

	// Preserve mobile sheet chrome (close button, drag handle) — only remove the previous song clone
	sidePanel.querySelectorAll('.song-card-panel').forEach((el) => el.remove());
	sidePanel.appendChild(clone);
	sidePanel.classList.add('active');
	syncSidePanelPlaybackState();
}

export function selectSong(songId, options = {}) {
	const { scroll = true } = options;
	const card = document.getElementById(`card-${songId}`);
	if (!card) return;

	// Clear selection highlight from previous card
	if (state.selectedCardElement && state.selectedCardElement !== card) {
		state.selectedCardElement.classList.remove('panel-selected');
	}

	state.selectedSongId = songId;
	state.selectedCardElement = card;
	card.classList.add('panel-selected');

	if (scroll) {
		const smooth = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
		card.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'nearest' });
	}

	renderNowPlayingPanel(songId);
}

export function moveCardToPlayer(songId) {
	// Deactivate previously playing card row highlight
	if (state.activeCardElement) {
		if (state.activeCardElement.dataset.songId !== songId) {
			state.activeCardElement.classList.remove('in-now-playing');
		}
	}

	const card = document.getElementById(`card-${songId}`);
	if (!card) return;

	const isNewActiveCard = state.activeCardElement !== card;
	state.activeCardElement = card;

	// Highlight the list row
	card.classList.add('in-now-playing');
	if (isNewActiveCard) {
		card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	selectSong(songId, { scroll: false });
}
