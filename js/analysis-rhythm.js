// === RHYTHM: Per-band onset density pattern ===
// For each band, compute onset density at each beat position (0-7)
// High onset density at a consistent position = rhythmic accent = phrase boundary

BeatCounterApp.prototype.computeRhythmPattern = function(bands, beats) {
    if (beats.length < 32) return { bandPatterns: [], combinedPattern: new Float32Array(8), phraseOffset: 0 };

    const hopSec = this.ENVELOPE_HOP_MS / 1000;
    const startBeat = Math.min(16, Math.floor(beats.length * 0.1));
    const numBands = bands.length;

    // For each band, compute envelope derivative (onset strength) at each beat
    // Compensate for bandpass filter group delay + RMS center offset (~25ms ≈ 3 frames)
    const lagFrames = 3;
    const bandPatterns = [];
    for (let b = 0; b < numBands; b++) {
        const env = bands[b].envelope;
        const pattern = new Float32Array(8);
        const counts = new Float32Array(8);

        for (let i = startBeat; i < beats.length; i++) {
            const frame = Math.floor(beats[i].time / hopSec) - lagFrames;
            if (frame <= 0 || frame >= env.length) continue;

            // Onset = peak positive derivative in window around beat
            let onset = 0;
            let peakEnergy = 0;
            const windowHalf = 3;
            for (let w = -windowHalf; w <= windowHalf; w++) {
                const f = Math.max(1, Math.min(frame + w, env.length - 1));
                const diff = env[f] - env[f - 1];
                if (diff > onset) onset = diff;
                if (env[f] > peakEnergy) peakEnergy = env[f];
            }

            // Weight onset by absolute energy so positions with both strong
            // attacks AND high energy are favored (e.g. bass beat 1 in swing)
            const pos = i % 8;
            pattern[pos] += onset * peakEnergy;
            counts[pos]++;
        }

        // Average per position
        for (let i = 0; i < 8; i++) {
            if (counts[i] > 0) pattern[i] /= counts[i];
        }
        bandPatterns.push(pattern);
    }

    // Combined: weighted sum across bands (bass bands more important)
    const weights = [0.5, 1.0, 0.8, 0.6, 0.5, 0.4, 0.3, 0.2]; // Sub-bass to Air
    const combinedPattern = new Float32Array(8);
    for (let pos = 0; pos < 8; pos++) {
        let weightedSum = 0, totalWeight = 0;
        for (let b = 0; b < numBands; b++) {
            weightedSum += bandPatterns[b][pos] * weights[b];
            totalWeight += weights[b];
        }
        combinedPattern[pos] = weightedSum / totalWeight;
    }

    // Best position = highest combined onset density
    let maxVal = 0, secondMax = 0, bestPos = 0;
    for (let i = 0; i < 8; i++) {
        if (combinedPattern[i] > maxVal) {
            secondMax = maxVal;
            maxVal = combinedPattern[i];
            bestPos = i;
        } else if (combinedPattern[i] > secondMax) {
            secondMax = combinedPattern[i];
        }
    }

    const confidence = maxVal > 0 ? (maxVal - secondMax) / maxVal : 0;
    return {
        bandPatterns,
        combinedPattern,
        phraseOffset: (8 - bestPos) % 8,
        confidence
    };
};
