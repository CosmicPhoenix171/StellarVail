# StellarVail Music Sharing

A simple anonymous music sharing website where friends can listen to your music, rate songs, and leave feedback.

## Setup Instructions

### 1. Add Your Music Files
- Place your 15 .wav files in the `music/` folder
- Name them something simple like `song1.wav`, `song2.wav`, etc.

### 2. Update songs.json
- Edit `songs.json` to add metadata for each song
- Update the `id`, `title`, `artist`, `filename`, and `description` fields
- Make sure the `filename` matches your actual .wav file names

Example:
```json
{
    "id": "song1",
    "title": "My Awesome Track",
    "artist": "Your Name",
    "filename": "song1.wav",
    "description": "A chill electronic track"
}
```

### 3. Set Up Firebase Realtime Database

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project (or use existing)
3. Enable **Realtime Database**:
   - Go to Build > Realtime Database
   - Click "Create Database"
   - Start in **test mode** (we'll set rules next)
   - Choose your region

4. Set Database Rules:
   - Go to the "Rules" tab
   - Replace the rules with:
   ```json
   {
     "rules": {
       "songs": {
         "$songId": {
           ".read": true,
           ".write": true
         }
       }
     }
   }
   ```
   - Click "Publish"

5. Get your Firebase config:
   - Go to Project Settings (gear icon) > General
   - Scroll down to "Your apps"
   - Click the web icon (</>)
   - Copy the `firebaseConfig` object

6. Update `firebase-config.js`:
   - Replace the placeholder values with your Firebase config
   - Save the file

### 4. Test Locally

Open `index.html` in your browser to test:
- You can open it directly, or use a local server:
  ```bash
  # Using Python
  python -m http.server 8000
  
  # Using Node.js (if you have http-server installed)
  npx http-server
  ```
- Go to `http://localhost:8000`

### 5. Deploy to GitHub Pages

1. Commit all your files:
   ```bash
   git add .
   git commit -m "Initial commit - Music sharing site"
   git push origin main
   ```

2. Enable GitHub Pages:
   - Go to your GitHub repository settings
   - Navigate to "Pages" in the left sidebar
   - Under "Source", select "main" branch
   - Click "Save"
   - Your site will be available at: `https://CosmicPhoenix171.github.io/StellarVail/`

### 6. Share with Friends

Send your friends the GitHub Pages URL and they can:
- Listen to all your songs
- Rate songs with stars (1-5)
- Leave comments and feedback
- All anonymously!

## Features

- 🎵 HTML5 audio player with full controls
- ⭐ Star rating system (1-5 stars)
- 💬 Anonymous commenting with optional names
- 📱 Responsive design (works on mobile)
- 🔥 Real-time updates using Firebase
- 🎨 Beautiful gradient design

## Notes

- Each visitor can rate each song once (tracked via browser localStorage)
- Comments are stored in Firebase and update in real-time
- .wav files will be about 40-50MB each, totaling ~600-750MB for 15 songs
- This is within GitHub's 1GB repository limit

## Customization

- Edit `style.css` to change colors and design
- Modify the gradient in `body` background
- Change star rating to different emoji or icons
- Add album art by updating the song cards

Enjoy sharing your music! 🎶
