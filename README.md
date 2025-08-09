# AutoCut

AutoCut is a simple web app to upload a video, automatically remove deadspace (silence), and download the tightened result. It uses FFmpeg under the hood.

## Prerequisites

- macOS/Linux/Windows
- Node.js 18+
- FFmpeg installed and available on PATH
  - macOS: `brew install ffmpeg`
  - Linux: use your package manager
  - Windows: install from the FFmpeg site and add to PATH

## Getting Started

1. Install dependencies:

```
cd server
npm install
```

2. Start the server:

```
npm start
```

3. Open the app in your browser:

- Visit `http://localhost:3000`

## How it works

- Upload a video and tweak parameters (silence threshold and minimum silence length).
- The server detects silent portions using FFmpeg's `silencedetect` filter, builds a set of non-silent intervals, and concatenates those intervals.
- The processed MP4 is streamed back to the browser for preview and download.

## Notes

- This MVP defines deadspace as audio silence below a threshold for a minimum duration. You can tune the threshold/duration in the UI.
- Processing speed depends on your machine and video length. Large files may take a while.
- The app never uploads your video to any third-party service; all processing happens locally on your machine. 