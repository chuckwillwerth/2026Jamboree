# 2026Jamboree

Phone-friendly attendance tracker for jamboree check-in.

## What it does

- Loads the full roster from `attendancelist.csv`
- Lets gate staff search by player name, coach/team name, or division
- Marks someone present with a single tap
- Syncs attendance across multiple phones with Firebase Firestore
- Falls back to browser-local storage until Firebase is configured

## Files

- `index.html` - app shell
- `styles.css` - mobile-first styling
- `app.js` - roster loading, filtering, and attendance logic
- `firebase-config.js` - local app configuration

## Run locally

Because the app fetches the CSV file, serve it with a local web server instead of opening the HTML file directly.

```bash
cd /workspaces/2026Jamboree
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Firebase setup

Use Firebase so multiple gate workers on different phones see the same attendance data.

### 1. Create a Firebase project

1. Go to the Firebase console.
2. Create a new project.
3. Add a Web app to the project.
4. Copy the Firebase config object.

### 2. Enable Firestore

1. Open Firestore Database.
2. Create the database in production mode.
3. Pick a region close to your event.

### 3. Enable anonymous sign-in

1. Open Authentication.
2. Click Sign-in method.
3. Enable `Anonymous`.

### 4. Paste the Firebase config

Edit `firebase-config.js` and replace `firebase: null` with your Firebase config.

Example:

```js
window.ATTENDANCE_APP_CONFIG = {
	eventId: "2026-jamboree",
	firebase: {
		apiKey: "...",
		authDomain: "your-project.firebaseapp.com",
		projectId: "your-project-id",
		storageBucket: "your-project.firebasestorage.app",
		messagingSenderId: "...",
		appId: "...",
	},
};
```

### 5. Firestore rules

Use rules like these so only authenticated users can read and write attendance. Since the app signs in anonymously, each phone can still use it without a manual login.

```txt
rules_version = '2';
service cloud.firestore {
	match /databases/{database}/documents {
		match /events/{eventId}/attendance/{rosterId} {
			allow read, write: if request.auth != null;
		}
	}
}
```

### 6. Optional deployment

This is a static site, so Firebase Hosting is a good fit. You can also host it anywhere that serves static files over HTTPS.

## GitHub Pages deployment

This repo now includes a GitHub Actions workflow that publishes the site to GitHub Pages whenever you push to `main`.

### 1. Commit and push the repo

Push the current files to GitHub, including:

- `.github/workflows/deploy-pages.yml`
- `.nojekyll`
- the app files in the repo root

### 2. Enable GitHub Pages in the repo settings

1. Open the GitHub repository.
2. Go to `Settings`.
3. Open `Pages`.
4. Under `Build and deployment`, choose `GitHub Actions` as the source.

### 3. Wait for the workflow to publish

After pushing to `main`, open the `Actions` tab and watch the Pages deployment workflow. When it succeeds, GitHub will give you a site URL in this form:

```txt
https://chuckwillwerth.github.io/2026Jamboree/
```

### 4. Use the Pages URL on phones

Open the published Pages URL on each phone. Because the app uses relative asset paths, it will work correctly from the repository subpath.

### 5. Firebase note for Pages

GitHub Pages only hosts the static files. Firestore and Firebase Authentication still come from your Firebase project.

Make sure `firebase-config.js` has your real Firebase web app values before you use the Pages site for live attendance.

## Data model

The roster stays in `attendancelist.csv`.

Attendance is stored separately in Firestore at:

```txt
events/{eventId}/attendance/{rosterId}
```

Each attendance document stores the person identity fields plus the check-in timestamp.

## Updating the roster

Replace `attendancelist.csv` with a new export that keeps the same header names:

```txt
division,team-coach,first,last,player-or-coach,shirt-size
```

Reload the page after updating the CSV.
