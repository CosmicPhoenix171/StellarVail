// User identity & login flow.
// Manages clientId, admin detection, login/logout popup, and guest→user data
// transfer in Firebase.

import { state } from '../core/state.js';
import { ADMIN_USERNAMES } from '../config/constants.js';
import { rateSong } from './ratings.js';
import { renderSongs } from './songs.js';
import { updateAdminModeButton } from '../ui/hideUi.js';

export function checkAdminMode() {
	const username = localStorage.getItem('sv_username');
	return ADMIN_USERNAMES.includes(username);
}

export function isGuest() {
	return !localStorage.getItem('sv_username');
}

export function sanitizeUsername(name) {
	// Remove special characters that Firebase doesn't allow in paths
	return name.toLowerCase().replace(/[.#$\[\]\/\\'"]/g, '').replace(/\s+/g, '_').slice(0, 20);
}

export function getDisplayName() {
	const username = localStorage.getItem('sv_username');
	return username || 'Guest';
}

// Persist a client-scoped identifier so guests can update their own rating.
export function getClientId() {
	const key = 'sv_client_id';
	const usernameKey = 'sv_username';

	// Check if user has a username set
	const username = localStorage.getItem(usernameKey);
	if (username) {
		return `user_${sanitizeUsername(username)}`;
	}

	// Otherwise use guest ID
	const existing = localStorage.getItem(key);
	if (existing) return existing;
	const newId = `guest_${Math.random().toString(36).slice(2, 10)}`;
	localStorage.setItem(key, newId);
	return newId;
}

// Format a Firebase rating key into a readable display name.
export function formatRaterName(userId, displayName = '', username = '') {
	if (displayName) return displayName;
	if (username) return username;
	if (userId.startsWith('user_')) {
		return userId.slice(5).replace(/_/g, ' ');
	}
	if (userId.startsWith('guest_')) {
		return 'Guest ' + userId.slice(6, 10);
	}
	return userId;
}

export function updateUserDisplay() {
	const displayEl = document.getElementById('user-name-display');
	updateAdminModeButton();
	if (displayEl) {
		const name = getDisplayName();
		displayEl.textContent = state.isAdminMode ? `${name} ★` : name;

		// Update status dot color
		const statusDot = displayEl.previousElementSibling;
		if (statusDot && statusDot.classList.contains('status-dot')) {
			if (state.isAdminMode) {
				statusDot.style.background = '#ff00ff';
				statusDot.style.boxShadow = '0 0 8px #ff00ff';
			} else if (name !== 'Guest') {
				statusDot.style.background = '#00ff88';
				statusDot.style.boxShadow = '0 0 8px #00ff88';
			} else {
				statusDot.style.background = '';
				statusDot.style.boxShadow = '';
			}
		}
	}
}

export function showLoginPopup(fromRating) {
	const popup = document.getElementById('login-popup');
	const usernameInput = document.getElementById('login-username');
	const logoutBtn = document.getElementById('logout-btn');
	const statusEl = document.getElementById('login-status');
	const hintEl = popup ? popup.querySelector('.login-hint') : null;

	if (!popup) return;

	// Update hint text based on context
	if (hintEl) {
		hintEl.textContent = fromRating
			? 'Create a username to rate songs and save your ratings!'
			: 'Enter a username to sync your ratings across devices';
	}

	// Check if already signed in
	const currentUsername = localStorage.getItem('sv_username');
	if (currentUsername) {
		usernameInput.value = currentUsername;
		logoutBtn.style.display = 'inline-block';
		statusEl.textContent = `Signed in as ${currentUsername}`;
		statusEl.classList.remove('error');
	} else {
		usernameInput.value = '';
		logoutBtn.style.display = 'none';
		statusEl.textContent = '';
	}

	popup.style.display = 'flex';
	usernameInput.focus();

	// Setup event handlers
	const submitBtn = document.getElementById('login-submit-btn');
	const cancelBtn = document.getElementById('login-cancel-btn');

	submitBtn.onclick = () => handleLogin();
	cancelBtn.onclick = () => hideLoginPopup();
	logoutBtn.onclick = () => handleLogout();

	usernameInput.onkeydown = (e) => {
		if (e.key === 'Enter') handleLogin();
		if (e.key === 'Escape') hideLoginPopup();
	};
}

export function hideLoginPopup() {
	const popup = document.getElementById('login-popup');
	if (popup) {
		popup.style.display = 'none';
	}
	// Clear any pending rating if user cancelled
	state.pendingRating = null;
}

export function handleLogin() {
	const usernameInput = document.getElementById('login-username');
	const statusEl = document.getElementById('login-status');

	const username = usernameInput.value.trim();

	if (!username) {
		statusEl.textContent = 'Please enter a username';
		statusEl.classList.add('error');
		return;
	}

	if (username.length < 2) {
		statusEl.textContent = 'Username must be at least 2 characters';
		statusEl.classList.add('error');
		return;
	}

	// Get the old guest ID before switching
	const oldGuestId = localStorage.getItem('sv_client_id');
	const newUserId = `user_${sanitizeUsername(username)}`;

	// Save username and update clientId
	localStorage.setItem('sv_username', username);
	state.clientId = getClientId(); // Refresh clientId with new username
	const wasAdmin = state.isAdminMode;
	state.isAdminMode = checkAdminMode();

	statusEl.textContent = 'Signing in...';
	statusEl.classList.remove('error');

	const finishLogin = () => {
		statusEl.textContent = `Signed in as ${username}${state.isAdminMode ? ' (Admin)' : ''}!`;
		updateUserDisplay();
		if (state.isAdminMode !== wasAdmin && state.songsData.length) renderSongs();
		applyPendingRating();
		setTimeout(() => hideLoginPopup(), 1000);
	};

	// Transfer guest ratings to the new user account
	if (oldGuestId && typeof database !== 'undefined') {
		transferGuestRatings(oldGuestId, newUserId, finishLogin);
	} else {
		finishLogin();
	}
}

// Apply a rating that was deferred while the user was still a guest.
export function applyPendingRating() {
	if (!state.pendingRating) return;
	const { songId, rating } = state.pendingRating;
	state.pendingRating = null;
	rateSong(songId, rating);
}

// Transfer ratings & feedback from guest account to user account, then delete old guest data.
export function transferGuestRatings(oldGuestId, newUserId, callback) {
	const songsRef = database.ref('songs');

	songsRef.once('value', (snapshot) => {
		const songs = snapshot.val();
		if (!songs) {
			callback();
			return;
		}

		const updates = {};
		let transferCount = 0;

		// Look through all songs for ratings and feedback from the old guest ID
		Object.keys(songs).forEach((songId) => {
			const song = songs[songId];

			// Transfer ratings
			if (song.ratings && song.ratings[oldGuestId]) {
				if (!song.ratings[newUserId]) {
					updates[`songs/${songId}/ratings/${newUserId}`] = song.ratings[oldGuestId];
					transferCount++;
				}
				updates[`songs/${songId}/ratings/${oldGuestId}`] = null;
			}

			// Transfer feedback / comments
			if (song.feedback && song.feedback[oldGuestId]) {
				if (!song.feedback[newUserId]) {
					const fb = { ...song.feedback[oldGuestId] };
					fb.clientId = newUserId;
					if (!fb.displayName || fb.displayName === 'Anonymous' || fb.displayName.startsWith('Guest')) {
						fb.displayName = localStorage.getItem('sv_username') || fb.displayName;
					}
					updates[`songs/${songId}/feedback/${newUserId}`] = fb;
				}
				updates[`songs/${songId}/feedback/${oldGuestId}`] = null;
			}
		});

		if (Object.keys(updates).length > 0) {
			database.ref().update(updates)
				.then(() => {
					console.log(`Transferred ${transferCount} ratings to new account and cleaned up guest data`);
					callback();
				})
				.catch((err) => {
					console.error('Error transferring guest data:', err);
					callback();
				});
		} else {
			callback();
		}
	});
}

export function handleLogout() {
	const wasAdmin = state.isAdminMode;
	localStorage.removeItem('sv_username');
	state.clientId = getClientId(); // Refresh to guest ID
	state.isAdminMode = checkAdminMode();

	const statusEl = document.getElementById('login-status');
	const logoutBtn = document.getElementById('logout-btn');
	const usernameInput = document.getElementById('login-username');

	statusEl.textContent = 'Signed out';
	statusEl.classList.remove('error');
	logoutBtn.style.display = 'none';
	usernameInput.value = '';

	updateUserDisplay();
	if (state.isAdminMode !== wasAdmin && state.songsData.length) renderSongs();

	setTimeout(() => {
		hideLoginPopup();
	}, 1000);
}
