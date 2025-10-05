const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec, spawn } = require('child_process');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');

const HOST = 'surgicam.local';
const PORT = 3000;
const STREAM_URL = 'http://localhost:8080/?action=stream';
const SNAPSHOT_URL = 'http://localhost:8080/?action=snapshot';
const MEDIA_DIR = path.join(__dirname, 'media');

if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let currentROI = {
  width: null,
  height: null,
  x: 0,
  y: 0,
  zoom: 1,
  imageWidth: null,
  imageHeight: null
};

function normalizeROI(roi = {}) {
  const next = { ...currentROI };
  const numericKeys = ['zoom', 'x', 'y', 'width', 'height', 'imageWidth', 'imageHeight'];
  numericKeys.forEach((key) => {
    if (roi[key] === undefined || roi[key] === null) return;
    const value = Number(roi[key]);
    if (!Number.isNaN(value)) {
      if (key === 'zoom') {
        next.zoom = Math.min(Math.max(value, 1), 4);
      } else if (key === 'width' || key === 'height' || key === 'imageWidth' || key === 'imageHeight') {
        next[key] = Math.max(0, value);
      } else {
        next[key] = Math.max(0, value);
      }
    }
  });

  if (next.imageWidth && next.width) {
    next.x = Math.min(Math.max(next.x, 0), Math.max(next.imageWidth - next.width, 0));
  }
  if (next.imageHeight && next.height) {
    next.y = Math.min(Math.max(next.y, 0), Math.max(next.imageHeight - next.height, 0));
  }

  return next;
}

let recordingProcess = null;
let recordingFile = null;

function send(ws, type, payload = {}) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, ...payload }));
  }
}

function broadcast(type, payload = {}) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type, ...payload }));
    }
  });
}

function timestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function getTempSnapshotFile() {
  return path.join(MEDIA_DIR, `temp_${timestamp()}.jpg`);
}

function runCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    exec(command, options, (error, stdout, stderr) => {
      if (error) {
        const err = new Error(`Command failed: ${command}\n${stderr || error.message}`);
        err.stderr = stderr;
        err.stdout = stdout;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

async function captureSnapshot(roi) {
  const tempFile = getTempSnapshotFile();
  const outputFile = path.join(MEDIA_DIR, `snapshot_${timestamp()}.jpg`);

  await runCommand(`wget -q -O "${tempFile}" "${SNAPSHOT_URL}"`);

  let cropFilter = 'crop=in_w:in_h:0:0';
  if (roi && roi.width && roi.height) {
    const w = Math.round(roi.width);
    const h = Math.round(roi.height);
    const x = Math.max(0, Math.round(roi.x || 0));
    const y = Math.max(0, Math.round(roi.y || 0));
    cropFilter = `crop=${w}:${h}:${x}:${y}`;
  }

  await runCommand(`ffmpeg -y -i "${tempFile}" -vf ${cropFilter} -frames:v 1 "${outputFile}"`);
  fs.unlink(tempFile, () => {});
  return outputFile;
}

function buildFFmpegArgs(roi) {
  const args = ['-f', 'mjpeg', '-i', STREAM_URL, '-c:v', 'libx264', '-preset', 'veryfast', '-t', '600'];
  if (roi && roi.width && roi.height) {
    const w = Math.round(roi.width);
    const h = Math.round(roi.height);
    const x = Math.max(0, Math.round(roi.x || 0));
    const y = Math.max(0, Math.round(roi.y || 0));
    args.push('-vf', `crop=${w}:${h}:${x}:${y}`);
  }
  return args;
}

async function startRecording(roi) {
  if (recordingProcess) {
    throw new Error('Recording is already in progress');
  }
  recordingFile = path.join(MEDIA_DIR, `recording_${timestamp()}.mp4`);
  const relativeRecordingFile = path.relative(__dirname, recordingFile);
  const args = buildFFmpegArgs(roi);
  args.push(recordingFile);

  recordingProcess = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });

  return new Promise((resolve, reject) => {
    let started = false;
    const errors = [];
    const startPatterns = [/Press \[q\] to stop/, /frame=\s*\d+/, /Output #0/];

    const readyTimer = setTimeout(() => {
      if (!started) {
        started = true;
        broadcast('record-status', { status: 'recording', file: relativeRecordingFile });
        resolve(recordingFile);
      }
    }, 2000);

    const cleanup = () => {
      clearTimeout(readyTimer);
    };

    const onExit = (code) => {
      cleanup();
      if (!started) {
        recordingProcess = null;
        reject(new Error(`Recording failed to start (exit code ${code})\n${errors.join('\n')}`));
      } else {
        recordingProcess = null;
        broadcast('record-status', { status: 'stopped', file: relativeRecordingFile });
        broadcast('toast', { message: `Grabación finalizada: ${path.basename(relativeRecordingFile)}` });
      }
    };

    recordingProcess.stderr.on('data', (data) => {
      const text = data.toString();
      errors.push(text);
      if (!started && startPatterns.some((pattern) => pattern.test(text))) {
        started = true;
        cleanup();
        resolve(recordingFile);
        broadcast('record-status', { status: 'recording', file: relativeRecordingFile });
      }
    });

    recordingProcess.on('close', (code) => {
      onExit(code);
    });

    recordingProcess.on('error', (err) => {
      reject(err);
    });
  });
}

async function stopRecording() {
  if (!recordingProcess) {
    throw new Error('No recording in progress');
  }
  return new Promise((resolve) => {
    recordingProcess.once('close', () => {
      recordingProcess = null;
      resolve(recordingFile);
    });
    recordingProcess.kill('SIGINT');
  });
}

function parseControlLine(line) {
  const match = line.match(/^\s*([\w_]+) \(([^)]+)\)\s*:\s*(.+)$/);
  if (!match) return null;
  const [, name, type, rest] = match;
  const params = {};
  rest.split(/\s+/).forEach((segment) => {
    const [key, value] = segment.split('=');
    if (value !== undefined) {
      params[key] = value;
    }
  });
  const control = {
    name,
    type: type.trim(),
    ...params,
    flags: params.flags ? params.flags.split(',') : [],
    menu: []
  };
  if (params.min !== undefined) control.min = Number(params.min);
  if (params.max !== undefined) control.max = Number(params.max);
  if (params.step !== undefined) control.step = Number(params.step);
  if (params.default !== undefined) control.default = Number(params.default);
  if (params.value !== undefined) control.value = Number(params.value);
  return control;
}

function parseMenuLine(line) {
  const match = line.trim().match(/^(\d+)\s*:\s*(.+)$/);
  if (!match) return null;
  return { value: Number(match[1]), label: match[2] };
}

async function getControlMetadata() {
  try {
    const { stdout } = await runCommand('v4l2-ctl --list-ctrls-menus');
    const lines = stdout.split('\n');
    const controls = [];
    let current = null;
    lines.forEach((line) => {
      if (!line.trim()) return;
      if (/\(/.test(line) && !line.includes('Menu items:')) {
        const parsed = parseControlLine(line);
        if (parsed) {
          current = parsed;
          controls.push(current);
        }
      } else if (current && line.includes(':')) {
        const item = parseMenuLine(line);
        if (item) {
          current.menu.push(item);
        }
      }
    });
    return controls;
  } catch (error) {
    throw error;
  }
}

async function getControlValues(names) {
  if (!names.length) return {};
  const { stdout } = await runCommand(`v4l2-ctl --get-ctrl=${names.join(',')}`);
  const values = {};
  stdout.split('\n').forEach((line) => {
    const match = line.trim().match(/^([\w_]+)\s*:\s*(.+)$/);
    if (match) {
      values[match[1]] = Number(match[2]);
    }
  });
  return values;
}

async function loadControls() {
  const metadata = await getControlMetadata();
  const names = metadata.map((ctrl) => ctrl.name);
  const values = await getControlValues(names);
  return metadata.map((ctrl) => ({
    ...ctrl,
    value: values.hasOwnProperty(ctrl.name) ? values[ctrl.name] : ctrl.value
  }));
}

async function setControl(name, value) {
  await runCommand(`v4l2-ctl --set-ctrl ${name}=${value}`);
  return { name, value };
}

wss.on('connection', (ws) => {
  send(ws, 'hello', { message: 'connected' });
  send(ws, 'record-status', { status: recordingProcess ? 'recording' : 'idle', file: recordingFile });
  send(ws, 'roi-update', { roi: currentROI });

  ws.on('message', async (raw) => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      return send(ws, 'error', { message: 'Invalid JSON payload' });
    }

    const { type } = payload;
    try {
      switch (type) {
        case 'get-controls': {
          const controls = await loadControls();
          send(ws, 'controls', { controls });
          break;
        }
        case 'set-control': {
          const { name, value } = payload;
          const result = await setControl(name, value);
          send(ws, 'control-update', result);
          break;
        }
        case 'snapshot': {
          const file = await captureSnapshot(payload.roi || currentROI);
          send(ws, 'snapshot-complete', { status: 'saved', file: path.relative(__dirname, file) });
          broadcast('toast', { message: `Captura guardada: ${path.basename(file)}` });
          break;
        }
        case 'record': {
          if (payload.action === 'start') {
            await startRecording(payload.roi || currentROI);
            const relativeFile = recordingFile ? path.relative(__dirname, recordingFile) : null;
            broadcast('record-status', { status: 'recording', file: relativeFile });
            send(ws, 'toast', { message: 'Grabación iniciada' });
          } else {
            const file = await stopRecording();
            send(ws, 'toast', { message: 'Grabación detenida' });
            broadcast('record-status', { status: 'stopped', file: path.relative(__dirname, file) });
          }
          break;
        }
        case 'roi-update': {
          currentROI = normalizeROI(payload.roi || {});
          broadcast('roi-update', { roi: currentROI });
          break;
        }
        default:
          send(ws, 'error', { message: `Unknown message type: ${type}` });
      }
    } catch (error) {
      send(ws, 'error', { message: error.message });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`SurgiCam control interface available at http://${HOST}:${PORT}`);
});
