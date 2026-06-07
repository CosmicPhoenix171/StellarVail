// Versions: identifying, selecting, and switching between alternate
// renderings of a song.

import { state, selectedVersions, versionSelectionLocked } from '../core/state.js';
import { audioPlayer } from '../core/dom.js';
import { basePath } from '../config/constants.js';
import { ensureSongStatsEntry, refreshArtListenCount } from './listens.js';
import { selectSong, moveCardToPlayer } from './nowPlaying.js';
import { savePlaybackAnalytics } from './analytics.js';

export function defaultVersionIndex(song) {
	if (!song?.versions?.length) return 0;
	const statsEntry = ensureSongStatsEntry(song.id);
	for (let index = song.versions.length - 1; index >= 0; index -= 1) {
		const vid = versionId(song, index);
		if (!statsEntry.userRatedVersions[vid]) {
			return index;
		}
	}

	let bestIndex = song.versions.length - 1;
	let bestAverage = Number.NEGATIVE_INFINITY;
	for (let index = song.versions.length - 1; index >= 0; index -= 1) {
		const vid = versionId(song, index);
		const average = Number(statsEntry.versionSelectionRatings[vid] || 0);
		if (average > bestAverage) {
			bestAverage = average;
			bestIndex = index;
		}
	}

	return bestIndex;
}

export function syncPreferredVersionSelection(songBaseId) {
	const song = state.songsData.find((entry) => entry.id === songBaseId);
	if (!song?.versions?.length || song.versions.length <= 1 || versionSelectionLocked[songBaseId]) return;

	const preferredIndex = defaultVersionIndex(song);
	if (selectedVersions[songBaseId] === preferredIndex) return;
	selectedVersions[songBaseId] = preferredIndex;

	const tabs = document.querySelectorAll(`#version-tabs-${songBaseId} .version-tab`);
	if (!tabs.length) return;
	selectVersion(songBaseId, preferredIndex, { auto: true, syncPlayer: false });
}

// Returns the Firebase ID for a given song + version index.
export function versionId(song, versionIndex) {
	const vi = versionIndex ?? (selectedVersions[song.id] ?? defaultVersionIndex(song));
	if (!song.versions || song.versions.length <= 1 || vi === 0) return song.id;
	const label = song.versions[vi].label.toLowerCase().replace(/[^a-z0-9]/g, '');
	return `${song.id}-${label}`;
}

// Returns the audio filename for a given song + version index.
export function versionFilename(song, versionIndex) {
	const vi = versionIndex ?? (selectedVersions[song.id] ?? defaultVersionIndex(song));
	if (song.versions && song.versions[vi]) return song.versions[vi].filename;
	return song.filename;
}

// Switch which version is shown/highlighted on a card.
export function selectVersion(songBaseId, index, options = {}) {
	const { auto = false, syncPlayer = true } = options;
	if (!auto) versionSelectionLocked[songBaseId] = true;
	selectedVersions[songBaseId] = index;

	// Update tab active state
	const tabs = document.querySelectorAll(`#version-tabs-${songBaseId} .version-tab`);
	tabs.forEach((t, i) => t.classList.toggle('active', i === index));

	// Show only the selected version panel
	const song = state.songsData.find((s) => s.id === songBaseId);
	if (!song || !song.versions) return;
	song.versions.forEach((_, i) => {
		const panel = document.getElementById(`version-panel-${songBaseId}-${i}`);
		if (panel) panel.classList.toggle('active', i === index);
	});

	refreshArtListenCount(songBaseId);

	selectSong(songBaseId, { scroll: false });

	// If any version of this song is currently playing, switch audio to the selected version
	const isPlayingThisSong = syncPlayer && (song.versions
		? song.versions.some((_, i) => versionId(song, i) === state.currentSongId)
		: state.currentSongId === song.id);
	if (isPlayingThisSong) {
		const nextVersionId = versionId(song, index);
		if (state.currentSongId !== nextVersionId) {
			savePlaybackAnalytics('switch-version', true);
		}
		const filename = versionFilename(song, index);
		const folder = song.folder || song.filename.replace(/\.[^.]+$/i, '');
		const wasPaused = audioPlayer.paused;
		audioPlayer.src = `${basePath}music/${folder}/${filename}`;
		if (!wasPaused) audioPlayer.play().catch(() => {});
		state.currentSongId = nextVersionId;

		// Move the playing icon to the newly-selected tab
		document.querySelectorAll('.version-tab').forEach((t) => t.classList.remove('tab-playing'));
		const newPlayingTab = document.querySelector(`button.version-tab[data-song-id="${songBaseId}"][data-version-index="${index}"]`);
		if (newPlayingTab) newPlayingTab.classList.add('tab-playing');
		moveCardToPlayer(songBaseId);
	}
}
