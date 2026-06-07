// "Hide UI" mode, admin mode button, and admin link.

import { state } from '../core/state.js';

export function disableAuroraEffects() {
	if (!state.auroraDisabled) {
		state.auroraDisabled = true;
		localStorage.setItem('sv_disable_aurora', '1');
	}
	document.body.classList.add('aurora-disabled');
}

export function toggleHideUI() {
	state.uiHidden = !state.uiHidden;
	document.body.classList.toggle('hide-ui-mode', state.uiHidden);
}

export function openAdminMode() {
	if (!state.isAdminMode) return;
	window.location.href = 'admin.html';
}

export function updateAdminModeButton() {
	const adminModeButton = document.getElementById('admin-mode-btn');
	if (!adminModeButton) return;
	adminModeButton.hidden = !state.isAdminMode;
}

export function showUI() {
	if (state.uiHidden) {
		state.uiHidden = false;
		document.body.classList.remove('hide-ui-mode');
	}
}
