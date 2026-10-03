# 30-Band Equalizer — Chrome Extension

**Author:** Publio Santos

A Chrome extension that adds a real-time 30-band graphic equalizer to any audio or video playing in the browser, using the Web Audio API.

> Read this in [Portuguese](README.pt-BR.md).

## Features

- **30 bands**, 25 Hz to 20 kHz, ±12 dB per band (standard graphic-EQ layout).
- **Curve drag**: click and drag across the graph to draw a curve — the sliders follow it, with smooth interpolation between bands.
- **Presets**: save, load and delete named EQ curves.
- **Master Gain**: optional manual gain stage (-24…+24 dB), applied after the Dolby stage to avoid overdriving it.
- **AGC (Automatic Gain Control)**: continuously measures loudness (RMS) and nudges the gain toward a target level over time, instead of hard-limiting.
- **Dolby-style simulator** *(unofficial, not licensed Dolby processing)*: high-shelf brightness boost + soft harmonic saturation + a slight stereo widening (Haas effect).
- **Per-band VU meter**: 30-channel meter with 200 ms peak-hold, reading the signal *after* all processing (EQ, Dolby, Gain, AGC) via dedicated narrow bandpass taps — reflects what's actually sent to the speakers.

## How it works

A content script attaches a Web Audio graph to every `<audio>`/`<video>` element on the page:

```
source → 30× peaking EQ filters → Dolby high-shelf → Dolby waveshaper
       → stereo widener (split/delay/merge) → master gain → AGC gain → destination
```

Settings are stored in `chrome.storage.local` and applied live to every open tab.

## Install (unpacked / local use)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open any page with audio/video, click the extension icon, and adjust the bands.

## Limitations

- Audio inside cross-origin `<iframe>`s is not controlled by the top-frame content script.
- The Dolby simulator is a from-scratch Web Audio approximation, not Dolby-licensed technology.

## License

Licensed under the [GNU General Public License v3.0](LICENSE).
