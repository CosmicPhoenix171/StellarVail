/**
 * build.js — StellarVail
 * Run with:  node build.js
 *
 * Scans music/ for subfolders that contain an info.json and regenerates
 * music/index.json in alphabetical order (skipping the index.json file itself).
 *
 * Preserving order: if music/index.json already exists, the script keeps the
 * existing order and only appends folders that are missing from it.
 */

const fs   = require('fs');
const path = require('path');

const musicDir  = path.join(__dirname, 'music');
const indexFile = path.join(musicDir, 'index.json');

// Read existing index (to preserve ordering)
let existing = [];
if (fs.existsSync(indexFile)) {
    existing = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
}

// Discover all folders that have an info.json
const discovered = fs.readdirSync(musicDir)
    .filter(name => {
        const full = path.join(musicDir, name);
        return fs.statSync(full).isDirectory() &&
               fs.existsSync(path.join(full, 'info.json'));
    });

// Merge: keep existing order, append any new folders alphabetically
const existingSet = new Set(existing);
const newFolders  = discovered
    .filter(f => !existingSet.has(f))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

const merged = [...existing.filter(f => discovered.includes(f)), ...newFolders];

fs.writeFileSync(indexFile, JSON.stringify(merged, null, 4), 'utf8');
console.log(`music/index.json updated — ${merged.length} songs.`);
if (newFolders.length) {
    console.log('  Added:', newFolders.join(', '));
}
