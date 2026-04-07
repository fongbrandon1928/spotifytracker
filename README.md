# Spotify Now Playing (Frontend)

This is a small frontend that uses the Spotify Web API to show the current
track playing on your account.

## Setup

1. Create a Spotify app in the Spotify Developer Dashboard.
2. Add a Redirect URI for the app: `https://127.0.0.1:5173/`.
3. Update `config.js` with your `clientId` and the exact `redirectUri`.

## Run locally (HTTPS required)

Spotify requires HTTPS for redirects. Use the local HTTPS server included
in this repo with a self-signed cert.

### 1) Create local certs with mkcert

Install mkcert (Windows):

- `choco install mkcert`

Then run:

```
mkcert -install
mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost 127.0.0.1 ::1
```

### 2) Start the HTTPS server

```
node server.js
```

Then open `https://127.0.0.1:5173/` in your browser.

## Notes

- Required scopes: `user-read-currently-playing`, `user-read-playback-state`.
- Tokens are stored in `localStorage`.
- If nothing is playing, the UI will display "Nothing playing".
