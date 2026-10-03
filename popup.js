const FREQS = [
  25, 31, 40, 50, 62, 80, 100, 125, 160, 200,
  250, 320, 400, 500, 640, 800, 1000, 1300, 1600, 2000,
  2500, 3150, 4000, 5000, 6200, 8000, 10000, 13000, 16000, 20000
];
const MIN_DB = -6;
const MAX_DB = 6;

function fmtFreq(f) {
  if (f >= 1000) {
    const k = f / 1000;
    return (k % 1 === 0 ? k.toFixed(0) : k.toFixed(2).replace(/0$/, "")) + "k";
  }
  return String(f);
}

const bandsEl = document.getElementById("bands");
const canvas = document.getElementById("curve");
const ctx = canvas.getContext("2d");
let gains = new Array(FREQS.length).fill(0);
let fx = { masterGainOn: false, masterGainDb: 0, agcOn: false, enhanceOn: false };
let sliders = [];
let vals = [];
let applyTimer = null;
let fxApplyTimer = null;

function dbToY(db, h) {
  const t = (MAX_DB - db) / (MAX_DB - MIN_DB); // 0 at +12, 1 at -12
  return t * h;
}
function yToDb(y, h) {
  const t = Math.min(1, Math.max(0, y / h));
  return MAX_DB - t * (MAX_DB - MIN_DB);
}
function bandX(i, w) {
  return (i + 0.5) * (w / FREQS.length);
}

function syncCanvasSize() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width);
  canvas.height = Math.round(rect.height);
}

function drawCurve() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // grid
  ctx.strokeStyle = "#2a2a2a";
  ctx.lineWidth = 1;
  [MIN_DB, -6, 0, 6, MAX_DB].forEach((db) => {
    const y = dbToY(db, h);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  });
  // zero line highlighted
  ctx.strokeStyle = "#444";
  const y0 = dbToY(0, h);
  ctx.beginPath();
  ctx.moveTo(0, y0);
  ctx.lineTo(w, y0);
  ctx.stroke();

  // curve line through band points
  ctx.strokeStyle = "#4caf50";
  ctx.lineWidth = 2;
  ctx.beginPath();
  FREQS.forEach((f, i) => {
    const x = bandX(i, w);
    const y = dbToY(gains[i], h);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // dots
  ctx.fillStyle = "#8ee89a";
  FREQS.forEach((f, i) => {
    const x = bandX(i, w);
    const y = dbToY(gains[i], h);
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function render() {
  bandsEl.innerHTML = "";
  sliders = [];
  vals = [];
  FREQS.forEach((freq, i) => {
    const band = document.createElement("div");
    band.className = "band";

    const val = document.createElement("div");
    val.className = "val";
    val.textContent = gains[i].toFixed(0);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(MIN_DB);
    slider.max = String(MAX_DB);
    slider.step = "1";
    slider.value = String(gains[i]);
    slider.addEventListener("input", () => {
      gains[i] = parseFloat(slider.value);
      val.textContent = gains[i].toFixed(0);
      drawCurve();
      scheduleApply();
    });

    const label = document.createElement("div");
    label.className = "freq";
    label.textContent = fmtFreq(freq);

    band.appendChild(val);
    band.appendChild(slider);
    band.appendChild(label);
    bandsEl.appendChild(band);

    sliders.push(slider);
    vals.push(val);
  });
}

function updateSlidersFromGains() {
  for (let i = 0; i < FREQS.length; i++) {
    sliders[i].value = String(gains[i]);
    vals[i].textContent = gains[i].toFixed(0);
  }
}

function scheduleApply() {
  chrome.storage.local.set({ eq30_gains: gains });
  if (applyTimer) return;
  applyTimer = setTimeout(() => {
    applyTimer = null;
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { type: "EQ30_SET_GAINS", gains }, () => {
          void chrome.runtime.lastError;
        });
      });
    });
  }, 40);
}

// --- curve drag logic ---
let dragging = false;
let lastPoint = null; // {x, y} in canvas pixel space

function setGainsAlongSegment(p0, p1) {
  const w = canvas.width;
  const h = canvas.height;
  const x0 = Math.min(p0.x, p1.x);
  const x1 = Math.max(p0.x, p1.x);
  // iterate every band whose center lies within [x0, x1] (inclusive, with small epsilon)
  for (let i = 0; i < FREQS.length; i++) {
    const bx = bandX(i, w);
    if (bx < x0 - 0.001 || bx > x1 + 0.001) continue;
    const t = x1 === x0 ? 0 : (bx - p0.x) / (p1.x - p0.x);
    const y = p0.y + t * (p1.y - p0.y);
    const db = Math.round(yToDb(y, h));
    gains[i] = Math.max(MIN_DB, Math.min(MAX_DB, db));
  }
}

function pointFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}

canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  canvas.setPointerCapture(e.pointerId);
  const p = pointFromEvent(e);
  lastPoint = p;
  setGainsAlongSegment(p, p);
  updateSlidersFromGains();
  drawCurve();
  scheduleApply();
});

canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const p = pointFromEvent(e);
  setGainsAlongSegment(lastPoint, p);
  lastPoint = p;
  updateSlidersFromGains();
  drawCurve();
  scheduleApply();
});

function endDrag(e) {
  if (!dragging) return;
  dragging = false;
  lastPoint = null;
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("pointerleave", (e) => {
  if (dragging) endDrag(e);
});

document.getElementById("reset").addEventListener("click", () => {
  gains = new Array(FREQS.length).fill(0);
  updateSlidersFromGains();
  drawCurve();
  scheduleApply();
});

// --- FX: GainNode, AGC, Enhance simulator ---
const fxGainBtn = document.getElementById("fxGain");
const fxAgcBtn = document.getElementById("fxAgc");
const fxEnhanceBtn = document.getElementById("fxEnhance");
const gainSliderWrap = document.getElementById("gainSliderWrap");
const gainSlider = document.getElementById("gainSlider");
const gainSliderVal = document.getElementById("gainSliderVal");

function scheduleApplyFx() {
  chrome.storage.local.set({ eq30_fx: fx });
  if (fxApplyTimer) return;
  fxApplyTimer = setTimeout(() => {
    fxApplyTimer = null;
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, { type: "EQ30_SET_FX", fx }, () => {
          void chrome.runtime.lastError;
        });
      });
    });
  }, 40);
}

function renderFxButtons() {
  fxGainBtn.classList.toggle("active", fx.masterGainOn);
  fxAgcBtn.classList.toggle("active", fx.agcOn);
  fxEnhanceBtn.classList.toggle("active", fx.enhanceOn);
  gainSliderWrap.classList.toggle("visible", fx.masterGainOn);
  gainSlider.value = String(fx.masterGainDb);
  gainSliderVal.textContent = `${fx.masterGainDb} dB`;
}

fxGainBtn.addEventListener("click", () => {
  fx.masterGainOn = !fx.masterGainOn;
  renderFxButtons();
  scheduleApplyFx();
});
fxAgcBtn.addEventListener("click", () => {
  fx.agcOn = !fx.agcOn;
  renderFxButtons();
  scheduleApplyFx();
});
fxEnhanceBtn.addEventListener("click", () => {
  fx.enhanceOn = !fx.enhanceOn;
  renderFxButtons();
  scheduleApplyFx();
});
gainSlider.addEventListener("input", () => {
  fx.masterGainDb = parseFloat(gainSlider.value);
  gainSliderVal.textContent = `${fx.masterGainDb} dB`;
  scheduleApplyFx();
});

// --- presets: save / load / delete curves ---
const presetSelect = document.getElementById("presetSelect");

function refreshPresetSelect(selected) {
  chrome.storage.local.get(["eq30_presets"], (res) => {
    const presets = res.eq30_presets || {};
    presetSelect.innerHTML = '<option value="">Curvas salvas…</option>';
    Object.keys(presets).sort().forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      presetSelect.appendChild(opt);
    });
    if (selected) presetSelect.value = selected;
  });
}

document.getElementById("presetSave").addEventListener("click", () => {
  const name = prompt("Nome da curva:");
  if (!name) return;
  chrome.storage.local.get(["eq30_presets"], (res) => {
    const presets = res.eq30_presets || {};
    presets[name] = { gains: gains.slice(), fx: Object.assign({}, fx) };
    chrome.storage.local.set({ eq30_presets: presets }, () => {
      refreshPresetSelect(name);
    });
  });
});

document.getElementById("presetLoad").addEventListener("click", () => {
  const name = presetSelect.value;
  if (!name) return;
  chrome.storage.local.get(["eq30_presets"], (res) => {
    const presets = res.eq30_presets || {};
    const preset = presets[name];
    if (!preset) return;
    gains = preset.gains.slice();
    fx = Object.assign({ masterGainOn: false, masterGainDb: 0, agcOn: false, enhanceOn: false }, preset.fx || {});
    updateSlidersFromGains();
    drawCurve();
    renderFxButtons();
    scheduleApply();
    scheduleApplyFx();
  });
});

document.getElementById("presetDelete").addEventListener("click", () => {
  const name = presetSelect.value;
  if (!name) return;
  if (!confirm(`Excluir a curva "${name}"?`)) return;
  chrome.storage.local.get(["eq30_presets"], (res) => {
    const presets = res.eq30_presets || {};
    delete presets[name];
    chrome.storage.local.set({ eq30_presets: presets }, () => {
      refreshPresetSelect();
    });
  });
});

// --- VU meter with 200ms peak-hold per band ---
const vuCanvas = document.getElementById("vu");
const vuCtx = vuCanvas.getContext("2d");
const VU_MIN_DB = -60;
const VU_MAX_DB = 0;
const PEAK_HOLD_MS = 200;
const PEAK_FALL_DB_PER_S = 24;
let peakLevel = new Array(FREQS.length).fill(VU_MIN_DB);
let peakHeldAt = new Array(FREQS.length).fill(0);
let activeTabId = null;

function syncVuCanvasSize() {
  const rect = vuCanvas.getBoundingClientRect();
  vuCanvas.width = Math.round(rect.width);
  vuCanvas.height = Math.round(rect.height);
}

function dbToVuHeight(db, h) {
  const t = Math.min(1, Math.max(0, (db - VU_MIN_DB) / (VU_MAX_DB - VU_MIN_DB)));
  return t * h;
}

function drawVu(levels) {
  const w = vuCanvas.width;
  const h = vuCanvas.height;
  vuCtx.clearRect(0, 0, w, h);
  const colW = w / FREQS.length;
  const now = performance.now();

  FREQS.forEach((f, i) => {
    const db = levels ? levels[i] : VU_MIN_DB;

    if (db >= peakLevel[i]) {
      peakLevel[i] = db;
      peakHeldAt[i] = now;
    } else if (now - peakHeldAt[i] > PEAK_HOLD_MS) {
      const dt = (now - (peakHeldAt[i] + PEAK_HOLD_MS)) / 1000;
      const fallen = peakLevel[i] - PEAK_FALL_DB_PER_S * Math.max(0, dt);
      peakLevel[i] = Math.max(db, fallen, VU_MIN_DB);
    }

    const x = i * colW + 1;
    const barW = colW - 2;
    const barH = dbToVuHeight(db, h);
    const grad = vuCtx.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, "#4caf50");
    grad.addColorStop(0.7, "#c9c93a");
    grad.addColorStop(1, "#e04b3f");
    vuCtx.fillStyle = grad;
    vuCtx.fillRect(x, h - barH, barW, barH);

    const peakY = h - dbToVuHeight(peakLevel[i], h);
    vuCtx.fillStyle = "#fff";
    vuCtx.fillRect(x, Math.max(0, peakY - 1), barW, 2);
  });
}

function pollVu() {
  if (activeTabId != null) {
    chrome.tabs.sendMessage(activeTabId, { type: "EQ30_GET_LEVELS" }, (res) => {
      if (chrome.runtime.lastError) {
        drawVu(null);
        return;
      }
      drawVu(res && res.levels);
    });
  } else {
    drawVu(null);
  }
}

chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
  if (tabs && tabs[0]) activeTabId = tabs[0].id;
});

syncVuCanvasSize();
setInterval(pollVu, 60);

chrome.storage.local.get(["eq30_gains", "eq30_fx"], (res) => {
  if (res.eq30_gains && Array.isArray(res.eq30_gains) && res.eq30_gains.length === FREQS.length) {
    gains = res.eq30_gains.slice();
  }
  if (res.eq30_fx) {
    fx = Object.assign(fx, res.eq30_fx);
  }
  render();
  syncCanvasSize();
  drawCurve();
  renderFxButtons();
  refreshPresetSelect();
  window.addEventListener("resize", () => {
    syncCanvasSize();
    drawCurve();
    syncVuCanvasSize();
  });
});
