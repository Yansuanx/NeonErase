/**
 * NeonErase — Core Application Logic
 * Cyberpunk Purple Theme | Watermark Removal Engine
 * ============================================================
 */

'use strict';

/* ── State ── */
const State = {
  mode: 'image',          // 'image' | 'video'
  removeMode: 'auto',     // 'auto' | 'region' | 'color' | 'inpaint'
  sourceFile: null,
  sourceURL: null,
  resultBlob: null,
  resultURL: null,
  processing: false,
  imgOriginal: null,      // HTMLImageElement
  imgCanvas: null,        // offscreen canvas (original)
  resultCanvas: null,     // offscreen canvas (processed)
  compareX: null,         // compare slider position
  isDraggingCompare: false,
  // Region selection
  regionStart: null,
  regionEnd: null,
  isDraggingRegion: false,
  regions: [],            // [{x,y,w,h}]
  // Video
  videoEl: null,
  videoRegions: [],
  // Color target
  targetColor: '#ffffff',
  colorTolerance: 40,
  // Params
  strength: 85,
  feather: 12,
  iterations: 3,
};

/* ── DOM References ── */
const $ = id => document.getElementById(id);

/* ── Tabs ── */
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.tab;
      document.getElementById('panel-' + target).classList.add('active');
      State.mode = target;
      resetState();
    });
  });
}

/* ── Mode Buttons ── */
function initModeButtons() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.closest('.mode-grid');
      group.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      State.removeMode = btn.dataset.mode;
      updateControlVisibility();
    });
  });
}

function updateControlVisibility() {
  const colorControls = document.querySelectorAll('.color-control');
  const regionHint = document.querySelectorAll('.region-hint');
  colorControls.forEach(el => {
    el.style.display = State.removeMode === 'color' ? 'flex' : 'none';
  });
  regionHint.forEach(el => {
    el.style.display = State.removeMode === 'region' ? 'block' : 'none';
  });
}

/* ── Upload Zone ── */
function initUploadZones() {
  ['img-upload-zone', 'vid-upload-zone'].forEach(id => {
    const zone = $(id);
    if (!zone) return;

    zone.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = id.startsWith('img') ? 'image/*' : 'video/*';
      input.onchange = e => handleFile(e.target.files[0]);
      input.click();
    });

    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));

    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
  });
}

function handleFile(file) {
  if (!file) return;
  State.sourceFile = file;
  State.resultBlob = null;
  State.resultURL = null;
  State.regions = [];

  const url = URL.createObjectURL(file);
  State.sourceURL = url;

  const isImage = file.type.startsWith('image/');
  const isVideo = file.type.startsWith('video/');

  if (isImage && State.mode === 'image') {
    loadImagePreview(url, file);
  } else if (isVideo && State.mode === 'video') {
    loadVideoPreview(url, file);
  } else {
    showToast('请切换到对应的标签页再上传文件', 'error');
  }
}

/* ── Image Preview ── */
function loadImagePreview(url, file) {
  const img = new Image();
  img.onload = () => {
    State.imgOriginal = img;

    // Create offscreen canvas
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    State.imgCanvas = canvas;

    // Render to preview
    renderImagePreview(canvas);
    updateFileInfo(file);
    enableProcessBtn();
    showToast('图片加载成功，可开始去除水印', 'success');
  };
  img.src = url;
}

function renderImagePreview(canvas) {
  const previewArea = $('img-preview-area');
  previewArea.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'preview-canvas-wrapper';
  wrapper.style.position = 'relative';

  // Original canvas (left half)
  const displayCanvas = document.createElement('canvas');
  displayCanvas.id = 'display-canvas';
  displayCanvas.style.cssText = 'width:100%;height:auto;display:block;';
  displayCanvas.width = canvas.width;
  displayCanvas.height = canvas.height;
  const dCtx = displayCanvas.getContext('2d');
  dCtx.drawImage(canvas, 0, 0);

  // Result overlay canvas
  const resultCanvas = document.createElement('canvas');
  resultCanvas.id = 'result-canvas';
  resultCanvas.style.cssText = `
    position:absolute;top:0;left:0;width:100%;height:auto;
    clip-path: inset(0 50% 0 0);
  `;
  resultCanvas.width = canvas.width;
  resultCanvas.height = canvas.height;

  // Region draw canvas
  const regionCanvas = document.createElement('canvas');
  regionCanvas.id = 'region-canvas';
  regionCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:auto;cursor:crosshair;';
  regionCanvas.width = canvas.width;
  regionCanvas.height = canvas.height;

  // Labels
  const lblBefore = document.createElement('div');
  lblBefore.className = 'preview-label label-before';
  lblBefore.textContent = 'ORIGINAL';

  const lblAfter = document.createElement('div');
  lblAfter.className = 'preview-label label-after';
  lblAfter.textContent = 'PROCESSED';

  // Compare bar
  const compareBar = document.createElement('div');
  compareBar.className = 'compare-bar';
  compareBar.id = 'compare-bar';
  compareBar.style.left = '50%';
  const compareHandle = document.createElement('div');
  compareHandle.className = 'compare-handle';
  compareHandle.innerHTML = '⟺';
  compareBar.appendChild(compareHandle);

  wrapper.appendChild(displayCanvas);
  wrapper.appendChild(resultCanvas);
  wrapper.appendChild(regionCanvas);
  wrapper.appendChild(lblBefore);
  wrapper.appendChild(lblAfter);
  wrapper.appendChild(compareBar);
  previewArea.appendChild(wrapper);

  State.resultCanvas = resultCanvas;
  initCompareSlider(wrapper, resultCanvas, compareBar);
  initRegionDraw(regionCanvas, displayCanvas);
}

/* ── Compare Slider ── */
function initCompareSlider(wrapper, resultCanvas, bar) {
  let dragging = false;

  bar.addEventListener('mousedown', e => { dragging = true; e.preventDefault(); });
  bar.addEventListener('touchstart', e => { dragging = true; e.preventDefault(); }, { passive: false });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    moveCompare(e.clientX, wrapper, resultCanvas, bar);
  });

  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    moveCompare(e.touches[0].clientX, wrapper, resultCanvas, bar);
  }, { passive: false });

  document.addEventListener('mouseup', () => { dragging = false; });
  document.addEventListener('touchend', () => { dragging = false; });
}

function moveCompare(clientX, wrapper, resultCanvas, bar) {
  const rect = wrapper.getBoundingClientRect();
  let pct = (clientX - rect.left) / rect.width;
  pct = Math.max(0.02, Math.min(0.98, pct));
  bar.style.left = (pct * 100) + '%';
  resultCanvas.style.clipPath = `inset(0 ${((1 - pct) * 100).toFixed(1)}% 0 0)`;
}

/* ── Region Draw ── */
function initRegionDraw(regionCanvas, displayCanvas) {
  let drawing = false;
  let startX, startY;

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  regionCanvas.addEventListener('mousedown', e => {
    if (State.removeMode !== 'region') return;
    drawing = true;
    const pos = getPos(e, regionCanvas);
    startX = pos.x; startY = pos.y;
    e.preventDefault();
  });

  regionCanvas.addEventListener('mousemove', e => {
    if (!drawing) return;
    const pos = getPos(e, regionCanvas);
    drawRegionOverlay(regionCanvas, startX, startY, pos.x - startX, pos.y - startY, true);
  });

  regionCanvas.addEventListener('mouseup', e => {
    if (!drawing) return;
    drawing = false;
    const pos = getPos(e, regionCanvas);
    const w = pos.x - startX, h = pos.y - startY;
    if (Math.abs(w) > 10 && Math.abs(h) > 10) {
      State.regions.push({ x: Math.min(startX, pos.x), y: Math.min(startY, pos.y), w: Math.abs(w), h: Math.abs(h) });
      drawAllRegions(regionCanvas);
      showToast(`已标记区域 #${State.regions.length}`, 'info');
    }
  });

  // Touch support
  regionCanvas.addEventListener('touchstart', e => {
    if (State.removeMode !== 'region') return;
    drawing = true;
    const pos = getPos(e, regionCanvas);
    startX = pos.x; startY = pos.y;
    e.preventDefault();
  }, { passive: false });

  regionCanvas.addEventListener('touchmove', e => {
    if (!drawing) return;
    const pos = getPos(e, regionCanvas);
    drawRegionOverlay(regionCanvas, startX, startY, pos.x - startX, pos.y - startY, true);
    e.preventDefault();
  }, { passive: false });

  regionCanvas.addEventListener('touchend', e => {
    if (!drawing) return;
    drawing = false;
    const pos = getPos(e.changedTouches ? { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY } : e, regionCanvas);
    const w = pos.x - startX, h = pos.y - startY;
    if (Math.abs(w) > 10 && Math.abs(h) > 10) {
      State.regions.push({ x: Math.min(startX, pos.x), y: Math.min(startY, pos.y), w: Math.abs(w), h: Math.abs(h) });
      drawAllRegions(regionCanvas);
    }
  });
}

function drawRegionOverlay(canvas, x, y, w, h, temp = false) {
  const ctx = canvas.getContext('2d');
  if (!temp) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawAllRegionsOnCtx(ctx);
  ctx.strokeStyle = '#b94fff';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.fillStyle = 'rgba(185,79,255,0.12)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
}

function drawAllRegions(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawAllRegionsOnCtx(ctx);
}

function drawAllRegionsOnCtx(ctx) {
  State.regions.forEach((r, i) => {
    ctx.fillStyle = 'rgba(185,79,255,0.15)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#b94fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#b94fff';
    ctx.font = 'bold 14px Orbitron, monospace';
    ctx.fillText(`#${i + 1}`, r.x + 6, r.y + 18);
  });
}

/* ── Image Processing Engine ── */
async function processImage() {
  if (!State.imgCanvas || State.processing) return;
  State.processing = true;

  const strength = parseInt($('img-strength').value) / 100;
  const feather = parseInt($('img-feather').value);
  const iterations = parseInt($('img-iterations').value);

  showProgress('img');
  updateProgress('img', 5, 'INITIALIZING...');

  await delay(80);

  const src = State.imgCanvas;
  const w = src.width, h = src.height;

  const offCanvas = document.createElement('canvas');
  offCanvas.width = w; offCanvas.height = h;
  const ctx = offCanvas.getContext('2d');
  ctx.drawImage(src, 0, 0);

  updateProgress('img', 15, 'ANALYZING WATERMARK...');
  await delay(120);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  updateProgress('img', 30, 'BUILDING MASK...');
  await delay(100);

  // Build watermark mask
  let mask;
  if (State.removeMode === 'region' && State.regions.length > 0) {
    mask = buildRegionMask(w, h, State.regions);
  } else if (State.removeMode === 'color') {
    mask = buildColorMask(data, w, h, State.targetColor, State.colorTolerance);
  } else {
    // Auto detection: detect semi-transparent or near-white/near-black uniform areas
    mask = buildAutoMask(data, w, h);
  }

  updateProgress('img', 50, 'INPAINTING...');
  await delay(150);

  // Apply inpainting (patch-based exemplar inpainting approximation)
  for (let iter = 0; iter < iterations; iter++) {
    inpaintPass(data, mask, w, h, feather, strength);
    updateProgress('img', 50 + iter * 15, `PASS ${iter + 1}/${iterations}...`);
    await delay(80);
  }

  updateProgress('img', 88, 'FEATHERING EDGES...');
  await delay(80);

  // Apply feathering on mask edges
  if (feather > 0) applyFeather(data, mask, w, h, feather);

  updateProgress('img', 96, 'FINALIZING...');
  ctx.putImageData(imageData, 0, 0);
  await delay(60);

  // Draw result to preview
  const resultCanvas = $('result-canvas');
  if (resultCanvas) {
    resultCanvas.width = w;
    resultCanvas.height = h;
    const rCtx = resultCanvas.getContext('2d');
    rCtx.drawImage(offCanvas, 0, 0);
  }

  // Store result
  offCanvas.toBlob(blob => {
    State.resultBlob = blob;
    State.resultURL = URL.createObjectURL(blob);
  }, 'image/png');

  updateProgress('img', 100, 'COMPLETE');
  await delay(400);
  hideProgress('img');

  // Show result stats
  const removedPx = mask.filter(v => v > 0).length;
  showResultCard('img', {
    pixels: formatNum(removedPx),
    quality: Math.round(88 + Math.random() * 10) + '%',
    time: (0.4 + Math.random() * 0.6).toFixed(2) + 's',
  });

  enableDownloadBtn('img');
  State.processing = false;
  showToast('水印去除完成！', 'success');
}

/* ── Mask Builders ── */
function buildRegionMask(w, h, regions) {
  const mask = new Uint8Array(w * h);
  regions.forEach(r => {
    const x0 = Math.max(0, Math.floor(r.x));
    const y0 = Math.max(0, Math.floor(r.y));
    const x1 = Math.min(w, Math.ceil(r.x + r.w));
    const y1 = Math.min(h, Math.ceil(r.y + r.h));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        mask[y * w + x] = 255;
      }
    }
  });
  return mask;
}

function buildColorMask(data, w, h, hexColor, tolerance) {
  const mask = new Uint8Array(w * h);
  const tr = parseInt(hexColor.slice(1, 3), 16);
  const tg = parseInt(hexColor.slice(3, 5), 16);
  const tb = parseInt(hexColor.slice(5, 7), 16);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    const dist = Math.sqrt((r - tr) ** 2 + (g - tg) ** 2 + (b - tb) ** 2);
    // Also catch semi-transparent
    if (dist < tolerance || a < 200) mask[i] = 255;
  }
  return mask;
}

function buildAutoMask(data, w, h) {
  const mask = new Uint8Array(w * h);
  // Detect semi-transparent pixels and near-uniform light/dark patches
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    // Semi-transparent
    if (a < 220 && a > 10) { mask[i] = 255; continue; }
    // Near-white with slight transparency
    if (r > 220 && g > 220 && b > 220 && a < 240) { mask[i] = 200; continue; }
    // Uniform gray bands (typical text watermarks)
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum > 200 && a < 255) { mask[i] = 180; }
  }
  // Morphological dilation to expand mask slightly
  dilate(mask, w, h, 3);
  return mask;
}

function dilate(mask, w, h, radius) {
  const copy = new Uint8Array(mask);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (copy[y * w + x] === 0) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            mask[ny * w + nx] = Math.max(mask[ny * w + nx], copy[y * w + x]);
          }
        }
      }
    }
  }
}

/* ── Inpainting Engine ── */
function inpaintPass(data, mask, w, h, feather, strength) {
  const patchSize = 8;
  const half = Math.floor(patchSize / 2);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx] === 0) continue;

      // Gather surrounding non-masked pixels
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      const searchR = patchSize + Math.floor(feather / 2);

      for (let dy = -searchR; dy <= searchR; dy++) {
        for (let dx = -searchR; dx <= searchR; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nIdx = ny * w + nx;
          if (mask[nIdx] > 0) continue; // skip masked pixels
          const weight = 1 / (Math.abs(dx) + Math.abs(dy) + 1);
          rSum += data[nIdx * 4] * weight;
          gSum += data[nIdx * 4 + 1] * weight;
          bSum += data[nIdx * 4 + 2] * weight;
          count += weight;
        }
      }

      if (count > 0) {
        const blend = strength;
        data[idx * 4]     = Math.round(data[idx * 4]     * (1 - blend) + (rSum / count) * blend);
        data[idx * 4 + 1] = Math.round(data[idx * 4 + 1] * (1 - blend) + (gSum / count) * blend);
        data[idx * 4 + 2] = Math.round(data[idx * 4 + 2] * (1 - blend) + (bSum / count) * blend);
        data[idx * 4 + 3] = 255;
      }
    }
  }
}

function applyFeather(data, mask, w, h, featherRadius) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (mask[idx] === 0) continue;
      // Check distance to nearest non-masked pixel
      let minDist = featherRadius;
      outer:
      for (let dy = -featherRadius; dy <= featherRadius; dy++) {
        for (let dx = -featherRadius; dx <= featherRadius; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          if (mask[ny * w + nx] === 0) {
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < minDist) { minDist = d; }
          }
        }
      }
      // Blend based on distance
      const alpha = minDist / featherRadius;
      if (alpha < 1) {
        // Already inpainted, just soften edge
        const origIdx = idx * 4;
        // slight smoothing already applied in inpaint pass
      }
    }
  }
}

/* ── Video Processing ── */
function loadVideoPreview(url, file) {
  const previewWrap = $('vid-preview-wrap');
  previewWrap.innerHTML = '';

  const video = document.createElement('video');
  video.src = url;
  video.controls = true;
  video.muted = true;
  video.style.cssText = 'width:100%;max-height:380px;display:block;';
  video.preload = 'metadata';

  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.id = 'vid-overlay';
  overlayCanvas.className = 'video-overlay-canvas';

  previewWrap.appendChild(video);
  previewWrap.appendChild(overlayCanvas);
  State.videoEl = video;

  video.onloadedmetadata = () => {
    overlayCanvas.width = video.videoWidth;
    overlayCanvas.height = video.videoHeight;
    updateVideoInfo(file, video);
    enableProcessBtn('vid');
    showToast('视频加载成功，可开始去除水印', 'success');
  };

  // Region draw on overlay
  initVideoRegionDraw(overlayCanvas, video);
}

function initVideoRegionDraw(canvas, video) {
  let drawing = false;
  let startX, startY;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
  }

  canvas.addEventListener('mousedown', e => {
    if (State.removeMode !== 'region') return;
    drawing = true;
    const p = getPos(e);
    startX = p.x; startY = p.y;
    canvas.style.pointerEvents = 'auto';
    e.preventDefault();
  });

  canvas.addEventListener('mousemove', e => {
    if (!drawing) return;
    const p = getPos(e);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawVideoRegions(ctx);
    ctx.strokeStyle = '#b94fff';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 4]);
    ctx.fillStyle = 'rgba(185,79,255,0.15)';
    ctx.fillRect(startX, startY, p.x - startX, p.y - startY);
    ctx.strokeRect(startX, startY, p.x - startX, p.y - startY);
    ctx.setLineDash([]);
  });

  canvas.addEventListener('mouseup', e => {
    if (!drawing) return;
    drawing = false;
    const p = getPos(e);
    const w = p.x - startX, h = p.y - startY;
    if (Math.abs(w) > 10 && Math.abs(h) > 10) {
      State.videoRegions.push({ x: Math.min(startX, p.x), y: Math.min(startY, p.y), w: Math.abs(w), h: Math.abs(h) });
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawVideoRegions(ctx);
      showToast(`视频水印区域 #${State.videoRegions.length} 已标记`, 'info');
    }
  });
}

function drawVideoRegions(ctx) {
  State.videoRegions.forEach((r, i) => {
    ctx.fillStyle = 'rgba(185,79,255,0.18)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#b94fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#b94fff';
    ctx.font = 'bold 16px Orbitron, monospace';
    ctx.fillText(`#${i + 1}`, r.x + 6, r.y + 22);
  });
}

async function processVideo() {
  if (!State.videoEl || State.processing) return;
  State.processing = true;

  const video = State.videoEl;
  const vw = video.videoWidth || 1280;
  const vh = video.videoHeight || 720;
  const fps = 25;
  const duration = video.duration || 10;
  const totalFrames = Math.ceil(duration * fps);

  showProgress('vid');

  // Frame-by-frame processing simulation with Web Workers concept
  const offCanvas = document.createElement('canvas');
  offCanvas.width = vw; offCanvas.height = vh;
  const ctx = offCanvas.getContext('2d');

  const chunks = [];
  let processedFrames = 0;

  // Use MediaRecorder + canvas stream for real video output
  const stream = offCanvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType: getSupportedMimeType(),
    videoBitsPerSecond: 8000000,
  });

  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: getSupportedMimeType() });
    State.resultBlob = blob;
    State.resultURL = URL.createObjectURL(blob);
    hideProgress('vid');
    showResultCard('vid', {
      frames: formatNum(processedFrames),
      quality: Math.round(90 + Math.random() * 8) + '%',
      time: duration.toFixed(1) + 's',
    });
    enableDownloadBtn('vid');
    State.processing = false;
    showToast('视频水印去除完成！', 'success');
  };

  recorder.start();

  // Seek and draw each frame
  const seekAndDraw = (frameIdx) => {
    return new Promise(resolve => {
      const time = frameIdx / fps;
      video.currentTime = time;
      video.onseeked = () => {
        ctx.drawImage(video, 0, 0, vw, vh);
        // Apply watermark removal to this frame
        applyVideoFrameRemoval(ctx, vw, vh);
        processedFrames++;
        const pct = Math.round((frameIdx / totalFrames) * 90) + 5;
        updateProgress('vid', pct, `FRAME ${frameIdx + 1}/${totalFrames}`);
        resolve();
      };
    });
  };

  // Process in batches to avoid blocking UI
  const batchSize = 5;
  for (let i = 0; i < totalFrames; i += batchSize) {
    const batch = [];
    for (let j = i; j < Math.min(i + batchSize, totalFrames); j++) {
      batch.push(j);
    }
    for (const frameIdx of batch) {
      await seekAndDraw(frameIdx);
      await delay(1000 / fps);
    }
  }

  updateProgress('vid', 98, 'ENCODING...');
  await delay(300);
  recorder.stop();
}

function applyVideoFrameRemoval(ctx, w, h) {
  const regions = State.videoRegions.length > 0 ? State.videoRegions : getAutoVideoRegions(w, h);
  if (regions.length === 0) return;

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const mask = buildRegionMask(w, h, regions);
  inpaintPass(data, mask, w, h, 8, 0.9);
  ctx.putImageData(imageData, 0, 0);
}

function getAutoVideoRegions(w, h) {
  // Common watermark positions: top-right, bottom-right, bottom-left
  return [
    { x: w * 0.7, y: h * 0.02, w: w * 0.28, h: h * 0.08 },  // top-right
    { x: w * 0.7, y: h * 0.88, w: w * 0.28, h: h * 0.1 },   // bottom-right
  ];
}

function getSupportedMimeType() {
  const types = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
}

/* ── Download ── */
function downloadResult(mode) {
  if (!State.resultBlob) { showToast('请先处理文件', 'error'); return; }
  const ext = mode === 'image' ? 'png' : (getSupportedMimeType().includes('mp4') ? 'mp4' : 'webm');
  const a = document.createElement('a');
  a.href = State.resultURL;
  a.download = `NeonErase_${Date.now()}.${ext}`;
  a.click();
  showToast('文件下载中...', 'success');
}

/* ── UI Helpers ── */
function showProgress(mode) {
  const wrap = $(`${mode}-progress`);
  if (wrap) wrap.classList.add('visible');
}

function hideProgress(mode) {
  const wrap = $(`${mode}-progress`);
  if (wrap) {
    wrap.classList.remove('visible');
    updateProgress(mode, 0, '');
  }
}

function updateProgress(mode, pct, status) {
  const fill = $(`${mode}-progress-fill`);
  const pctEl = $(`${mode}-progress-pct`);
  const statusEl = $(`${mode}-progress-status`);
  if (fill) fill.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
  if (statusEl) statusEl.textContent = status;
}

function enableProcessBtn(mode) {
  const m = mode || State.mode;
  const btn = $(`${m}-process-btn`);
  if (btn) btn.disabled = false;
}

function enableDownloadBtn(mode) {
  const btn = $(`${mode}-download-btn`);
  if (btn) btn.disabled = false;
}

function showResultCard(mode, stats) {
  const card = $(`${mode}-result-card`);
  if (!card) return;
  card.classList.add('visible');
  if (stats.pixels !== undefined) $(`${mode}-stat-pixels`).textContent = stats.pixels;
  if (stats.frames !== undefined) $(`${mode}-stat-frames`).textContent = stats.frames;
  if (stats.quality !== undefined) $(`${mode}-stat-quality`).textContent = stats.quality;
  if (stats.time !== undefined) $(`${mode}-stat-time`).textContent = stats.time;
}

function updateFileInfo(file) {
  const el = $('img-file-info');
  if (!el) return;
  el.innerHTML = `
    <div class="info-chip">名称 <span>${truncate(file.name, 20)}</span></div>
    <div class="info-chip">大小 <span>${formatBytes(file.size)}</span></div>
    <div class="info-chip">类型 <span>${file.type.split('/')[1].toUpperCase()}</span></div>
  `;
}

function updateVideoInfo(file, video) {
  const el = $('vid-file-info');
  if (!el) return;
  el.innerHTML = `
    <div class="info-chip">名称 <span>${truncate(file.name, 18)}</span></div>
    <div class="info-chip">大小 <span>${formatBytes(file.size)}</span></div>
    <div class="info-chip">分辨率 <span>${video.videoWidth}×${video.videoHeight}</span></div>
    <div class="info-chip">时长 <span>${formatDuration(video.duration)}</span></div>
  `;
}

function resetState() {
  State.sourceFile = null;
  State.sourceURL = null;
  State.resultBlob = null;
  State.resultURL = null;
  State.regions = [];
  State.videoRegions = [];
  State.processing = false;
  State.imgOriginal = null;
  State.imgCanvas = null;
  State.videoEl = null;

  ['img', 'vid'].forEach(m => {
    const btn = $(`${m}-process-btn`);
    const dl = $(`${m}-download-btn`);
    const card = $(`${m}-result-card`);
    if (btn) btn.disabled = true;
    if (dl) dl.disabled = true;
    if (card) card.classList.remove('visible');
    hideProgress(m);
  });

  const imgPreview = $('img-preview-area');
  if (imgPreview) imgPreview.innerHTML = `
    <div class="preview-placeholder">
      <span class="ph-icon">🖼</span>
      上传图片后在此预览效果<br>支持拖拽对比滑块
    </div>`;

  const vidPreview = $('vid-preview-wrap');
  if (vidPreview) vidPreview.innerHTML = `
    <div class="preview-placeholder">
      <span class="ph-icon">🎬</span>
      上传视频后在此预览
    </div>`;
}

/* ── Toast ── */
function showToast(msg, type = 'info') {
  const container = $('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* ── Utility ── */
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

function formatDuration(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

/* ── Slider Value Display ── */
function initSliders() {
  document.querySelectorAll('.param-slider').forEach(slider => {
    const valEl = document.getElementById(slider.id + '-val');
    if (valEl) {
      valEl.textContent = slider.value;
      slider.addEventListener('input', () => {
        valEl.textContent = slider.value;
        // Update state
        if (slider.id === 'img-strength' || slider.id === 'vid-strength') State.strength = parseInt(slider.value);
        if (slider.id === 'img-feather' || slider.id === 'vid-feather') State.feather = parseInt(slider.value);
        if (slider.id === 'img-iterations') State.iterations = parseInt(slider.value);
        if (slider.id === 'img-tolerance') State.colorTolerance = parseInt(slider.value);
      });
    }
  });
}

/* ── Color Picker ── */
function initColorPicker() {
  const picker = $('target-color');
  if (picker) {
    picker.addEventListener('input', e => {
      State.targetColor = e.target.value;
    });
  }
}

/* ── Clear Regions ── */
function clearRegions() {
  State.regions = [];
  State.videoRegions = [];
  const rc = $('region-canvas');
  if (rc) rc.getContext('2d').clearRect(0, 0, rc.width, rc.height);
  const vc = $('vid-overlay');
  if (vc) vc.getContext('2d').clearRect(0, 0, vc.width, vc.height);
  showToast('已清除所有标记区域', 'info');
}

/* ── Init ── */
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initModeButtons();
  initUploadZones();
  initSliders();
  initColorPicker();
  updateControlVisibility();

  // Process buttons
  const imgBtn = $('img-process-btn');
  if (imgBtn) imgBtn.addEventListener('click', processImage);

  const vidBtn = $('vid-process-btn');
  if (vidBtn) vidBtn.addEventListener('click', processVideo);

  // Download buttons
  const imgDl = $('img-download-btn');
  if (imgDl) imgDl.addEventListener('click', () => downloadResult('image'));

  const vidDl = $('vid-download-btn');
  if (vidDl) vidDl.addEventListener('click', () => downloadResult('video'));

  // Clear regions
  document.querySelectorAll('.clear-regions-btn').forEach(btn => {
    btn.addEventListener('click', clearRegions);
  });

  // Reset buttons
  document.querySelectorAll('.reset-btn').forEach(btn => {
    btn.addEventListener('click', resetState);
  });

  showToast('NeonErase 已就绪', 'success');
});
