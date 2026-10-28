# ymate

A minimalist web app for downloading YouTube videos and audio, powered by
[yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org).
It runs on your own computer, and your files never leave it.

> **Run it yourself.** ymate needs a real, long-running server with yt-dlp and
> ffmpeg installed, so it can't be deployed to serverless hosts like Vercel or
> Netlify (you'll get `FUNCTION_INVOCATION_FAILED`). Clone it and run it
> locally, as described below.

## Features

- **Paste a link, pick a quality, download.** Choose the best available, a
  specific resolution (up to 4K, when the video has it), or audio-only MP3.
- **Best quality, properly merged.** Video and audio are fetched separately and
  joined by ffmpeg into a single MP4.
- **Live progress.** Stage, percentage, speed and time left, with a cancel
  button.
- **You choose where files go.** Type a folder or press **Browse**. It's
  remembered between runs.
- **Opens the folder when done.** Your file manager appears with the finished
  file selected (can be turned off).
- **Minimal, calm UI.** Light and dark themes that follow your system, a custom
  keyboard-friendly dropdown, and plenty of breathing room.
- **Private by default.** Only your own computer can reach it, unless you opt in
  to sharing on your network.
- **Zero dependencies.** Plain Node.js; there is nothing to `npm install`.

## Setup

You need three things installed:

| Tool | Get it | Check |
| --- | --- | --- |
| Node.js 20.6+ | https://nodejs.org | `node -v` |
| yt-dlp | https://github.com/yt-dlp/yt-dlp#installation | `yt-dlp --version` |
| ffmpeg | https://ffmpeg.org/download.html | `ffmpeg -version` |

Windows shortcut: `winget install OpenJS.NodeJS yt-dlp.yt-dlp Gyan.FFmpeg`

If `yt-dlp` or `ffmpeg` isn't on your PATH, either drop `yt-dlp(.exe)` next to
`server.js`, or point to them in `.env` (see [Configuration](#configuration)).

## Run

```
git clone <this repo>
cd ymate
npm start
```

Or double-click `start.bat` (Windows) / run `./start.sh` (macOS, Linux).
Then open http://localhost:3000.

The terminal tells you if yt-dlp or ffmpeg can't be found, and the page footer
shows the versions it's using.

## Choosing where files are saved

On the computer running ymate, the video card has a **Save to** field. Type or
paste a full folder path, or press **Browse** to pick one. The choice is
remembered in `settings.json`. When a download finishes, the card shows the
folder it was saved in, and your file manager opens with the file selected.
Untick **Open the folder** under **When done** to turn that off; **Show in
folder** is still there if you want it later.

People using ymate from another device on your network can't change the folder.
They get a **Save file** button that downloads through their browser instead.

## Configuration

Copy `.env.example` to `.env` and uncomment what you need. Everything is
optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `YTDLP_PATH` | `yt-dlp` | Full path to yt-dlp if it isn't on your PATH |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg file or folder if it isn't on your PATH |
| `PORT` | `3000` | Port to listen on |
| `DOWNLOAD_DIR` | `./downloads` | Default save folder (you can change it in the app) |
| `HOST` | `127.0.0.1` | Set to `0.0.0.0` to share on your network |

## Sharing on your network

By default only your own computer can open the app. To let phones or other
laptops on the same Wi-Fi use it, set `HOST=0.0.0.0` in `.env` and restart.
The terminal prints the address to share, e.g. `http://192.168.1.20:3000`.
You may also need to allow Node.js through your firewall.

There is no login, so anyone who can reach that address can download through
your machine. Only do this on a network you trust, and don't expose it to the
internet.

## How it works

```
Browser  ──  /api/info      ──▶  yt-dlp -J            (title, thumbnail, available qualities)
         ──  /api/download  ──▶  yt-dlp + ffmpeg      (download, merge, convert)
         ◀──  /api/jobs/:id/events (live progress)
```

The server is a single file (`server.js`) that runs yt-dlp as a child process
and streams its progress to the page. Each download goes into a temporary
folder first and is moved into place only when it's complete, so you never end
up with half-finished files.

```
server.js          HTTP server, yt-dlp/ffmpeg handling, jobs, settings
public/            index.html, style.css, app.js (no build step)
start.bat/.sh      one-click launchers
.env.example       optional settings template
settings.json      created at runtime (your chosen folder), gitignored
```

## Platform notes

Developed and tested on **Windows**. The folder picker, "Show in folder" and
auto-open use `powershell`, `explorer` on Windows, `osascript`/`open` on macOS
and `zenity`/`xdg-open` on Linux. The macOS and Linux paths are written but
haven't been tested yet; if one doesn't work, you can still type a folder path
into the **Save to** field.

## Troubleshooting

- **"Missing: yt-dlp" in the page footer:** set `YTDLP_PATH` in `.env`.
- **"Sign in to confirm you're not a bot":** update yt-dlp (`yt-dlp -U`).
- **Port already in use:** set `PORT=3001` in `.env`.
- **The Browse window doesn't appear:** look for "Browse For Folder" in your
  taskbar, or press **Browse** again. You can always paste a path instead.
- **Changed the code but nothing happened:** restart the server (Ctrl+C, then
  `npm start`) and hard-refresh the page (Ctrl+F5).

## Roadmap

Ideas for what could come next, roughly in order of how useful they'd be:

- [ ] **Playlists:** pick which videos to download, or grab a whole playlist
- [ ] **Download queue:** add several links and process them one by one
- [ ] **History:** a small list of recent downloads with "Show in folder"
- [ ] **Subtitles:** download and optionally embed captions
- [ ] **Trim a clip:** download only a chosen start and end time
- [ ] **More formats:** MKV/WebM video, and M4A/Opus/FLAC audio
- [ ] **Metadata:** embed thumbnail, title and artist into the file
- [ ] **Other sites:** yt-dlp supports many more than YouTube
- [ ] **Auto-update yt-dlp:** a button or notice when a newer version exists
- [ ] **Optional password** for when it's shared on a network
- [ ] **Docker image** for people who'd rather not install the tools by hand
- [ ] **Verify macOS and Linux** folder picking and "Show in folder"
- [ ] **Automated tests** for the API and download flow

Have an idea? Open an issue.

## Disclaimer

Only download content you have the right to download. Respect copyright and
YouTube's Terms of Service. ymate is a personal tool and isn't affiliated with
YouTube or Google.
