# 8-Count Beat Counter App

## Overview
A web-based app that loads MP3 files from the mp3/ folder, analyzes them offline to detect beats, validates 8-count phrase distribution, and plays the music with synchronized voice counting. Designed for dancers practicing with swing music.

## File Structure
- `index.html` - Single file containing all HTML, CSS, and JavaScript
- `mp3/` - Folder containing MP3 files to analyze

## Adding Songs
1. Add MP3 files to the `mp3/` folder
2. Update the `FOLDER_SONGS` array in index.html with the exact filenames
3. Commit and push to deploy

## Architecture

### Core Flow
```
MP3 File → Web Audio API (decodeAudioData)
                ↓
        Offline Beat Analysis (spectral flux)
                ↓
        BPM Detection (histogram + median)
                ↓
        8-Count Validation (fill gaps, verify distribution)
                ↓
        Playback with Scheduled Counts (setTimeout)
                ↓
        Speech Synthesis (count aloud 1-8)
```

### Key Classes
- `BeatCounterApp` - Main class containing all logic

### Beat Detection (Offline Analysis)
1. Audio file decoded to AudioBuffer via `decodeAudioData()`
2. Process mono channel data in frames (20ms frames, 10ms hops)
3. Calculate energy per frame: `sqrt(sum(sample²) / frameSize)`
4. **Spectral Flux**: `flux = max(0, currentEnergy - previousEnergy)`
5. Normalize flux values to 0-1 range
6. Peak picking with adaptive threshold (local average + 0.3)
7. Minimum 0.2s between beats (300 BPM max)

### BPM Detection
1. Calculate intervals between detected beats
2. Build histogram of BPM values (rounded to nearest 5)
3. Find most common BPM bucket
4. Refine using median of intervals within 20% of detected BPM

### 8-Count Validation
The app validates and corrects beat distribution:
1. If too few beats detected (<16), generate from BPM
2. Check each detected beat against expected timing
3. Fill in missing beats at expected intervals
4. Ensure even distribution across the song

### Counting Logic
- Beats indexed 0 to N, count = (index % 8) + 1
- Counts scheduled via `setTimeout()` at beat times
- Always sequential: 1→2→3→4→5→6→7→8→1...
- Visual pulse and accent highlighting on beat 1

### Voice Output
- Uses Web Speech API (SpeechSynthesis)
- Prefers natural voices: Samantha, Karen, Daniel
- Adjustable voice volume (default 70%)
- Slight pitch up on beat 1

## User Interface

### Song Selection
- Songs from mp3/ folder appear automatically
- Click a song to process and play
- Can also add more files via file picker
- Song list shows processing status and BPM

### Player Controls
- Play/Pause button
- Stop button (resets to beginning)
- Progress bar with seek (click to jump)
- Voice volume slider
- Music volume slider

### Display
- Large beat indicator (1-8)
- 8 beat dots showing current position
- BPM, total beats, and phrase count
- Current time / total duration

## Processing States
1. **Click to process** - File loaded, not yet analyzed
2. **Processing** - Analyzing beats (shows overlay)
3. **Ready** - Analysis complete, can play

## Key Settings
| Setting | Default | Range | Purpose |
|---------|---------|-------|---------|
| Voice Volume | 70% | 0-100% | How loud the counting voice is |
| Music Volume | 100% | 0-100% | How loud the music plays |

## Technical Details

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
git add index.html CLAUDE.md
git commit -m "Description of changes"
git push origin master
```
Changes are automatically deployed via GitHub Pages after pushing to master.
