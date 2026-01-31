# 8-Count Beat Counter App

## Overview
A web-based app that listens to music via microphone, detects beats using spectral flux analysis, locks onto tempo, and counts aloud 1-8 using text-to-speech. Designed for dancers practicing with swing music.

## File Structure
- `index.html` - Single file containing all HTML, CSS, and JavaScript

## Architecture

### Core Flow
```
Microphone → Web Audio API → Meyda.js (RMS) + AnalyserNode (FFT)
                                    ↓
                        Band Energy + Spectral Flux Calculation
                                    ↓
                        Onset Detection (flux threshold)
                                    ↓
                        Per-Band Tempo Lock (consistency check)
                                    ↓
                        Predictive Counting (setTimeout per band)
                                    ↓
                        Speech Synthesis (count aloud)
```

### Key Classes
- `BeatCounter` - Main class containing all logic

### Beat Detection (Spectral Flux)
1. Meyda extracts RMS (root mean square) for overall volume
2. AnalyserNode provides FFT data for frequency bands
3. **Spectral Flux** calculated per band: `flux = max(0, currentEnergy - previousEnergy)`
   - Detects energy CHANGES (onsets) not just energy levels
   - More robust for detecting beat attacks vs sustained sounds
4. Flux compared against adaptive threshold (avg flux × sensitivity)
5. Minimum 0.1s between beats (prevents double-triggers)

### Frequency Bands (12 Instrument-Focused)
| Band | Frequency | Target Sound |
|------|-----------|--------------|
| SubBass | 30-60 Hz | Kick fundamental |
| Kick | 60-100 Hz | Kick body |
| Punch | 100-150 Hz | Kick punch |
| Snare | 150-250 Hz | Snare body |
| Crack | 250-400 Hz | Snare crack |
| Mids | 400-800 Hz | General mids |
| Presence | 800-1.6 kHz | Vocal presence |
| Snap | 1.6-3.2 kHz | Snare snap |
| HiHat | 3.2-6 kHz | Hi-hat body |
| Air | 6-10 kHz | Hi-hat shimmer |
| Sparkle | 10-16 kHz | High sparkle |
| Ultra | 16-20 kHz | Ultra high |

**For swing music**: Kick/Punch (bass) and HiHat bands work best.

### Dynamic Band Discovery
- Bands start hidden until they detect beats
- Shows only active bands (reduces visual clutter)
- "Show All Bands" toggle to see all 12
- Each band shows consistency % while learning, BPM when locked

### Per-Band Tempo Locking
Each band independently:
1. Tracks its own beat intervals
2. Calculates consistency score
3. Locks when N consistent beats detected (uses "Beats to Lock" slider)
4. Once locked, counts predictively (1-8) without resetting
5. Visual indicator: yellow border = locked

### Main Counter
The main display simply follows the selected band:
1. When "Use All" is active, auto-selects first locked band
2. Tap a band to select it manually
3. Main counter mirrors the selected band's count and speaks aloud
4. Shows BPM and band name when locked

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
| Onset Threshold | 1.8 | 1.0-3.0 | Higher = less sensitive to onsets |
| Beats to Lock | 4 | 2-8 | Beats needed before tempo locks |
| Tempo Tolerance | 25% | 10-50% | How consistent beats must be |

## State Variables
### Global
- `isTempoLocked` - Whether main counting has started
- `lockedInterval` - Beat interval in seconds
- `lockedBPM` - Beats per minute
- `currentCount` - Current position (0-7, displayed as 1-8)

### Per-Band Arrays (12 elements each)
- `bandEnergies` - Current energy level
- `bandFlux` - Spectral flux (energy change)
- `bandFluxHistories` - Rolling flux history for threshold
- `bandTempoLocked` - Whether this band is locked
- `bandLockedInterval` - Locked interval for this band
- `bandBeatCount` - This band's 1-8 count
- `bandConsistencyScore` - 0-100% consistency

## Debug Panel
Click "Show Debug" to see:
- Volume levels and energy values
- Beat detections with threshold comparisons
- Interval calculations
- Consistency checks and lock status

## Common Issues
1. **Won't lock**: Beats too inconsistent. Try Kick/Punch band, lower sensitivity, or increase tolerance
2. **False beats**: Sensitivity too low or wrong frequency band
3. **No volume**: Check microphone permissions, Min Volume setting
4. **No bands showing**: Music may not have clear beats in those frequencies; try "Show All Bands"

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
