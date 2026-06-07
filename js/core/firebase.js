// Firebase initialization. Loaded once on the module entry point of every
// page. Relies on the Firebase compat SDK being available on `window`
// (loaded via plain <script> tags in HTML before the module entry).
//
// Side effect on import: initializes the Firebase app and assigns
// `window.database` so the existing `typeof database === 'undefined'`
// guards inside feature modules continue to resolve at runtime.

const firebaseConfig = {
	apiKey: 'AIzaSyCx5L9o7rmdM2TzgjMEKjOGAXeUarAI_ew',
	authDomain: 'stellarvail.firebaseapp.com',
	databaseURL: 'https://stellarvail-default-rtdb.firebaseio.com',
	projectId: 'stellarvail',
	storageBucket: 'stellarvail.firebasestorage.app',
	messagingSenderId: '963564296876',
	appId: '1:963564296876:web:e333c37414e59e069b1d09',
	measurementId: 'G-RRXCY736RH',
};

if (typeof firebase === 'undefined') {
	console.error('[Firebase] compat SDK not loaded — make sure the firebase-*-compat.js script tags appear before the module entry.');
}

if (!firebase.apps.length) {
	firebase.initializeApp(firebaseConfig);
	if (firebase.database) {
		// Verbose Realtime Database logging — comment out if too noisy.
		firebase.database.enableLogging(true);
	}
	console.log('[Firebase] Initialized app:', firebase.app().name);
}

export const database = firebase.database();

// Expose globally so existing `typeof database === 'undefined'` checks in
// feature modules (which don't currently import the binding) keep working.
window.database = database;
