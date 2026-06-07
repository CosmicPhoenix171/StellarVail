// Ratings: loading/saving/displaying user and community ratings.
// Includes the rating popup that appears after a track ends.

import { state, listenedEnough } from '../core/state.js';
import { formatTime, escapeHtml } from '../utils/helpers.js';
import { versionId } from './versions.js';
import {
	ensureSongStatsEntry,
	markVersionHeard,
	refreshArtRatingChip,
	refreshBestVersionSummaryStars,
} from './listens.js';
import { syncPreferredVersionSelection } from './versions.js';
import { debouncedSortSongs, applyUnratedFilter } from './sorting.js';
import { renderNowPlayingPanel } from './nowPlaying.js';
import { formatRaterName, isGuest, getDisplayName, showLoginPopup } from './user.js';
import { recordListenConversion } from './analytics.js';
import { resolveSongAndVersion, playNextSong } from './audio.js';
import { showNotListenedPopup } from '../ui/notListenedPopup.js';

export function loadRatingData(songId, songBaseId /* , versionIndex */) {
	if (typeof database === 'undefined') return;
	// songBaseId is used to aggregate sort stats (use the base song id for card sorting)
	const statKey = songBaseId || songId;

	const ratingsRef = database.ref(`songs/${songId}/ratings`);
	ratingsRef.on('value', (snapshot) => {
		const ratings = snapshot.val();
		let sum = 0;
		let count = 0;
		let guestCount = 0;

		function normalizeRatingEntry(userId, entry) {
			if (entry && typeof entry === 'object') {
				const parsedRating = Number(entry.rating);
				return {
					userId,
					rating: Number.isFinite(parsedRating) ? parsedRating : 0,
					timestamp: Number(entry.timestamp || 0),
					displayName: entry.displayName || '',
					username: entry.username || '',
				};
			}

			const parsedRating = Number(entry);
			return {
				userId,
				rating: Number.isFinite(parsedRating) ? parsedRating : 0,
				timestamp: 0,
				displayName: '',
				username: '',
			};
		}

		if (ratings) {
			Object.entries(ratings).forEach(([key, entry]) => {
				const rating = normalizeRatingEntry(key, entry);
				if (key.startsWith('guest_')) {
					guestCount++;
					return; // Skip guests in the score
				}
				if (rating.rating > 0) {
					sum += rating.rating;
					count += 1;
				}
			});
		}

		const average = count > 0 ? (sum / count).toFixed(1) : '0.0';
		const hasVisibleCommunityRating = count >= 2;
		const hasUnratedPlaceholder = count === 0;
		const avgElement = document.getElementById(`avg-rating-${songId}`);
		const countElement = document.getElementById(`rating-count-${songId}`);
		const summaryElement = document.getElementById(`summary-rating-${songId}`);
		const pendingHint = guestCount > 0 ? ` · ${guestCount} pending` : '';
		const currentUserHasRated = !!ratings?.[state.clientId]?.rating;
		const showUserPlaceholder = !currentUserHasRated && !hasVisibleCommunityRating;
		if (summaryElement) {
			summaryElement.classList.toggle('insufficient-ratings', !hasVisibleCommunityRating && !showUserPlaceholder && !hasUnratedPlaceholder);
			summaryElement.classList.toggle('unrated-placeholder', hasUnratedPlaceholder);
			summaryElement.classList.toggle('user-placeholder', showUserPlaceholder);
		}
		if (avgElement) {
			avgElement.textContent = hasUnratedPlaceholder || showUserPlaceholder ? 'Avg -.-' : `Avg ${average}★`;
			avgElement.style.display = hasVisibleCommunityRating || hasUnratedPlaceholder || showUserPlaceholder ? '' : 'none';
		}
		if (countElement) countElement.textContent = `(${count} rating${count === 1 ? '' : 's'}${state.isAdminMode ? pendingHint : ''})`;

		updateStarsDisplay(songId, parseFloat(average));

		// Admin mode: show individual user ratings
		if (state.isAdminMode && ratings) {
			const breakdownList = document.getElementById(`ratings-list-${songId}`);
			if (breakdownList) {
				const entries = Object.entries(ratings)
					.map(([id, data]) => normalizeRatingEntry(id, data))
					.filter((entry) => entry.rating > 0)
					.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

				if (entries.length === 0) {
					breakdownList.innerHTML = '<p class="no-ratings-yet">No ratings yet.</p>';
				} else {
					breakdownList.innerHTML = entries.map((entry) => {
						const name = formatRaterName(entry.userId, entry.displayName, entry.username);
						const isGuestEntry = entry.userId.startsWith('guest_');
						const guestTag = isGuestEntry ? '<span class="guest-tag">pending</span>' : '';
						const stars = '★'.repeat(entry.rating) + '☆'.repeat(5 - entry.rating);
						const timeAgo = entry.timestamp ? formatTime(entry.timestamp) : '';
						const deleteBtn = `<button class="admin-delete-rating" onclick="deleteRating('${songId}', '${entry.userId}')" title="Delete this rating">✕</button>`;
						return `
							<div class="rating-entry ${isGuestEntry ? 'guest-entry' : ''}">
								<span class="rater-name">${escapeHtml(name)}${guestTag}</span>
								<span class="rater-stars" data-rating="${entry.rating}">${stars}</span>
								<span class="rater-time">${timeAgo}</span>
								${deleteBtn}
							</div>
						`;
					}).join('');
				}
			}
		}

		// Track for sorting — aggregate across all versions for card-level sort.
		// Only community ratings with at least two votes count toward rating sort order.
		const statsEntry = ensureSongStatsEntry(statKey);
		statsEntry.userRatedVersions[songId] = state.isAdminMode || currentUserHasRated;
		statsEntry.versionRatings[songId] = hasVisibleCommunityRating ? parseFloat(average) : 0;
		statsEntry.versionSelectionRatings[songId] = count > 0 ? parseFloat(average) : 0;
		statsEntry.rating = Math.max(0, ...Object.values(statsEntry.versionRatings));
		refreshArtRatingChip(statKey);
		refreshBestVersionSummaryStars(statKey);
		syncPreferredVersionSelection(statKey);
		debouncedSortSongs();
	});
}

export function updateStarsDisplay(songId, average) {
	// Only fill stars with the community average after the user has rated this version.
	// Until then the stars stay empty so the average doesn't influence their choice.
	const summaryEl = document.getElementById(`summary-rating-${songId}`);
	const userHasRated = summaryEl && !summaryEl.classList.contains('rating-hidden');
	if (!userHasRated) return;

	// Fill the interactive rating widget
	const starsContainer = document.getElementById(`rating-stars-${songId}`);
	if (starsContainer) {
		starsContainer.querySelectorAll('.star').forEach((star, index) => {
			if (index < Math.round(average)) {
				star.classList.add('filled');
			} else {
				star.classList.remove('filled');
			}
		});
	}

	// Fill the big display summary stars with the community average
	const summaryStars = document.getElementById(`summary-stars-${songId}`);
	if (summaryStars) {
		summaryStars.querySelectorAll('.summary-star').forEach((star, index) => {
			star.classList.toggle('user-rated', index < Math.round(average));
		});
	}
}

export function revealRating(songId) {
	const ratingEl = document.getElementById(`summary-rating-${songId}`);
	if (ratingEl) {
		ratingEl.classList.remove('rating-hidden');
		ratingEl.classList.remove('user-placeholder');
		// Now that the user has rated, fill stars with the community average
		const avgEl = document.getElementById(`avg-rating-${songId}`);
		if (avgEl) updateStarsDisplay(songId, parseFloat(avgEl.textContent.replace(/[^\d.]/g, '')) || 0);
	}
	// If the unrated filter is active, hide this card now that it's been rated
	if (state.filterUnrated) applyUnratedFilter();
}

export function checkUserHasRated(songId) {
	if (typeof database === 'undefined') return;

	const userRatingRef = database.ref(`songs/${songId}/ratings/${state.clientId}`);
	userRatingRef.once('value', (snapshot) => {
		if (snapshot.exists()) {
			revealRating(songId);
			// Show user's current rating on the stars
			const userRating = snapshot.val().rating;
			highlightUserRating(songId, userRating);
			// User already rated — treat as heard, remove version glow (card badge only goes if all versions heard)
			const ratedBase = state.songsData.find((s) =>
				s.id === songId || (s.versions && s.versions.some((_, i) => versionId(s, i) === songId))
			);
			if (ratedBase) {
				const rvi = ratedBase.versions
					? ratedBase.versions.findIndex((_, i) => versionId(ratedBase, i) === songId)
					: 0;
				markVersionHeard(songId, ratedBase.id, rvi >= 0 ? rvi : 0);
			}
		}
	});
}

// Highlight the stars to show user's current rating.
export function highlightUserRating(songId, rating) {
	const starsContainer = document.getElementById(`rating-stars-${songId}`);
	const messageEl = document.getElementById(`rating-message-${songId}`);
	const summaryUserRatingEl = document.getElementById(`summary-user-rating-${songId}`);

	if (starsContainer) {
		const stars = starsContainer.querySelectorAll('.star');
		stars.forEach((star, index) => {
			if (index < rating) {
				star.classList.add('user-rated');
			} else {
				star.classList.remove('user-rated');
			}
		});
	}

	if (summaryUserRatingEl) {
		summaryUserRatingEl.textContent = `Yours ${rating}★`;
	}

	if (messageEl) {
		messageEl.textContent = `Your rating: ${rating}★ (click to change)`;
	}
}

// Check if user already rated a song (for auto-play decision).
export function checkIfUserRatedSong(songId) {
	if (typeof database === 'undefined') return;

	const userRatingRef = database.ref(`songs/${songId}/ratings/${state.clientId}`);
	userRatingRef.once('value', (snapshot) => {
		if (snapshot.exists()) {
			state.currentSongRated = true;
		}
	});
}

export function rateSong(songId, rating) {
	if (typeof database === 'undefined') return;

	// If the user is a guest, prompt them to create a username first
	if (isGuest() && !state.isAdminMode) {
		state.pendingRating = { songId, rating };
		showLoginPopup(true); // true = triggered by rating
		return;
	}

	// Block rating if the user hasn't listened to at least 75% of this version
	if (!listenedEnough.has(songId) && !state.isAdminMode) {
		showNotListenedPopup();
		return;
	}

	const ratingRef = database.ref(`songs/${songId}/ratings/${state.clientId}`);
	ratingRef
		.set({
			rating,
			displayName: getDisplayName(),
			username: localStorage.getItem('sv_username') || null,
			timestamp: Date.now(),
		})
		.then(() => {
			recordListenConversion(songId, 'rating', { rating });
			highlightUserRating(songId, rating);

			const messageEl = document.getElementById(`rating-message-${songId}`);
			if (messageEl) {
				messageEl.textContent = 'Rating updated!';
				setTimeout(() => {
					messageEl.textContent = `Your rating: ${rating}★ (click to change)`;
				}, 1500);
			}
			revealRating(songId);
			if (songId === state.currentSongId) {
				state.currentSongRated = true;
			}
			// Rating counts as having heard the song — remove the NEW badge
			const ratedBaseSong = state.songsData.find((s) =>
				s.id === songId || (s.versions && s.versions.some((_, i) => versionId(s, i) === songId))
			);
			if (ratedBaseSong) {
				const rvi = ratedBaseSong.versions
					? ratedBaseSong.versions.findIndex((_, i) => versionId(ratedBaseSong, i) === songId)
					: 0;
				markVersionHeard(songId, ratedBaseSong.id, rvi >= 0 ? rvi : 0);
				if (state.selectedSongId === ratedBaseSong.id) {
					renderNowPlayingPanel(state.selectedSongId);
				}
			}
		})
		.catch((error) => {
			console.error('Error saving rating:', error);
			const messageEl = document.getElementById(`rating-message-${songId}`);
			if (messageEl) messageEl.textContent = 'Error saving rating';
		});
}

export function toggleRatingsBreakdown(songId) {
	const list = document.getElementById(`ratings-list-${songId}`);
	const toggle = document.getElementById(`ratings-toggle-${songId}`);
	if (!list) return;
	const isCollapsed = list.classList.toggle('collapsed');
	if (toggle) toggle.textContent = isCollapsed ? '▼' : '▲';
}

// Admin: delete a specific rating entry from Firebase.
export function deleteRating(songId, raterUserId) {
	if (!state.isAdminMode || typeof database === 'undefined') return;
	if (!confirm(`Delete rating from ${formatRaterName(raterUserId)}?`)) return;

	database.ref(`songs/${songId}/ratings/${raterUserId}`).remove()
		.then(() => console.log(`Deleted rating ${raterUserId} from ${songId}`))
		.catch((err) => console.error('Error deleting rating:', err));
}

// Admin: purge ALL guest ratings across every song.
export function purgeAllGuestRatings() {
	if (!state.isAdminMode || typeof database === 'undefined') return;
	if (!confirm('Delete ALL guest ratings across every song? This cannot be undone.')) return;

	const songsRef = database.ref('songs');
	songsRef.once('value', (snapshot) => {
		const songs = snapshot.val();
		if (!songs) return;

		const updates = {};
		let count = 0;

		Object.keys(songs).forEach((songId) => {
			const song = songs[songId];
			if (song.ratings) {
				Object.keys(song.ratings).forEach((raterId) => {
					if (raterId.startsWith('guest_')) {
						updates[`songs/${songId}/ratings/${raterId}`] = null;
						count++;
					}
				});
			}
		});

		if (count === 0) {
			alert('No guest ratings found.');
			return;
		}

		database.ref().update(updates)
			.then(() => alert(`Purged ${count} guest rating(s).`))
			.catch((err) => console.error('Error purging guest ratings:', err));
	});
}

// ===== RATING POPUP =====
export function showRatingPopup() {
	const popup = document.getElementById('rating-popup');
	const songTitle = document.getElementById('rating-popup-song-title');
	const starsContainer = document.getElementById('rating-popup-stars');

	if (!popup || !state.currentSongId) return;

	// Get current song title (currentSongId may be a versionId)
	const resolved = resolveSongAndVersion(state.currentSongId);
	if (songTitle && resolved) {
		const { song, vi } = resolved;
		const vLabel = song.versions?.[vi]?.label;
		songTitle.textContent = vLabel ? `${song.title} — ${vLabel}` : song.title;
	}

	// Reset stars
	const stars = starsContainer.querySelectorAll('.popup-star');
	stars.forEach((star) => {
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
			stars.forEach((s) => s.classList.remove('hovered'));
		};
		star.onclick = () => {
			const rating = parseInt(star.dataset.rating);
			rateSong(state.currentSongId, rating);
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

export function hideRatingPopup() {
	const popup = document.getElementById('rating-popup');
	if (popup) {
		popup.style.display = 'none';
	}
}
