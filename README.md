# SurgiCam UVC Control Suite

SurgiCam UVC provides a fullscreen browser interface and Node.js backend for operating a UVC-compliant surgical camera that streams MJPEG frames through **mjpg-streamer**. The application exposes ROI-aware capture controls, recording, and V4L2 camera tuning in real time via WebSockets.

## Features
- Live MJPEG stream viewer with digital zoom, panning, and ROI mini-map.
- Snapshot and recording workflows that crop media according to the active region of interest.
- Toast notifications for quick feedback on capture and recording state.
- Dynamic drawer for V4L2 controls with sliders, toggles, and menu selectors mapped to the camera's capabilities.
- WebSocket synchronization between the frontend and backend for low-latency control updates.

## Prerequisites
- Node.js 18 or newer.
- A UVC camera accessible through `mjpg-streamer` at `http://localhost:8080/?action=stream`.
- System utilities: `wget`, `ffmpeg`, and `v4l2-ctl` (usually available via `v4l-utils`).

## Installation
```bash
npm install
```

## Running the Application
1. Ensure `mjpg-streamer` is running and publishing the MJPEG feed.
2. Start the backend server:
   ```bash
   node server.js
   ```
3. Open your browser to [http://surgicam.local:3000](http://surgicam.local:3000) to access the UI.

## Directory Structure
- `public/` – Frontend assets (HTML, CSS, JavaScript).
- `server.js` – Express and WebSocket backend coordinating camera actions.
- `media/` – Captured snapshots and recordings.
- `package.json` – Project metadata and scripts.

## Development Notes
- The backend uses `require()` syntax and runs on `surgicam.local:3000` by default.
- MJPEG snapshots and recordings apply the currently selected ROI to maintain consistent framing.
- V4L2 control metadata is fetched dynamically, and disabled controls honor the `inactive` flag reported by `v4l2-ctl`.

## Troubleshooting
- Verify the MJPEG stream URL is reachable from the server before starting the Node.js process.
- Check filesystem permissions on the `media/` directory to ensure captures can be stored.
- Use `npm run lint` or additional tooling as desired for frontend static analysis.

## License
This project is provided as-is for internal surgical visualization workflows. Add licensing information here if redistribution is required.
