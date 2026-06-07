// Admin page entry point — initializes Firebase, wires up DOMContentLoaded
// handlers for the page's buttons, and shows the appropriate locked /
// dashboard view based on the admin sign-in state.

import '../core/firebase.js';
import { loadAdminDashboard, showAdminState, goToNormalMode } from './render.js';
import { migrateAlternateData } from './migration.js';

document.addEventListener('DOMContentLoaded', () => {
	document.getElementById('normal-mode-btn')?.addEventListener('click', goToNormalMode);
	document.getElementById('locked-normal-btn')?.addEventListener('click', goToNormalMode);
	document.getElementById('admin-refresh-btn')?.addEventListener('click', loadAdminDashboard);
	document.getElementById('admin-migrate-btn')?.addEventListener('click', migrateAlternateData);
	showAdminState();
});
