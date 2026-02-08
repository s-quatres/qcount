# 8-Count Beat Counter App

## Overview
A web-based app that loads MP3 files, analyzes them offline across 8 frequency bands, detects beats per-band, validates 8-count phrase distribution, and plays the music with a scrolling multi-channel visualization and synchronized voice counting. Designed for dancers practicing with swing music.

## File Structure
```
index.html              — HTML + CSS only (614 lines)
js/
  app.js                — Class definition, constructor, UI/playback/utility methods
  fft.js                — Static FFT function (radix-2 Cooley-Tukey)
  analysis.js           — Core analysis pipeline (processSong, filterBand, envelope, beats, BPM, validation)
  analysis-harmony.js   — Harmony mode: chromagram (STFT), beat-sync chroma distance, phrase offset
  analysis-rhythm.js    — Rhythm mode: per-band onset density pattern
  analysis-combined.js  — Combined mode: multi-feature weighted voting + getPhraseOffsetForMethod
  visualization.js      — All drawing: setupCanvas, baseLayer (chroma+energy), overlays, beat markers
  init.js               — Bootstrap: new BeatCounterApp() on window load
```

### Pattern
Single class `BeatCounterApp` defined in app.js, extended via prototype assignment in other files:
```js
// app.js
class BeatCounterApp { constructor() { ... } }
// other files
BeatCounterApp.prototype.methodName = function() { ... };
```
Script tags in index.html must load app.js first, then method files, then init.js last.

## Architecture

### Core Flow
```
MP3 File → Web Audio API (decodeAudioData)
                ↓
        For each of 8 frequency bands:
          OfflineAudioContext + BiquadFilter (bandpass)
                    ↓
          Filtered AudioBuffer → Energy Envelope (RMS per 10ms)
                    ↓
          Beat Detection (spectral flux on envelope)
                    ↓
          8-Count Validation + Phrase Alignment
                    ↓
        Store per-band: { envelope, beats, phraseOffset }
                ↓
        Canvas Visualization (30s scrolling window, 8 channels)
                ↓
        Playback with Scheduled Counts (from bass band)
                ↓
        Speech Synthesis (count aloud 1-8)
```

### Key Classes
- `BeatCounterApp` - Main class containing all logic

### 8 Frequency Bands (Octave Split)
| Band | Name | Center Hz | Range Hz | Color |
|------|------|-----------|----------|-------|
| 1 | Sub-Bass | 31.5 | 20-45 | #ff6b6b (red) |
| 2 | Bass | 63 | 45-90 | #ffa502 (orange) |
| 3 | Low-Mid | 125 | 90-180 | #ffd93d (yellow) |
| 4 | Mid | 250 | 180-355 | #6bcb77 (green) |
| 5 | Upper-Mid | 500 | 355-710 | #4d96ff (blue) |
| 6 | Presence | 1000 | 710-1400 | #9b59b6 (purple) |
| 7 | Brilliance | 2000 | 1400-2800 | #e056a0 (pink) |
| 8 | Air | 4000 | 2800-5600 | #00d2d3 (cyan) |

### Per-Band Analysis Pipeline
1. `filterBand()` - OfflineAudioContext with BiquadFilter (bandpass) isolates frequency range
2. `computeEnvelope()` - RMS energy per 10ms frame on filtered signal
3. `detectBandBeats()` - Spectral flux on envelope, peak picking with adaptive threshold
4. `estimateBpm()` - Histogram + median interval refinement
5. `validate8Counts()` - Grid fitting, gap filling, snap to detected beats
6. `findBandPhraseAlignment()` - Find offset (0-7) where strong energy aligns with beat 1

### Canvas Visualization
- 8 stacked horizontal strips (70px each), one per frequency band
- 30-second window centered on current playback position (15s past, 15s future)
- Energy envelope drawn as filled area with stroke outline
- Beat markers: thin vertical lines on each channel
- Phrase-start markers (beat 1): thicker, brighter lines with "1" label
- Playhead: dashed white vertical line at center
- Time labels every 5 seconds
- Click to seek

### Beat Detection (Per-Band)
1. Audio filtered to band via BiquadFilter (bandpass, Q = center/bandwidth)
2. Energy envelope: RMS per 10ms frame (20ms window, 10ms hop)
3. **Spectral Flux**: `flux = max(0, currentEnergy - previousEnergy)`
4. Normalize flux values to 0-1 range
5. Peak picking with adaptive threshold (local average + 0.3)
6. Minimum 0.2s between beats (300 BPM max)

### BPM Detection
1. Calculate intervals between detected beats
2. Build histogram of BPM values (rounded to nearest 5)
3. Find most common BPM bucket
4. Refine using median of intervals within 20% of detected BPM

### 8-Count Validation
The app validates and corrects beat distribution:
1. If too few beats detected (<16), generate from BPM
2. Test grid offsets to find best alignment with detected beats
3. Snap grid points to nearby detected beats (within 20% of interval)
4. Fill gaps to ensure even distribution

### Counting Logic
- Global beats derived from the Bass band (index 1)
- Beats indexed 0 to N, count = ((index + phraseOffset) % 8) + 1
- Counts scheduled via `setTimeout()` at beat times
- Always sequential: 1→2→3→4→5→6→7→8→1...
- Visual pulse and accent highlighting on beat 1

### Voice Output
- Uses Web Speech API (SpeechSynthesis)
- Prefers natural voices: Samantha, Karen, Daniel
- Adjustable voice volume (default 70%)
- Slight pitch up on beat 1

## User Interface

### File Selection
- Click or drag-and-drop MP3 files
- Multiple files supported
- Song list shows processing status and BPM

### Player Controls
- Play/Pause button
- Stop button (resets to beginning)
- Click canvas to seek
- Voice volume slider
- Music volume slider

### Display
- Large beat indicator (1-8) with phrase dots
- Compact info: BPM, beats, phrases, time
- 8-channel scrolling visualization canvas
- Per-band beat and phrase markers

## Processing States
1. **Click to process** - File loaded, not yet analyzed
2. **Processing** - Analyzing bands 1-8 (shows overlay with progress)
3. **Ready** - Analysis complete, can play

## Key Settings
| Setting | Default | Range | Purpose |
|---------|---------|-------|---------|
| Voice Volume | 70% | 0-100% | How loud the counting voice is |
| Music Volume | 100% | 0-100% | How loud the music plays |

## Technical Details

### Visualization Parameters
- Window: 30 seconds (15s before, 15s after playhead)
- Band height: 70px per channel
- Envelope resolution: 10ms per frame
- Canvas: high-DPI aware (devicePixelRatio)

### Beat Detection Parameters
- Frame size: 20ms
- Hop size: 10ms (50% overlap)
- Flux threshold: local average + 0.3
- Min beat interval: 0.2s (300 BPM max)
- BPM range: 40-240 BPM

### Audio Playback
- Uses Web Audio API BufferSource
- GainNode for volume control
- Precise timing via audioContext.currentTime
- Counts scheduled relative to playback start

## Common Issues
1. **Wrong BPM detected**: Try songs with clearer beats; very complex rhythms may confuse detection
2. **Counts not aligned**: The first detected beat becomes beat 1; seek to adjust
3. **No voice output**: Check browser permissions and voice volume slider
4. **File won't load**: Ensure it's a valid audio format (MP3, WAV, etc.)

## Deployment
- **GitHub Pages**: https://s-quatres.github.io/qcount/
- **Repository**: https://github.com/s-quatres/qcount

### After Making Changes
Always push changes to deploy to GitHub Pages:
```bash
git add index.html js/ CLAUDE.md
git commit -m "Description of changes"
git push origin master
```
Changes are automatically deployed via GitHub Pages after pushing to master.
