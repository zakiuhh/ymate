# ymate

A minimalist web app for downloading YouTube videos, powered by
[yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org).
It runs on your own computer, and your files stay there.

## Setup

You need three things installed:

| Tool | Get it | Check |
| --- | --- | --- |
| Node.js 20.6+ | https://nodejs.org | `node -v` |
| yt-dlp | https://github.com/yt-dlp/yt-dlp#installation | `yt-dlp --version` |
| ffmpeg | https://ffmpeg.org/download.html | `ffmpeg -version` |

Windows shortcut: `winget install OpenJS.NodeJS yt-dlp.yt-dlp Gyan.FFmpeg`

If `yt-dlp` or `ffmpeg` isn't on your PATH, either drop `yt-dlp(.exe)` next to
`server.js`, or point to them in `.env` (see below).

## Run

```
git clone <this repo>
cd ymate
npm start
```

Or double-click `start.bat` (Windows) / run `./start.sh` (macOS, Linux).
Then open http://localhost:3000.

There is nothing to `npm install`; the app has no dependencies.

## Configuration

Copy `.env.example` to `.env` and uncomment what you need:

| Variable | Default | Purpose |
| --- | --- | --- |
| `YTDLP_PATH` | `yt-dlp` | Full path to yt-dlp if it isn't on your PATH |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg file or folder if it isn't on your PATH |
| `PORT` | `3000` | Port to listen on |
| `DOWNLOAD_DIR` | `./downloads` | Where finished files are kept |
| `HOST` | `127.0.0.1` | Set to `0.0.0.0` to share on your network |

## Sharing on your network

By default only your own computer can open the app. To let phones or other
laptops on the same Wi-Fi use it, set `HOST=0.0.0.0` in `.env` and restart.
The terminal prints the address to share, e.g. `http://192.168.1.20:3000`.
You may also need to allow Node.js through your firewall.

There is no login, so anyone who can reach that address can download through
your machine. Only do this on a network you trust, and don't expose it to the
internet.

## Troubleshooting

- **"Missing: yt-dlp" in the page footer:** set `YTDLP_PATH` in `.env`.
- **"Sign in to confirm you're not a bot":** update yt-dlp (`yt-dlp -U`).
- **Port already in use:** set `PORT=3001` in `.env`.

Only download content you have the right to download.
