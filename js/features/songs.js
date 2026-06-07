// Song catalogue loading + card rendering.

import { state, selectedVersions, heardSongs, heardVersions } from '../core/state.js';
import { songsContainer } from '../core/dom.js';
import { basePath, legacyIdMap } from '../config/constants.js';
import { formatDate } from '../utils/helpers.js';
import { defaultVersionIndex, versionId } from './versions.js';
import { selectSong, moveCardToPlayer } from './nowPlaying.js';
import { resolveSongAndVersion } from './audio.js';
import { loadRatingData, checkUserHasRated } from './ratings.js';
import { loadListenCount } from './listens.js';
import { loadFeedback } from './feedback.js';
import { sortSongCards } from './sorting.js';
import { openSharedTrackFromUrl } from './share.js';

export async function loadSongs() {
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
					// IMPORTANT: only strip .wav — mp3/ogg/m4a songs already have their
					// Firebase data stored under IDs that include the extension fused in
					// (e.g. "fairytalemp3", "sugar-sweet-v3mp3"). Stripping all audio
					// extensions would orphan every rating/comment for those songs.
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
						shareSlug: info.shareSlug || '',
						description: info.description || '',
						versions: info.versions || null,
						art: info.art ? `${basePath}music/${folder}/${info.art}` : null,
					};
				} catch (err) {
					console.warn(`Could not load info.json for folder "${folder}":`, err);
					return null;
				}
			})
		);

		state.songsData = results.filter(Boolean);
		renderSongs();
	} catch (error) {
		console.error('Error loading songs:', error);
		if (songsContainer) {
			songsContainer.innerHTML = '<p style="color: white;">Error loading songs. Please check music/index.json.</p>';
		}
	}
}

export function renderSongs() {
	if (!songsContainer) return;
	songsContainer.innerHTML = '';

	state.songsData.forEach((song) => {
		if (!Number.isInteger(selectedVersions[song.id])) {
			selectedVersions[song.id] = defaultVersionIndex(song);
		}
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

	const playingBaseSongId = resolveSongAndVersion(state.currentSongId)?.song?.id;
	const defaultSongId = playingBaseSongId || state.selectedSongId || songsContainer.querySelector('.song-card')?.dataset.songId;
	if (defaultSongId) {
		selectSong(defaultSongId, { scroll: false });
	}
	if (playingBaseSongId) {
		moveCardToPlayer(playingBaseSongId);
	}
	if (!playingBaseSongId) {
		openSharedTrackFromUrl();
	}
}

export function createSongCard(song) {
	const card = document.createElement('div');
	const isNew = !heardSongs.has(song.id) && !state.isAdminMode;
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
	const ratingHiddenClass = state.isAdminMode ? '' : 'rating-hidden';

	// Format date for display
	const dateAdded = song.dateAdded ? formatDate(song.dateAdded) : 'Unknown date';

	// Build version tabs HTML — always shown; single-version songs get an "Original" tab
	const hasVersions = song.versions && song.versions.length > 1;
	const tabVersions = song.versions || [{ filename: song.filename, label: 'Original' }];
	const defaultIndex = selectedVersions[song.id] ?? defaultVersionIndex(song);
	const versionTabsHtml = `
		<div class="version-tabs" id="version-tabs-${song.id}">
			${tabVersions.map((v, i) => {
				const vid = versionId(song, i);
				const isUnheard = !heardVersions.has(vid) && !state.isAdminMode;
				return `
				<button class="version-tab${i === defaultIndex ? ' active' : ''}${isUnheard ? ' version-new' : ''}"
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
		<div class="version-panel${i === defaultIndex ? ' active' : ''}" id="version-panel-${song.id}-${i}">
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
			<div class="version-action-row">
				<div class="play-button-wrap" onclick="togglePlaySong('${song.id}', ${i})">
					<button class="play-button version-play-btn${!heardVersions.has(vid) && !state.isAdminMode ? ' version-new' : ''}" onclick="event.stopPropagation(); togglePlaySong('${song.id}', ${i})" data-song-id="${song.id}" data-version-index="${i}">
						▶ Play${hasVersions ? ' ' + v.label : ''}
					</button>
				</div>
				<button class="share-button" type="button" onclick="copySongLink('${song.id}', ${i}, event)" title="Copy link to this ${hasVersions ? 'version' : 'song'}">
					Share
				</button>
			</div>
			<div class="detail-section" id="detail-section-${vid}">
				${i === defaultIndex ? detailHeaderHtml : ''}
				${state.isAdminMode ? '' : `<div class="rating-section">
					<h4 class="np-section-heading">⭐ Ratings</h4>
					<div class="rating-stars" id="rating-stars-${vid}">
						${[1, 2, 3, 4, 5].map((n) => '<span class="star" data-rating="' + n + '" onclick="rateSong(\'' + vid + '\', ' + n + ')">★</span>').join('')}
					</div>
					<p class="rating-message" id="rating-message-${vid}">Click stars to rate</p>
				</div>`}
				${state.isAdminMode ? `<div class="ratings-breakdown" id="ratings-breakdown-${vid}">
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

	const newBadgeHtml = (!heardSongs.has(song.id) && !state.isAdminMode)
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
