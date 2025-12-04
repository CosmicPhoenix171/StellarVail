// Global variables
let currentSongId = null;
let songsData = [];

// DOM Elements
const audioPlayer = document.getElementById('audio-player');
const songsContainer = document.getElementById('songs-container');
const currentSongTitle = document.querySelector('.song-title');
const currentSongArtist = document.querySelector('.song-artist');

// Load songs data
async function loadSongs() {
    try {
        const response = await fetch('songs.json');
        songsData = await response.json();
        renderSongs();
    } catch (error) {
        console.error('Error loading songs:', error);
        songsContainer.innerHTML = '<p style="color: white;">Error loading songs. Please check songs.json file.</p>';
    }
}

// Render songs to the page
function renderSongs() {
    songsContainer.innerHTML = '';
    
    songsData.forEach(song => {
        const songCard = createSongCard(song);
        songsContainer.appendChild(songCard);
        
        // Load rating and feedback data
        loadRatingData(song.id);
        loadFeedback(song.id);
    });
}

// Create song card element
function createSongCard(song) {
    const card = document.createElement('div');
    card.className = 'song-card';
    card.innerHTML = `
        <div class="song-header" onclick="playSong('${song.id}')">
            <h3>${song.title}</h3>
            <p class="artist">${song.artist || 'Unknown Artist'}</p>
            ${song.description ? `<p class="description">${song.description}</p>` : ''}
        </div>
        <button class="play-button" onclick="playSong('${song.id}')" data-song-id="${song.id}">
            ▶ Play
        </button>
        
        <!-- Rating Section -->
        <div class="rating-section">
            <div class="rating-display">
                <span class="avg-rating" id="avg-rating-${song.id}">0.0</span>
                <span class="rating-count" id="rating-count-${song.id}">(0 ratings)</span>
            </div>
            <div class="rating-stars" id="rating-stars-${song.id}">
                ${[1, 2, 3, 4, 5].map(i => `<span class="star" data-rating="${i}" onclick="rateSong('${song.id}', ${i})">★</span>`).join('')}
            </div>
            <p class="rating-message" id="rating-message-${song.id}">Click stars to rate</p>
        </div>
        
        <!-- Feedback Section -->
        <div class="feedback-section">
            <h4>Comments</h4>
            <div class="feedback-form">
                <input type="text" id="feedback-name-${song.id}" placeholder="Your name (optional, default: Anonymous)" maxlength="50">
                <textarea id="feedback-text-${song.id}" placeholder="Leave your feedback..." maxlength="500"></textarea>
                <button onclick="submitFeedback('${song.id}')">Post Comment</button>
            </div>
            <div class="feedback-list" id="feedback-list-${song.id}">
                <p class="no-feedback">No comments yet. Be the first!</p>
            </div>
        </div>
    `;
    return card;
}

// Play song
function playSong(songId) {
    const song = songsData.find(s => s.id === songId);
    if (!song) return;
    
    // Update audio player
    audioPlayer.src = `music/${song.filename}`;
    audioPlayer.play();
    
    // Update now playing display
    currentSongTitle.textContent = song.title;
    currentSongArtist.textContent = song.artist || 'Unknown Artist';
    
    // Update play buttons
    document.querySelectorAll('.play-button').forEach(btn => {
        btn.classList.remove('playing');
        btn.innerHTML = '▶ Play';
    });
    
    const currentButton = document.querySelector(`button[data-song-id="${songId}"]`);
    if (currentButton) {
        currentButton.classList.add('playing');
        currentButton.innerHTML = '⏸ Playing';
    }
    
    currentSongId = songId;
}

// Audio player event listeners
audioPlayer.addEventListener('ended', () => {
    document.querySelectorAll('.play-button').forEach(btn => {
        btn.classList.remove('playing');
        btn.innerHTML = '▶ Play';
    });
});

// ===== RATING SYSTEM =====

// Load rating data from Firebase
function loadRatingData(songId) {
    const ratingsRef = database.ref(`songs/${songId}/ratings`);
    
    ratingsRef.on('value', (snapshot) => {
        const ratings = snapshot.val();
        let sum = 0;
        let count = 0;
        
        if (ratings) {
            Object.values(ratings).forEach(rating => {
                sum += rating.rating;
                count++;
            });
        }
        
        const average = count > 0 ? (sum / count).toFixed(1) : 0.0;
        
        // Update display
        document.getElementById(`avg-rating-${songId}`).textContent = average;
        document.getElementById(`rating-count-${songId}`).textContent = `(${count} rating${count !== 1 ? 's' : ''})`;
        
        // Update stars display
        updateStarsDisplay(songId, average);
    });
}

// Update star display
function updateStarsDisplay(songId, average) {
    const starsContainer = document.getElementById(`rating-stars-${songId}`);
    const stars = starsContainer.querySelectorAll('.star');
    
    stars.forEach((star, index) => {
        if (index < Math.round(average)) {
            star.classList.add('filled');
        } else {
            star.classList.remove('filled');
        }
    });
}

// Rate a song
function rateSong(songId, rating) {
    // Check if user already rated (using localStorage)
    const ratedKey = `rated_${songId}`;
    if (localStorage.getItem(ratedKey)) {
        document.getElementById(`rating-message-${songId}`).textContent = 'You already rated this song';
        setTimeout(() => {
            document.getElementById(`rating-message-${songId}`).textContent = 'Click stars to rate';
        }, 3000);
        return;
    }
    
    // Save rating to Firebase
    const ratingRef = database.ref(`songs/${songId}/ratings`).push();
    ratingRef.set({
        rating: rating,
        timestamp: Date.now()
    }).then(() => {
        // Mark as rated in localStorage
        localStorage.setItem(ratedKey, 'true');
        document.getElementById(`rating-message-${songId}`).textContent = 'Thanks for rating!';
        
        // Highlight stars temporarily
        const stars = document.querySelectorAll(`#rating-stars-${songId} .star`);
        stars.forEach((star, index) => {
            if (index < rating) {
                star.classList.add('filled');
            }
        });
    }).catch(error => {
        console.error('Error saving rating:', error);
        document.getElementById(`rating-message-${songId}`).textContent = 'Error saving rating';
    });
}

// ===== FEEDBACK SYSTEM =====

// Load feedback from Firebase
function loadFeedback(songId) {
    const feedbackRef = database.ref(`songs/${songId}/feedback`);
    
    feedbackRef.on('value', (snapshot) => {
        const feedbackList = document.getElementById(`feedback-list-${songId}`);
        const feedbacks = snapshot.val();
        
        if (!feedbacks) {
            feedbackList.innerHTML = '<p class="no-feedback">No comments yet. Be the first!</p>';
            return;
        }
        
        // Convert to array and sort by timestamp (newest first)
        const feedbackArray = Object.entries(feedbacks).map(([key, value]) => ({
            id: key,
            ...value
        })).sort((a, b) => b.timestamp - a.timestamp);
        
        // Render feedback
        feedbackList.innerHTML = feedbackArray.map(fb => `
            <div class="feedback-item">
                <div class="feedback-header">
                    <span class="feedback-author">${fb.displayName || 'Anonymous'}</span>
                    <span class="feedback-time">${formatTime(fb.timestamp)}</span>
                </div>
                <p class="feedback-text">${escapeHtml(fb.comment)}</p>
            </div>
        `).join('');
    });
}

// Submit feedback
function submitFeedback(songId) {
    const nameInput = document.getElementById(`feedback-name-${songId}`);
    const textInput = document.getElementById(`feedback-text-${songId}`);
    
    const comment = textInput.value.trim();
    
    if (!comment) {
        alert('Please enter a comment');
        return;
    }
    
    const displayName = nameInput.value.trim() || 'Anonymous';
    
    // Save to Firebase
    const feedbackRef = database.ref(`songs/${songId}/feedback`).push();
    feedbackRef.set({
        displayName: displayName,
        comment: comment,
        timestamp: Date.now()
    }).then(() => {
        // Clear form
        nameInput.value = '';
        textInput.value = '';
    }).catch(error => {
        console.error('Error saving feedback:', error);
        alert('Error posting comment. Please try again.');
    });
}

// ===== UTILITY FUNCTIONS =====

// Format timestamp
function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString();
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadSongs();
});
