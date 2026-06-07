// "Pull Old Data" migration tool. Pulls ratings, comments, listens, and
// analytics from historical Firebase IDs (produced before/after the
// extension-stripping bug, or under legacy songN keys) into the canonical IDs
// the app currently uses. Safe to re-run: ratings merge by newest timestamp,
// feedback merges by ID (canonical wins on conflict), listens are summed
// once per source, and an `_migratedTo` flag prevents double-counting.

import {
	loadSongsForAdmin,
	versionId,
	getSongVersionSourceIds,
} from './data.js';
import { isAdminSignedIn, loadAdminDashboard } from './render.js';

async function mergeRatings(sourceData, canonicalId) {
	if (!sourceData?.ratings) return 0;
	let merged = 0;
	for (const [userId, entry] of Object.entries(sourceData.ratings)) {
		const canonRef = database.ref(`songs/${canonicalId}/ratings/${userId}`);
		const canonSnap = await canonRef.once('value');
		const existing = canonSnap.val();
		const existingTs = (existing && typeof existing === 'object') ? Number(existing.timestamp || 0) : 0;
		const sourceTs = (entry && typeof entry === 'object') ? Number(entry.timestamp || 0) : 0;
		if (!existing || sourceTs > existingTs) {
			await canonRef.set(entry);
			merged += 1;
		}
	}
	return merged;
}

async function mergeFeedback(sourceData, canonicalId) {
	if (!sourceData?.feedback) return 0;
	let merged = 0;
	for (const [feedbackId, entry] of Object.entries(sourceData.feedback)) {
		const canonRef = database.ref(`songs/${canonicalId}/feedback/${feedbackId}`);
		const canonSnap = await canonRef.once('value');
		if (!canonSnap.exists()) {
			await canonRef.set(entry);
			merged += 1;
		}
	}
	return merged;
}

async function mergeListens(sourceData, sourceId, canonicalId) {
	const sourceListens = Number(sourceData?.listens || 0);
	if (sourceListens <= 0) return 0;
	const canonRef = database.ref(`songs/${canonicalId}/listens`);
	await canonRef.transaction((current) => (current || 0) + sourceListens);
	return sourceListens;
}

async function mergeAnalytics(sourceData, canonicalId) {
	if (!sourceData?.analytics) return false;
	const canonRef = database.ref(`songs/${canonicalId}/analytics`);
	const canonSnap = await canonRef.once('value');
	if (canonSnap.exists()) return false; // do not clobber live analytics
	await canonRef.set(sourceData.analytics);
	return true;
}

async function migrateSourceToCanonical(sourceId, canonicalId) {
	const snap = await database.ref(`songs/${sourceId}`).once('value');
	const sourceData = snap.val();
	if (!sourceData) return null;
	if (sourceData._migratedTo?.canonicalId === canonicalId) return null; // already done

	const ratingsMerged = await mergeRatings(sourceData, canonicalId);
	const feedbackMerged = await mergeFeedback(sourceData, canonicalId);
	const listensMerged = await mergeListens(sourceData, sourceId, canonicalId);
	const analyticsCopied = await mergeAnalytics(sourceData, canonicalId);

	await database.ref(`songs/${sourceId}/_migratedTo`).set({
		canonicalId,
		migratedAt: Date.now(),
	});

	return {
		sourceId,
		canonicalId,
		ratingsMerged,
		feedbackMerged,
		listensMerged,
		analyticsCopied,
	};
}

export async function migrateAlternateData() {
	if (!isAdminSignedIn()) {
		alert('Sign in as an admin to run the migration.');
		return;
	}
	const confirmed = confirm(
		'Pull ratings, comments, listens, and analytics from old Firebase IDs into the current IDs?\n\n'
		+ 'This writes to the database. Safe to re-run.'
	);
	if (!confirmed) return;

	const migrateButton = document.getElementById('admin-migrate-btn');
	const updatedAtElement = document.getElementById('admin-updated-at');
	if (migrateButton) {
		migrateButton.disabled = true;
		migrateButton.textContent = 'Migrating...';
	}
	if (updatedAtElement) updatedAtElement.textContent = 'Migrating old data...';

	try {
		const songs = await loadSongsForAdmin();
		const results = [];
		for (const song of songs) {
			const versionCount = song.versions ? song.versions.length : 1;
			for (let versionIndex = 0; versionIndex < versionCount; versionIndex += 1) {
				const canonical = versionId(song, versionIndex);
				const sourceIds = getSongVersionSourceIds(song, versionIndex).filter((id) => id !== canonical);
				for (const sourceId of sourceIds) {
					const result = await migrateSourceToCanonical(sourceId, canonical);
					if (result) results.push(result);
				}
			}
		}

		const totals = results.reduce((acc, row) => {
			acc.ratings += row.ratingsMerged;
			acc.feedback += row.feedbackMerged;
			acc.listens += row.listensMerged;
			acc.analytics += row.analyticsCopied ? 1 : 0;
			acc.sources += 1;
			return acc;
		}, { ratings: 0, feedback: 0, listens: 0, analytics: 0, sources: 0 });

		console.table(results);
		alert(
			'Migration complete.\n\n'
			+ `Old paths merged: ${totals.sources}\n`
			+ `Ratings pulled: ${totals.ratings}\n`
			+ `Comments pulled: ${totals.feedback}\n`
			+ `Listens added: ${totals.listens}\n`
			+ `Analytics blocks copied: ${totals.analytics}`
		);
	} catch (error) {
		console.error('Migration failed:', error);
		alert('Migration failed. Check the console for details.');
	} finally {
		if (migrateButton) {
			migrateButton.disabled = false;
			migrateButton.textContent = 'Pull Old Data';
		}
		loadAdminDashboard();
	}
}
