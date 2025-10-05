const state = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  imageWidth: 0,
  imageHeight: 0,
  isPanning: false,
  panStart: { x: 0, y: 0 },
  panOffsetStart: { x: 0, y: 0 },
  roiDirty: false,
  recordStatus: 'idle',
  controls: [],
  ws: null,
  roiSendTimeout: null
};

const stream = document.getElementById('stream');
const viewer = document.getElementById('viewer');
const zoomSlider = document.getElementById('zoom-slider');
const snapshotBtn = document.getElementById('snapshot-btn');
const recordBtn = document.getElementById('record-btn');
const roiViewport = document.getElementById('roi-viewport');
const roiMap = document.getElementById('roi-map');
const roiMapImage = document.getElementById('roi-map-image');
const controlsList = document.getElementById('controls-list');
const toastContainer = document.getElementById('toast-container');
const drawer = document.getElementById('control-drawer');
const drawerToggle = document.getElementById('drawer-toggle');

const STREAM_HOST = window.location.hostname || 'surgicam.local';
const STREAM_URL = `http://${STREAM_HOST}:8080/?action=stream`;
const WS_URL = (() => {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.host || 'surgicam.local:3000';
  return `${protocol}://${host}`;
})();

if (stream) {
  stream.src = STREAM_URL;
}

if (roiMapImage) {
  roiMapImage.src = STREAM_URL;
}

const controlIcons = {
  brightness: '🌞',
  contrast: '🎚️',
  saturation: '🎨',
  hue: '🌈',
  white_balance_automatic: '⚪',
  gamma: '📈',
  gain: '➕',
  power_line_frequency: '🔌',
  white_balance_temperature: '🌡️',
  sharpness: '🔪',
  backlight_compensation: '💡',
  auto_exposure: '🌓',
  exposure_time_absolute: '⏱️',
  exposure_dynamic_framerate: '🎞️',
  focus_absolute: '🎯',
  focus_automatic_continuous: '♻️',
  privacy: '🔒'
};

function connectSocket() {
  const ws = new WebSocket(WS_URL);
  state.ws = ws;

  ws.addEventListener('open', () => {
    requestControls();
    sendROIUpdate();
  });

  ws.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(event.data);
      handleMessage(data);
    } catch (error) {
      console.error('Invalid WS message', error);
    }
  });

  ws.addEventListener('close', () => {
    showToast('Conexión perdida. Reintentando...');
    setTimeout(connectSocket, 2000);
  });
}

function handleMessage(message) {
  const { type } = message;
  switch (type) {
    case 'controls':
      state.controls = message.controls || [];
      renderControls();
      break;
    case 'control-update':
      updateControlValue(message.name, message.value);
      break;
    case 'record-status':
      updateRecordStatus(message.status, message.file);
      break;
    case 'snapshot-complete':
      if (message.file) {
        showToast(`Snapshot saved: ${message.file}`);
      }
      break;
    case 'toast':
      if (message.message) {
        showToast(message.message);
      }
      break;
    case 'error':
      if (message.message) {
        showToast(`Error: ${message.message}`);
      }
      break;
    default:
      break;
  }
}

function requestControls() {
  sendMessage({ type: 'get-controls' });
}

function sendMessage(payload) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify(payload));
  }
}

function sendROIUpdate() {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    const roi = getCurrentROIPixels();
    sendMessage({ type: 'roi-update', roi });
  }
}

function throttleROISend() {
  if (state.roiSendTimeout) {
    clearTimeout(state.roiSendTimeout);
  }
  state.roiSendTimeout = setTimeout(() => {
    sendROIUpdate();
    state.roiSendTimeout = null;
  }, 120);
}

function getCurrentROIPixels() {
  if (!state.imageWidth || !state.imageHeight) {
    return {
      zoom: state.zoom,
      x: 0,
      y: 0,
      width: state.imageWidth,
      height: state.imageHeight
    };
  }
  const roiWidth = state.imageWidth / state.zoom;
  const roiHeight = state.imageHeight / state.zoom;
  const maxOffsetX = state.imageWidth - roiWidth;
  const maxOffsetY = state.imageHeight - roiHeight;
  const x = Math.min(Math.max(state.offsetX, 0), maxOffsetX);
  const y = Math.min(Math.max(state.offsetY, 0), maxOffsetY);
  return {
    zoom: state.zoom,
    x,
    y,
    width: roiWidth,
    height: roiHeight,
    imageWidth: state.imageWidth,
    imageHeight: state.imageHeight
  };
}

function updateTransform() {
  const roiWidthRatio = 1 / state.zoom;
  const roiHeightRatio = 1 / state.zoom;
  const offsetXRatio = state.imageWidth ? state.offsetX / state.imageWidth : 0;
  const offsetYRatio = state.imageHeight ? state.offsetY / state.imageHeight : 0;
  const translateX = -offsetXRatio * 100 / state.zoom;
  const translateY = -offsetYRatio * 100 / state.zoom;
  stream.style.transform = `translate(${translateX}%, ${translateY}%) scale(${state.zoom})`;

  updateROIViewport(roiWidthRatio, roiHeightRatio, offsetXRatio, offsetYRatio);
}

function updateROIViewport(roiWidthRatio, roiHeightRatio, offsetXRatio, offsetYRatio) {
  const widthPercent = roiWidthRatio * 100;
  const heightPercent = roiHeightRatio * 100;
  const leftPercent = offsetXRatio * 100;
  const topPercent = offsetYRatio * 100;
  roiViewport.style.width = `${widthPercent}%`;
  roiViewport.style.height = `${heightPercent}%`;
  roiViewport.style.left = `${leftPercent}%`;
  roiViewport.style.top = `${topPercent}%`;
}

function clampOffset() {
  const roiWidth = state.imageWidth / state.zoom;
  const roiHeight = state.imageHeight / state.zoom;
  state.offsetX = Math.min(Math.max(state.offsetX, 0), Math.max(state.imageWidth - roiWidth, 0));
  state.offsetY = Math.min(Math.max(state.offsetY, 0), Math.max(state.imageHeight - roiHeight, 0));
}

function applyZoom(newZoom, originX, originY) {
  const prevZoom = state.zoom;
  const roiBefore = getCurrentROIPixels();
  state.zoom = Math.min(Math.max(newZoom, 1), 4);
  const zoomRatio = state.zoom / prevZoom;
  if (state.imageWidth && state.imageHeight) {
    const focusX = originX !== undefined ? originX : roiBefore.x + roiBefore.width / 2;
    const focusY = originY !== undefined ? originY : roiBefore.y + roiBefore.height / 2;
    const newWidth = state.imageWidth / state.zoom;
    const newHeight = state.imageHeight / state.zoom;
    state.offsetX = focusX - newWidth / 2;
    state.offsetY = focusY - newHeight / 2;
    clampOffset();
  }
  zoomSlider.value = state.zoom;
  updateTransform();
  throttleROISend();
}

function handlePointerDown(event) {
  event.preventDefault();
  state.isPanning = true;
  state.panStart = { x: event.clientX, y: event.clientY };
  state.panOffsetStart = { x: state.offsetX, y: state.offsetY };
  viewer.setPointerCapture(event.pointerId);
}

function handlePointerMove(event) {
  if (!state.isPanning) return;
  const deltaX = event.clientX - state.panStart.x;
  const deltaY = event.clientY - state.panStart.y;
  state.offsetX = state.panOffsetStart.x - deltaX * (state.imageWidth / viewer.clientWidth) / state.zoom;
  state.offsetY = state.panOffsetStart.y - deltaY * (state.imageHeight / viewer.clientHeight) / state.zoom;
  clampOffset();
  updateTransform();
  throttleROISend();
}

function handlePointerUp(event) {
  if (!state.isPanning) return;
  state.isPanning = false;
  try {
    viewer.releasePointerCapture(event.pointerId);
  } catch (error) {
    /* ignore */
  }
}

function handleWheel(event) {
  event.preventDefault();
  const delta = -event.deltaY / 300;
  const newZoom = state.zoom * (1 + delta);
  const rect = viewer.getBoundingClientRect();
  const relativeX = (event.clientX - rect.left) / rect.width;
  const relativeY = (event.clientY - rect.top) / rect.height;
  const focusX = state.offsetX + (state.imageWidth / state.zoom) * relativeX;
  const focusY = state.offsetY + (state.imageHeight / state.zoom) * relativeY;
  applyZoom(newZoom, focusX, focusY);
}

function handleZoomSlider(event) {
  applyZoom(Number(event.target.value));
}

function handleROIMapInteraction(event) {
  const rect = roiMap.getBoundingClientRect();
  const xRatio = (event.clientX - rect.left) / rect.width;
  const yRatio = (event.clientY - rect.top) / rect.height;
  const roiWidthRatio = 1 / state.zoom;
  const roiHeightRatio = 1 / state.zoom;
  state.offsetX = (xRatio - roiWidthRatio / 2) * state.imageWidth;
  state.offsetY = (yRatio - roiHeightRatio / 2) * state.imageHeight;
  clampOffset();
  updateTransform();
  throttleROISend();
}

function bindROIMap() {
  if (!roiMap) return;
  let active = false;
  const start = (event) => {
    active = true;
    handleROIMapInteraction(event);
  };
  const move = (event) => {
    if (!active) return;
    handleROIMapInteraction(event);
  };
  const stop = () => {
    active = false;
  };
  roiMap.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (typeof roiMap.setPointerCapture === 'function') {
      try {
        roiMap.setPointerCapture(event.pointerId);
      } catch (error) {
        // ignore pointer capture failures
      }
    }
    start(event);
  });
  roiMap.addEventListener('pointermove', move);
  roiMap.addEventListener('pointerup', (event) => {
    if (typeof roiMap.releasePointerCapture === 'function') {
      try {
        if (typeof roiMap.hasPointerCapture === 'function') {
          if (roiMap.hasPointerCapture(event.pointerId)) {
            roiMap.releasePointerCapture(event.pointerId);
          }
        } else {
          roiMap.releasePointerCapture(event.pointerId);
        }
      } catch (error) {
        // ignore pointer capture failures
      }
    }
    stop();
  });
  roiMap.addEventListener('pointercancel', stop);
  roiMap.addEventListener('pointerleave', stop);
}

function handleSnapshot() {
  const roi = getCurrentROIPixels();
  sendMessage({ type: 'snapshot', roi });
}

function handleRecordToggle() {
  if (state.recordStatus === 'recording') {
    sendMessage({ type: 'record', action: 'stop' });
  } else {
    const roi = getCurrentROIPixels();
    sendMessage({ type: 'record', action: 'start', roi });
  }
}

function updateRecordStatus(status) {
  state.recordStatus = status;
  if (!recordBtn) return;
  if (status === 'recording') {
    recordBtn.classList.add('recording');
    recordBtn.textContent = '⏹ Detener';
  } else {
    recordBtn.classList.remove('recording');
    recordBtn.textContent = '⏺ Grabar';
  }
}

function showToast(message) {
  if (!message) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3100);
}

function updateControlValue(name, value) {
  const control = state.controls.find((ctrl) => ctrl.name === name);
  if (!control) return;
  control.value = value;
  const card = document.querySelector(`[data-control='${name}']`);
  if (!card) return;
  const valueLabel = card.querySelector('.control-value');
  if (valueLabel) {
    valueLabel.textContent = formatControlValue(control, value);
  }
  const input = card.querySelector('input, select');
  if (input) {
    if (input.type === 'checkbox') {
      input.checked = Boolean(Number(value));
    } else {
      input.value = value;
    }
  }
}

function createRangeControl(control) {
  const wrapper = document.createElement('div');
  wrapper.className = 'range-control';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = control.min;
  input.max = control.max;
  input.step = control.step || 1;
  input.value = control.value;
  input.addEventListener('input', () => {
    const value = Number(input.value);
    wrapper.dataset.value = value;
    wrapper.dispatchEvent(new CustomEvent('value-change', { detail: value }));
  });
  wrapper.appendChild(input);
  return { element: wrapper, input };
}

function createToggleControl(control) {
  const wrapper = document.createElement('label');
  wrapper.className = 'toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(control.value);
  const slider = document.createElement('span');
  input.addEventListener('change', () => {
    wrapper.dispatchEvent(new CustomEvent('value-change', { detail: input.checked ? 1 : 0 }));
  });
  wrapper.appendChild(input);
  wrapper.appendChild(slider);
  return { element: wrapper, input };
}

function createMenuControl(control) {
  const wrapper = document.createElement('div');
  wrapper.className = 'menu-control';
  const select = document.createElement('select');
  (control.menu || []).forEach((item) => {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    if (Number(control.value) === Number(item.value)) {
      option.selected = true;
    }
    select.appendChild(option);
  });
  select.addEventListener('change', () => {
    wrapper.dispatchEvent(new CustomEvent('value-change', { detail: Number(select.value) }));
  });
  wrapper.appendChild(select);
  return { element: wrapper, input: select };
}

function renderControls() {
  controlsList.innerHTML = '';
  state.controls.forEach((control) => {
    const card = document.createElement('div');
    card.className = 'control-card';
    card.dataset.control = control.name;
    if (Array.isArray(control.flags) && control.flags.includes('inactive')) {
      card.classList.add('disabled');
    }

    const header = document.createElement('header');
    const titleWrapper = document.createElement('div');
    titleWrapper.className = 'control-title';
    const icon = document.createElement('span');
    icon.className = 'control-icon';
    icon.textContent = controlIcons[control.name] || '🎛️';
    const title = document.createElement('span');
    title.textContent = humanize(control.name);
    titleWrapper.appendChild(icon);
    titleWrapper.appendChild(title);
    const valueLabel = document.createElement('span');
    valueLabel.className = 'control-value';
    valueLabel.textContent = formatControlValue(control, control.value);
    header.appendChild(titleWrapper);
    header.appendChild(valueLabel);

    let controlUI;
    if (control.type.includes('int')) {
      controlUI = createRangeControl(control);
    } else if (control.type.includes('bool')) {
      controlUI = createToggleControl(control);
    } else if (control.type.includes('menu')) {
      controlUI = createMenuControl(control);
    }

    if (!controlUI) return;

    controlUI.element.addEventListener('value-change', (event) => {
      const value = event.detail;
      valueLabel.textContent = formatControlValue(control, value);
      sendMessage({ type: 'set-control', name: control.name, value });
    });

    card.appendChild(header);
    card.appendChild(controlUI.element);
    controlsList.appendChild(card);
  });
}

function humanize(text) {
  return text
    .replace(/_/g, ' ')
    .replace(/\b(\w)/g, (match) => match.toUpperCase());
}

function formatControlValue(control, value) {
  if (control.type.includes('bool')) {
    return Number(value) === 1 ? 'ON' : 'OFF';
  }
  if (control.type.includes('menu')) {
    const option = (control.menu || []).find((item) => Number(item.value) === Number(value));
    return option ? option.label : value;
  }
  return value;
}

function initDrawer() {
  if (!drawerToggle || !drawer) return;
  drawerToggle.addEventListener('click', () => {
    drawer.classList.toggle('open');
  });
}

function initEvents() {
  if (zoomSlider) {
    zoomSlider.addEventListener('input', handleZoomSlider);
  }
  if (viewer) {
    viewer.addEventListener('pointerdown', handlePointerDown);
    viewer.addEventListener('pointermove', handlePointerMove);
    viewer.addEventListener('pointerup', handlePointerUp);
    viewer.addEventListener('pointerleave', handlePointerUp);
    viewer.addEventListener('pointercancel', handlePointerUp);
    viewer.addEventListener('wheel', handleWheel, { passive: false });
  }
  if (snapshotBtn) {
    snapshotBtn.addEventListener('click', handleSnapshot);
  }
  if (recordBtn) {
    recordBtn.addEventListener('click', handleRecordToggle);
  }
  bindROIMap();
  initDrawer();
}

if (stream) {
  stream.addEventListener('load', () => {
    const updateDimensions = () => {
      state.imageWidth = stream.naturalWidth;
      state.imageHeight = stream.naturalHeight;
      updateTransform();
      throttleROISend();
    };
    if (stream.naturalWidth && stream.naturalHeight) {
      updateDimensions();
    } else {
      const img = new Image();
      img.onload = () => {
        state.imageWidth = img.width;
        state.imageHeight = img.height;
        updateTransform();
        throttleROISend();
      };
      img.src = stream.src;
    }
  });
}

initEvents();
connectSocket();
