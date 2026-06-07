// Per-version listen counts, NEW-badge tracking, and song-stats bookkeeping.

import { state, selectedVersions, heardSongs, heardVersions } from '../core/state.js';
import { defaultVersionIndex, versionId } from './versions.js';
import { debouncedSortSongs } from './sorting.js';

export function ensureSongStatsEntry(songId) {
	const songStats = state.songStats;
	if (!songStats[songId]) {
		songStats[songId] = {
			rating: 0,
			listens: 0,
			versionRatings: {},
			versionSelectionRatings: {},
			versionListens: {},
			userRatedVersions: {},
		};
	} else if (!songStats[songId].versionRatings) {
		songStats[songId].versionRatings = {};
	}
	if (!songStats[songId].versionSelectionRatings) {
		songStats[songId].versionSelectionRatings = {};
	}
	if (!songStats[songId].versionListens) {
		songStats[songId].versionListens = {};
	}
	if (!songStats[songId].userRatedVersions) {
		songStats[songId].userRatedVersions = {};
	}
	return songStats[songId];
}

export function refreshArtListenCount(songBaseId) {
	const song = state.songsData.find((entry) => entry.id === songBaseId);
	const artListenEl = document.getElementById(`art-listen-${songBaseId}`);
	if (!song || !artListenEl) return;
	const statsEntry = ensureSongStatsEntry(songBaseId);
	const selectedIndex = selectedVersions[songBaseId] ?? defaultVersionIndex(song);
	const selectedVersionId = versionId(song, selectedIndex);
	const count = Number(statsEntry.versionListens[selectedVersionId] || 0);
	artListenEl.textContent = `${count} version listen${count === 1 ? '' : 's'}`;
}

export function refreshArtRatingChip(songBaseId) {
	const song = state.songsData.find((entry) => entry.id === songBaseId);
	const artRatingEl = document.getElementById(`art-rating-${songBaseId}`);
	if (!song || !artRatingEl) return;

	const hasMultipleVersions = Array.isArray(song.versions) && song.versions.length > 1;
	if (!hasMultipleVersions) {
		artRatingEl.style.display = 'none';
		return;
	}

	const statsEntry = ensureSongStatsEntry(songBaseId);
	const bestAverage = Math.max(0, ...Object.values(statsEntry.versionRatings || {}));
	if (bestAverage <= 0) {
		artRatingEl.style.display = 'none';
		return;
	}

	const filledStars = Math.max(1, Math.round(bestAverage));
	artRatingEl.textContent = `${'★'.repeat(filledStars)}${'☆'.repeat(5 - filledStars)}`;
	artRatingEl.title = `Highest rated version: ${bestAverage.toFixed(1)} stars`;
	artRatingEl.style.display = '';
}

export function refreshBestVersionSummaryStars(songBaseId) {
	const song = state.songsData.find((entry) => entry.id === songBaseId);
	if (!song?.versions?.length || song.versions.length <= 1) return;

	const statsEntry = ensureSongStatsEntry(songBaseId);
	const bestAverage = Math.max(0, ...Object.values(statsEntry.versionRatings || {}));
	const filledStars = Math.round(bestAverage);

	song.versions.forEach((_, versionIndex) => {
		const summaryStars = document.getElementById(`summary-stars-${versionId(song, versionIndex)}`);
		if (!summaryStars) return;
		summaryStars.querySelectorAll('.summary-star').forEach((star, index) => {
			star.classList.toggle('version-best', filledStars > 0 && index < filledStars);
		});
	});
}

export function loadListenCount(songId) {
	if (typeof database === 'undefined') return;

	const listensRef = database.ref(`songs/${songId}/listens`);
	listensRef.on('value', (snapshot) => {
		const count = snapshot.val() || 0;
		// Aggregate listens under the base song ID for sorting
		const baseSong = state.songsData.find((s) =>
			s.id === songId || (s.versions && s.versions.some((_, i) => versionId(s, i) === songId))
		);
		const statKey = baseSong ? baseSong.id : songId;
		const statsEntry = ensureSongStatsEntry(statKey);
		statsEntry.versionListens[songId] = count;
		statsEntry.listens = Object.values(statsEntry.versionListens).reduce((sum, value) => sum + Number(value || 0), 0);
		const total = statsEntry.listens;
		if (baseSong?.versions?.length) {
			baseSong.versions.forEach((_, versionIndex) => {
				const versionListenEl = document.getElementById(`listen-count-${versionId(baseSong, versionIndex)}`);
				if (versionListenEl) {
					versionListenEl.textContent = `${total} total listen${total === 1 ? '' : 's'}`;
				}
			});
		} else {
			const listenElement = document.getElementById(`listen-count-${songId}`);
			if (listenElement) {
				listenElement.textContent = `${total} total listen${total === 1 ? '' : 's'}`;
			}
		}
		refreshArtListenCount(statKey);
		debouncedSortSongs();
	});
}

// Mark a base song as heard and remove its NEW badge.
export function markSongHeard(baseId) {
	if (state.isAdminMode || heardSongs.has(baseId)) return;
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
export function markVersionHeard(vid, songBaseId, versionIndex) {
	if (state.isAdminMode || heardVersions.has(vid)) return;
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
	const song = state.songsData.find((s) => s.id === songBaseId);
	const versionCount = song?.versions ? song.versions.length : 1;
	const allHeard = Array.from({ length: versionCount }, (_, i) => versionId(song, i))
		.every((v) => heardVersions.has(v));
	if (allHeard) markSongHeard(songBaseId);
}

export function incrementListenCount(songId) {
	if (typeof database === 'undefined') return;
	if (state.isAdminMode) return; // Don't count listens on admin page

	const listensRef = database.ref(`songs/${songId}/listens`);
	listensRef.transaction((currentCount) => (currentCount || 0) + 1);

	// Resolve the base song and mark the specific version as heard
	const baseSong = state.songsData.find((s) =>
		s.id === songId || (s.versions && s.versions.some((_, i) => versionId(s, i) === songId))
	);
	if (baseSong) {
		const vi = baseSong.versions
			? baseSong.versions.findIndex((_, i) => versionId(baseSong, i) === songId)
			: 0;
		markVersionHeard(songId, baseSong.id, vi >= 0 ? vi : 0);
	}
}
