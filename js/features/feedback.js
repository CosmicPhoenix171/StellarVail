// Feedback / comments: loading from Firebase, the comment popup, and the
// per-version comment list rendering.

import { state } from '../core/state.js';
import { audioPlayer } from '../core/dom.js';
import { formatTime, formatSongTime, escapeHtml } from '../utils/helpers.js';
import { recordListenConversion } from './analytics.js';
import { playSong } from './audio.js';

export function loadFeedback(songId) {
	if (typeof database === 'undefined') return;

	const feedbackRef = database.ref(`songs/${songId}/feedback`);
	feedbackRef.on('value', (snapshot) => {
		const feedbackList = document.getElementById(`feedback-list-${songId}`);
		const commentCountEl = document.getElementById(`comment-count-${songId}`);

		const feedbacks = snapshot.val();
		const commentCount = feedbacks ? Object.keys(feedbacks).length : 0;

		// Track in songStats for sorting
		if (!state.songStats[songId]) state.songStats[songId] = { rating: 0, listens: 0 };
		state.songStats[songId].comments = commentCount;

		// Update comment count in card header
		if (commentCountEl) {
			const numberEl = commentCountEl.querySelector('.comment-number');
			if (numberEl) {
				numberEl.textContent = commentCount;
			}
		}

		// Update hint text
		const hintEl = document.getElementById(`feedback-hint-${songId}`);
		if (hintEl) {
			hintEl.textContent = commentCount > 0
				? `${commentCount} comment${commentCount === 1 ? '' : 's'}`
				: 'No comments yet. Be the first to leave feedback.';
		}

		if (!feedbackList) return;

		if (!feedbacks) {
			feedbackList.innerHTML = '<p class="no-feedback">No comments yet. Be the first!</p>';
			return;
		}

		const feedbackArray = Object.entries(feedbacks)
			.map(([key, value]) => ({ id: key, ...value }))
			.sort((a, b) => b.timestamp - a.timestamp);

		feedbackList.innerHTML = feedbackArray
			.map((fb) => {
				const timestampBadge =
					fb.songTimestamp !== undefined
						? `<span class="timestamp-badge" onclick="seekToTime('${songId}', ${fb.songTimestamp})" title="Jump to ${formatSongTime(fb.songTimestamp)}">⏱️ ${formatSongTime(fb.songTimestamp)}</span>`
						: '';

				const isMine = fb.clientId === state.clientId;
				const encodedComment = encodeURIComponent(fb.comment || '');
				const encodedName = encodeURIComponent(fb.displayName || 'Anonymous');
				const timestampAttr = fb.songTimestamp !== undefined ? `data-song-timestamp="${fb.songTimestamp}"` : '';
				const editBtn = isMine
					? `<button class="edit-feedback-btn" data-comment="${encodedComment}" data-name="${encodedName}" ${timestampAttr} onclick="prefillFeedback('${songId}', this)">✏️ Edit</button>`
					: '';

				const youTag = isMine ? '<span class="you-pill">You</span>' : '';

				return `
					<div class="feedback-item">
						<div class="feedback-header">
							<span class="feedback-author">${fb.displayName || 'Anonymous'}</span>${youTag}
							${timestampBadge}
							<span class="feedback-time">${formatTime(fb.timestamp)}</span>
							${editBtn}
						</div>
						<p class="feedback-text">${escapeHtml(fb.comment)}</p>
					</div>
				`;
			})
			.join('');
	});
}

// ===== COMMENT POPUP =====
export function openCommentPopup(vid) {
	state.commentPopupVid = vid;
	const popup = document.getElementById('comment-popup');
	const titleEl = document.getElementById('comment-popup-song-title');
	const textarea = document.getElementById('comment-popup-text');
	const tsInput = document.getElementById('comment-popup-timestamp');
	if (!popup) return;
	if (titleEl) titleEl.textContent = '';
	if (textarea) textarea.value = '';
	if (tsInput) tsInput.value = '';
	popup.style.display = 'flex';
	if (textarea) textarea.focus();
}

export function closeCommentPopup() {
	const popup = document.getElementById('comment-popup');
	if (popup) popup.style.display = 'none';
	state.commentPopupVid = null;
}

export function addTimestampPopup() {
	if (!audioPlayer.src || audioPlayer.paused) {
		alert('Please play the song first to add a timestamp');
		return;
	}
	const currentTime = audioPlayer.currentTime;
	const tsInput = document.getElementById('comment-popup-timestamp');
	const textarea = document.getElementById('comment-popup-text');
	if (tsInput) tsInput.value = currentTime.toFixed(2);
	if (textarea) {
		const timeStr = formatSongTime(currentTime);
		const prefix = textarea.value ? ' ' : '';
		textarea.value += `${prefix}[${timeStr}]`;
		textarea.focus();
	}
}

export function submitFeedbackPopup() {
	if (!state.commentPopupVid) return;
	const songId = state.commentPopupVid;
	const textarea = document.getElementById('comment-popup-text');
	const tsInput = document.getElementById('comment-popup-timestamp');
	const comment = textarea ? textarea.value.trim() : '';
	if (!comment) { alert('Please enter a comment'); return; }
	const displayName = localStorage.getItem('sv_username') || 'Anonymous';
	const songTimestamp = tsInput && tsInput.value ? parseFloat(tsInput.value) : undefined;
	if (typeof database === 'undefined') return;
	const feedbackRef = database.ref(`songs/${songId}/feedback/${state.clientId}`);
	const payload = { displayName, comment, clientId: state.clientId, timestamp: Date.now() };
	if (typeof songTimestamp === 'number' && !Number.isNaN(songTimestamp)) payload.songTimestamp = songTimestamp;
	feedbackRef.set(payload)
		.then(() => {
			recordListenConversion(songId, 'comment', {
				hasSongTimestamp: typeof songTimestamp === 'number' && !Number.isNaN(songTimestamp),
				songTimestamp: typeof songTimestamp === 'number' && !Number.isNaN(songTimestamp) ? songTimestamp : null,
			});
			closeCommentPopup();
		})
		.catch((error) => { console.error('Error saving feedback:', error); alert('Error posting comment. Please try again.'); });
}

export function toggleFeedback(songId) {
	const section = document.getElementById(`feedback-section-${songId}`);
	const body = document.getElementById(`feedback-body-${songId}`);
	const toggleBtn = section ? section.querySelector('.feedback-toggle') : null;
	if (!section || !body) return;

	const collapsed = section.classList.toggle('collapsed');
	body.style.display = collapsed ? 'none' : 'flex';
	if (toggleBtn) {
		toggleBtn.textContent = collapsed ? '▼' : '▲';
	}
}

// Prefill the edit form with an existing comment. The inline feedback form
// fields no longer exist in the card markup (the popup is used instead), so
// this is a best-effort fallback that only acts if the fields are present.
export function prefillFeedback(songId, buttonEl) {
	if (!buttonEl) return;
	const comment = decodeURIComponent(buttonEl.getAttribute('data-comment') || '');
	const tsAttr = buttonEl.getAttribute('data-song-timestamp');
	const songTimestamp = tsAttr ? parseFloat(tsAttr) : '';

	const textInput = document.getElementById(`feedback-text-${songId}`);
	const timestampInput = document.getElementById(`feedback-timestamp-${songId}`);

	if (textInput) {
		textInput.value = comment || '';
		textInput.focus();
		textInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}
	if (timestampInput) {
		timestampInput.value = songTimestamp !== '' && !Number.isNaN(songTimestamp) ? songTimestamp : '';
	}
}

export function seekToTime(songId, seconds) {
	const song = state.songsData.find((s) => s.id === songId);
	if (!song) return;

	if (state.currentSongId !== songId) {
		playSong(songId);
	}

	setTimeout(() => {
		audioPlayer.currentTime = seconds;
		audioPlayer.play().catch(() => {});
	}, 200);
}
