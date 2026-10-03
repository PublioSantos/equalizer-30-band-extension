(() => {
  if (window.__eq30_injected__) return;
  window.__eq30_injected__ = true;

  const FREQS = [
    25, 31, 40, 50, 62, 80, 100, 125, 160, 200,
    250, 320, 400, 500, 640, 800, 1000, 1300, 1600, 2000,
    2500, 3150, 4000, 5000, 6200, 8000, 10000, 13000, 16000, 20000
  ];

  const AGC_TARGET_DB = -20;
  const AGC_MAX_ADJUST_DB = 12;
  const AGC_STEP_DB = 0.4;

  let audioCtx = null;
  let gains = new Array(FREQS.length).fill(0);
  let fx = { masterGainOn: false, masterGainDb: 0, agcOn: false, dolbyOn: false };
  const chains = new Map(); // mediaElement -> chain

  function getCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
  }

  function dbToLinear(db) {
    return Math.pow(10, db / 20);
  }

  function makeDolbyCurve(amount = 24) {
    const n = 1024;
    const curve = new Float32Array(n);
    // Unnormalized, this formula's slope at x=0 is (PI+amount)/PI — around
    // 8.6x (~+19 dB) for amount=24 — so quiet signal would get boosted
    // instead of just having its peaks softly saturated. Normalize so the
    // curve passes small signals near unity gain and only compresses peaks.
    const slopeAtZero = (Math.PI + amount) / Math.PI;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = (((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x))) / slopeAtZero;
    }
    return curve;
  }
  const DOLBY_CURVE = makeDolbyCurve();

  function buildChain(el) {
    if (chains.has(el)) return chains.get(el);
    const ctx = getCtx();
    let source;
    try {
      source = ctx.createMediaElementSource(el);
    } catch (e) {
      return null;
    }

    const filters = FREQS.map((freq, i) => {
      const f = ctx.createBiquadFilter();
      f.type = "peaking";
      f.frequency.value = freq;
      f.Q.value = 1.4;
      f.gain.value = gains[i];
      return f;
    });

    const bandTimeData = new Float32Array(256);

    const masterGain = ctx.createGain();
    masterGain.gain.value = 1;

    const dolbyShelf = ctx.createBiquadFilter();
    dolbyShelf.type = "highshelf";
    dolbyShelf.frequency.value = 8000;
    dolbyShelf.gain.value = 0;

    const dolbyShaper = ctx.createWaveShaper();
    dolbyShaper.curve = null;
    dolbyShaper.oversample = "2x";

    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const delayL = ctx.createDelay(0.05);
    const delayR = ctx.createDelay(0.05);
    delayL.delayTime.value = 0;
    delayR.delayTime.value = 0;

    const agcGain = ctx.createGain();
    agcGain.gain.value = 1;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;

    // chain: source -> filters -> dolbyShelf -> dolbyShaper -> splitter -> (delayL/delayR)
    //        -> merger -> masterGain -> agcGain -> analyser -> destination
    // masterGain sits AFTER the Dolby saturation stage so manual gain boosts
    // don't overdrive the waveshaper into harsh clipping.
    source.connect(filters[0]);
    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
    filters[filters.length - 1].connect(dolbyShelf);
    dolbyShelf.connect(dolbyShaper);
    dolbyShaper.connect(splitter);
    splitter.connect(delayL, 0);
    splitter.connect(delayR, 1 % splitter.numberOfOutputs);
    delayL.connect(merger, 0, 0);
    delayR.connect(merger, 0, 1);
    merger.connect(masterGain);
    masterGain.connect(agcGain);
    agcGain.connect(analyser);
    analyser.connect(ctx.destination);

    // per-band VU taps: dedicated narrow bandpass filters read from the
    // final post-processing output (after EQ, Dolby, master gain and AGC),
    // so the meter reflects what's actually being sent to the speakers,
    // not the raw signal before those adjustments. They feed only the
    // analysers, never the main output.
    const bandAnalysers = FREQS.map((freq) => {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = freq;
      bp.Q.value = 4.5;
      agcGain.connect(bp);
      const a = ctx.createAnalyser();
      a.fftSize = 256;
      bp.connect(a);
      return a;
    });

    const timeData = new Float32Array(analyser.fftSize);
    const agcTimer = setInterval(() => tickAgc(chain), 100);

    const chain = {
      source, filters, masterGain, dolbyShelf, dolbyShaper,
      splitter, delayL, delayR, merger, agcGain, analyser, timeData, agcTimer,
      bandAnalysers, bandTimeData,
    };
    chains.set(el, chain);
    applyFxToChain(chain);
    return chain;
  }

  function tickAgc(chain) {
    if (!chain || audioCtx.state !== "running") return;
    chain.analyser.getFloatTimeDomainData(chain.timeData);
    let sumSq = 0;
    for (let i = 0; i < chain.timeData.length; i++) sumSq += chain.timeData[i] * chain.timeData[i];
    const rms = Math.sqrt(sumSq / chain.timeData.length);
    const currentDb = rms > 0 ? 20 * Math.log10(rms) : -100;

    const g = chain.agcGain.gain;
    if (fx.agcOn && currentDb > -90) {
      const errorDb = AGC_TARGET_DB - currentDb;
      const stepDb = Math.max(-AGC_STEP_DB, Math.min(AGC_STEP_DB, errorDb));
      const currentGainDb = 20 * Math.log10(g.value);
      const nextGainDb = Math.max(-AGC_MAX_ADJUST_DB, Math.min(AGC_MAX_ADJUST_DB, currentGainDb + stepDb));
      g.setTargetAtTime(dbToLinear(nextGainDb), audioCtx.currentTime, 0.15);
    } else if (!fx.agcOn && Math.abs(g.value - 1) > 0.002) {
      g.setTargetAtTime(1, audioCtx.currentTime, 0.2);
    }
  }

  function getLevelsDb() {
    const levels = new Array(FREQS.length).fill(-100);
    for (const chain of chains.values()) {
      chain.bandAnalysers.forEach((a, i) => {
        a.getFloatTimeDomainData(chain.bandTimeData);
        let sumSq = 0;
        for (let s = 0; s < chain.bandTimeData.length; s++) sumSq += chain.bandTimeData[s] * chain.bandTimeData[s];
        const rms = Math.sqrt(sumSq / chain.bandTimeData.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : -100;
        if (db > levels[i]) levels[i] = db;
      });
    }
    return levels;
  }

  function applyGains() {
    for (const chain of chains.values()) {
      chain.filters.forEach((f, i) => {
        f.gain.value = gains[i];
      });
    }
  }

  function applyFxToChain(chain) {
    chain.masterGain.gain.value = fx.masterGainOn ? dbToLinear(fx.masterGainDb) : 1;
    chain.dolbyShelf.gain.value = fx.dolbyOn ? 5 : 0;
    chain.dolbyShaper.curve = fx.dolbyOn ? DOLBY_CURVE : null;
    chain.delayR.delayTime.value = fx.dolbyOn ? 0.012 : 0;
  }

  function applyFx() {
    for (const chain of chains.values()) applyFxToChain(chain);
  }

  function attachAll() {
    document.querySelectorAll("audio, video").forEach((el) => {
      buildChain(el);
    });
  }

  function resumeCtx() {
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  }

  const observer = new MutationObserver(() => attachAll());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("play", (e) => {
    const el = e.target;
    if (el && (el.tagName === "AUDIO" || el.tagName === "VIDEO")) {
      buildChain(el);
      resumeCtx();
    }
  }, true);

  ["click", "keydown"].forEach((evt) => {
    document.addEventListener(evt, resumeCtx, { once: true, capture: true });
  });

  attachAll();

  function loadSettings() {
    chrome.storage.local.get(["eq30_gains", "eq30_fx"], (res) => {
      if (res.eq30_gains && Array.isArray(res.eq30_gains) && res.eq30_gains.length === FREQS.length) {
        gains = res.eq30_gains.slice();
        applyGains();
      }
      if (res.eq30_fx) {
        fx = Object.assign(fx, res.eq30_fx);
        applyFx();
      }
    });
  }
  loadSettings();

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "EQ30_SET_GAINS") {
      gains = msg.gains.slice();
      applyGains();
      sendResponse && sendResponse({ ok: true });
    } else if (msg && msg.type === "EQ30_SET_FX") {
      fx = Object.assign(fx, msg.fx);
      applyFx();
      sendResponse && sendResponse({ ok: true });
    } else if (msg && msg.type === "EQ30_GET_GAINS") {
      sendResponse && sendResponse({ gains, fx });
    } else if (msg && msg.type === "EQ30_GET_LEVELS") {
      sendResponse && sendResponse({ levels: getLevelsDb() });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.eq30_gains) {
      gains = changes.eq30_gains.newValue.slice();
      applyGains();
    }
    if (changes.eq30_fx) {
      fx = Object.assign(fx, changes.eq30_fx.newValue);
      applyFx();
    }
  });
})();
