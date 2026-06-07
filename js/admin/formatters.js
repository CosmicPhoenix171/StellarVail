// Display formatters & numeric helpers used across the admin dashboard.
// All pure functions — no DOM, no Firebase.

export function formatNumber(value, digits = 0) {
	const numberValue = Number(value || 0);
	return numberValue.toLocaleString(undefined, {
		maximumFractionDigits: digits,
		minimumFractionDigits: digits > 0 && numberValue % 1 !== 0 ? digits : 0,
	});
}

export function formatPercent(value) {
	return `${formatNumber(value || 0, 1)}%`;
}

export function formatTime(seconds) {
	const totalSeconds = Math.max(0, Math.round(seconds || 0));
	const minutes = Math.floor(totalSeconds / 60);
	const remainingSeconds = totalSeconds % 60;
	return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

export function formatDurationSummary(seconds) {
	const totalSeconds = Math.max(0, Math.round(seconds || 0));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const remainingSeconds = totalSeconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m`;
	if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
	return `${remainingSeconds}s`;
}

export function formatDateTime(timestamp) {
	if (!timestamp) return '-';
	return new Date(timestamp).toLocaleString();
}

export function formatSessionUser(session) {
	if (!session) return 'Unknown listener';
	return session.displayName || session.username || session.clientId || 'Unknown listener';
}

// Attribute-safe HTML escape — escapes single quotes too. The shared
// helpers.js escapeHtml uses textContent which doesn't, and admin templates
// interpolate values into double-quoted attributes where ' is safe but other
// chars must be escaped. Kept local to admin for clarity.
export function escapeHtml(value) {
	return String(value ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

export function averageRating(ratings) {
	const ratingValues = Object.values(ratings || {})
		.map((entry) => {
			if (entry && typeof entry === 'object') return Number(entry.rating);
			return Number(entry);
		})
		.filter((rating) => Number.isFinite(rating) && rating > 0);
	if (!ratingValues.length) return { count: 0, average: 0 };
	const total = ratingValues.reduce((sum, rating) => sum + rating, 0);
	return { count: ratingValues.length, average: total / ratingValues.length };
}

export function topEntries(values, limit = 3) {
	return Object.entries(values || {})
		.sort((first, second) => Number(second[1] || 0) - Number(first[1] || 0))
		.slice(0, limit);
}

export function topListeners(byUser, limit = 3) {
	return Object.values(byUser || {})
		.map((userStats) => ({
			label: userStats.displayName || userStats.username || userStats.clientId || 'Unknown listener',
			sessions: Number(userStats.listenSessions || 0),
		}))
		.filter((entry) => entry.sessions > 0)
		.sort((first, second) => second.sessions - first.sessions || first.label.localeCompare(second.label))
		.slice(0, limit);
}
