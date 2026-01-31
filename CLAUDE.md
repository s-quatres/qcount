# 8-Count Beat Counter App

## Overview
A web-based app that listens to music via microphone, detects beats, locks onto tempo, and counts aloud 1-8 using text-to-speech. Designed for dancers practicing with swing music.

## File Structure
- `index.html` - Single file containing all HTML, CSS, and JavaScript

## Architecture

### Core Flow
```
Microphone → Web Audio API → Meyda.js (RMS) + AnalyserNode (FFT)
                                    ↓
                            Band Energy Calculation
                                    ↓
                            Beat Detection (threshold)
                                    ↓
                            Tempo Lock (consistency check)
                                    ↓
                            Predictive Counting (setTimeout)
                                    ↓
                            Speech Synthesis (count aloud)
```

### Key Classes
- `BeatCounter` - Main class containing all logic

### Beat Detection
1. Meyda extracts RMS (root mean square) for overall volume
2. AnalyserNode provides FFT data for frequency bands
3. Energy compared against rolling average × sensitivity threshold
4. Minimum 0.15s between beats (prevents double-triggers)

### Frequency Bands
- **Bass**: 20-250 Hz (kick drums, bass)
- **Mid**: 250-2000 Hz (vocals, snare)
- **High**: 2000-20000 Hz (cymbals, hi-hats)
- User can select which band to use for beat detection

### Tempo Locking
1. Collect N beat intervals (configurable: 2-8)
2. Calculate median interval
3. Check consistency: 60% must be within tolerance of median
4. Once locked, count predictively using setTimeout
5. Adjusts gradually if tempo drifts (90/10 weighted average)

### Counting Logic
- Always sequential: 1→2→3→4→5→6→7→8→1...
- Never skips or repeats numbers
- Accent detection can shift where "1" falls (requires 3+ consistent accents)

### Voice Output
- Uses Web Speech API (SpeechSynthesis)
- Prefers natural voices: Samantha, Karen, Daniel
- Softer volume (0.5), relaxed rate (1.4)
- Slight pitch up on beat 1

## Key Settings (User Adjustable)
| Setting | Default | Range | Purpose |
|---------|---------|-------|---------|
| Beat Sensitivity | 1.3 | 1.0-2.0 | Lower = more sensitive |
| Beats to Lock | 4 | 2-8 | Beats needed before tempo locks |
| Beat Tolerance | 25% | 10-50% | How consistent beats must be |
| Min Volume | 5% | 1-20% | Volume threshold to start detection |

## State Variables
- `isTempoLocked` - Whether counting has started
- `lockedInterval` - Beat interval in seconds
- `lockedBPM` - Beats per minute
- `currentCount` - Current position (0-7, displayed as 1-8)
- `energyHistory` - Rolling window for threshold calculation
- `beatIntervals` - Recent intervals for consistency check

## Debug Panel
Click "Show Debug" to see:
- Volume levels and energy values
- Beat detections with threshold comparisons
- Interval calculations
- Consistency checks and lock status

## Common Issues
1. **Won't lock**: Beats too inconsistent. Try Bass band, lower sensitivity, or increase tolerance
2. **False beats**: Sensitivity too low or wrong frequency band
3. **No volume**: Check microphone permissions, Min Volume setting

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
Changes are automatically deployed via GitHub Pages after pushing to main.
