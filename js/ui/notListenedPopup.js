// "You haven't finished the song yet" popup, shown when a user tries to
// rate before reaching the 75% listen threshold.

export function showNotListenedPopup() {
	const popup = document.getElementById('not-listened-popup');
	if (!popup) return;
	popup.style.display = 'flex';
	// Auto-dismiss after 3 seconds
	clearTimeout(showNotListenedPopup._timer);
	showNotListenedPopup._timer = setTimeout(() => {
		popup.style.display = 'none';
	}, 3000);
}
