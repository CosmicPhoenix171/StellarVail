// Sorting and filtering the song list.

import { state } from '../core/state.js';
import { songsContainer } from '../core/dom.js';

// Sorts the song cards and applies the current sort mode/direction.
export function setSortMode(mode) {
	if (mode === state.currentSortMode) {
		state.currentSortDir = state.currentSortDir === 'desc' ? 'asc' : 'desc';
	} else {
		state.currentSortMode = mode;
		state.currentSortDir = 'desc';
	}

	// Update old button states (hidden bar kept for compatibility)
	document.querySelectorAll('.sort-btn').forEach((btn) => btn.classList.remove('active'));
	const activeBtn = document.getElementById(`sort-${mode}-btn`);
	if (activeBtn) activeBtn.classList.add('active');

	// Sync mobile sort dropdown
	const mobileSelect = document.getElementById('mobile-sort-select');
	if (mobileSelect && mobileSelect.value !== mode) mobileSelect.value = mode;

	// Update column header highlight + arrow
	const colMap = { title: 'sch-title', date: 'sch-date', rating: 'sch-rating', listens: 'sch-listens', comments: 'sch-comments' };
	document.querySelectorAll('.sch-sortable').forEach((el) => {
		el.classList.remove('sch-active');
		const arrow = el.querySelector('.sort-arrow');
		if (arrow) arrow.textContent = '';
	});
	const activeCol = document.getElementById(colMap[mode]);
	if (activeCol) {
		activeCol.classList.add('sch-active');
		const arrow = activeCol.querySelector('.sort-arrow');
		if (arrow) arrow.textContent = state.currentSortDir === 'desc' ? ' ▼' : ' ▲';
	}

	// Re-sort immediately
	sortSongCards();
}

// Debounced sort: avoids re-sorting on every Firebase update.
export function debouncedSortSongs() {
	if (state.sortDebounceTimer) clearTimeout(state.sortDebounceTimer);
	state.sortDebounceTimer = setTimeout(sortSongCards, 300);
}

export function sortSongCards() {
	if (!songsContainer) return;
	const songStats = state.songStats;
	// Get all cards from the songs container, excluding placeholder and the active card in Now Playing
	const cards = Array.from(songsContainer.querySelectorAll('.song-card:not(.placeholder-card)'));

	// Also need to consider the placeholder's position for sorting
	if (cards.length === 0) return;

	const sortableItems = [...cards];

	sortableItems.sort((a, b) => {
		const idA = a.dataset.songId;
		const idB = b.dataset.songId;

		if (!idA || !idB) return 0;

		if (state.currentSortMode === 'title') {
			const songA = state.songsData.find((s) => s.id === idA);
			const songB = state.songsData.find((s) => s.id === idB);
			return (songA?.title || '').localeCompare(songB?.title || '');
		}
		if (state.currentSortMode === 'date') {
			const songA = state.songsData.find((s) => s.id === idA);
			const songB = state.songsData.find((s) => s.id === idB);
			const dateA = songA?.dateAdded ? new Date(songA.dateAdded).getTime() : 0;
			const dateB = songB?.dateAdded ? new Date(songB.dateAdded).getTime() : 0;

			if (dateB !== dateA) return dateB - dateA;
			const statsA = songStats[idA] || { rating: 0 };
			const statsB = songStats[idB] || { rating: 0 };
			return statsB.rating - statsA.rating;
		}
		if (state.currentSortMode === 'listens') {
			const statsA = songStats[idA] || { rating: 0, listens: 0 };
			const statsB = songStats[idB] || { rating: 0, listens: 0 };
			if (statsB.listens !== statsA.listens) return statsB.listens - statsA.listens;
			return statsB.rating - statsA.rating;
		}
		if (state.currentSortMode === 'comments') {
			const statsA = songStats[idA] || { comments: 0 };
			const statsB = songStats[idB] || { comments: 0 };
			return (statsB.comments || 0) - (statsA.comments || 0);
		}

		// Default: sort by rating
		const statsA = songStats[idA] || { rating: 0, listens: 0 };
		const statsB = songStats[idB] || { rating: 0, listens: 0 };
		if (statsB.rating !== statsA.rating) return statsB.rating - statsA.rating;
		return statsB.listens - statsA.listens;
	});

	// Apply sort direction
	if (state.currentSortDir === 'asc') sortableItems.reverse();

	// Re-append in sorted order (moves existing DOM nodes)
	sortableItems.forEach((item) => songsContainer.appendChild(item));

	// Mark top 12 highest-rated songs with golden glow
	markTop12RatedSongs();
	// Re-apply unrated filter after sort
	applyUnratedFilter();
}

export function toggleUnratedFilter() {
	state.filterUnrated = !state.filterUnrated;
	const btn = document.getElementById('filter-unrated-btn');
	if (btn) btn.classList.toggle('filter-chip-active', state.filterUnrated);
	applyUnratedFilter();
}

export function applyUnratedFilter() {
	if (!songsContainer) return;
	const cards = songsContainer.querySelectorAll('.song-card:not(.placeholder-card)');
	cards.forEach((card) => {
		if (!state.filterUnrated) {
			card.style.display = '';
			return;
		}
		// Card is "rated" if any summary-rating inside it has had rating-hidden removed
		const rated = card.querySelector('.summary-rating:not(.rating-hidden)') !== null;
		card.style.display = rated ? 'none' : '';
	});
}

// Mark top 12 highest-rated songs with a golden glow.
export function markTop12RatedSongs() {
	if (!songsContainer) return;
	const songStats = state.songStats;
	const allCards = Array.from(songsContainer.querySelectorAll('.song-card'));

	// Sort by rating to find top 12 (regardless of current sort mode)
	const sortedByRating = [...allCards].sort((a, b) => {
		const idA = a.dataset.songId;
		const idB = b.dataset.songId;
		const statsA = songStats[idA] || { rating: 0, listens: 0 };
		const statsB = songStats[idB] || { rating: 0, listens: 0 };

		if (statsB.rating !== statsA.rating) return statsB.rating - statsA.rating;
		return statsB.listens - statsA.listens;
	});

	const top12Ids = new Set(sortedByRating.slice(0, 12).map((card) => card.dataset.songId));

	allCards.forEach((card) => {
		const songId = card.dataset.songId;
		const stats = songStats[songId] || { rating: 0 };
		if (top12Ids.has(songId) && stats.rating > 0) {
			card.classList.add('top-rated');
		} else {
			card.classList.remove('top-rated');
		}
	});
}
