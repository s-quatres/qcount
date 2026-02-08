// === HARMONY: Chromagram + Beat-synchronous chroma distance ===

BeatCounterApp.prototype.computeChromagram = async function(channelData, sampleRate) {
    const fftSize = 4096;
    const hopSamples = Math.floor(sampleRate * this.ENVELOPE_HOP_MS / 1000);
    const numFrames = Math.floor((channelData.length - fftSize) / hopSamples);
    const chroma = [];
    for (let c = 0; c < 12; c++) {
        chroma.push(new Float32Array(numFrames));
    }

    // Also compute high-resolution spectral centroid from FFT bins
    const centroidHiRes = new Float32Array(numFrames);

    // Precompute Hann window
    const hann = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
        hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
    }

    // Precompute bin-to-pitch-class mapping
    const binToChroma = new Int8Array(fftSize / 2);
    const refFreq = 440; // A4
    for (let bin = 1; bin < fftSize / 2; bin++) {
        const freq = bin * sampleRate / fftSize;
        if (freq < 60 || freq > 5000) { binToChroma[bin] = -1; continue; }
        const semitone = 12 * Math.log2(freq / refFreq);
        binToChroma[bin] = ((Math.round(semitone) % 12) + 12) % 12;
    }

    // Precompute bin frequencies for centroid
    const binFreqs = new Float32Array(fftSize / 2);
    for (let bin = 0; bin < fftSize / 2; bin++) {
        binFreqs[bin] = bin * sampleRate / fftSize;
    }

    const re = new Float64Array(fftSize);
    const im = new Float64Array(fftSize);

    for (let f = 0; f < numFrames; f++) {
        const start = f * hopSamples;

        // Window and load
        for (let i = 0; i < fftSize; i++) {
            re[i] = (start + i < channelData.length) ? channelData[start + i] * hann[i] : 0;
            im[i] = 0;
        }

        BeatCounterApp.fft(re, im);

        // Accumulate magnitude into pitch classes + compute centroid
        let weightedSum = 0, totalMag = 0;
        for (let bin = 1; bin < fftSize / 2; bin++) {
            const mag = Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]);
            // Centroid uses all bins in audible range
            if (binFreqs[bin] >= 60 && binFreqs[bin] <= 8000) {
                weightedSum += mag * binFreqs[bin];
                totalMag += mag;
            }
            // Chroma uses mapped bins
            const pc = binToChroma[bin];
            if (pc >= 0) chroma[pc][f] += mag;
        }
        centroidHiRes[f] = totalMag > 0 ? weightedSum / totalMag : 0;

        // Yield to UI every 2000 frames
        if (f % 2000 === 0 && f > 0) {
            this.showProcessing('Computing chromagram...', `${Math.round(f / numFrames * 100)}%`);
            await new Promise(r => setTimeout(r, 0));
        }
    }

    // Store hi-res centroid on the result (we'll extract it in processSong)
    chroma.centroidHiRes = centroidHiRes;
    return chroma;
};

// Average chroma over each beat's duration, then cosine distance between consecutive beats
// Research shows this is much cleaner than frame-level chroma novelty
BeatCounterApp.prototype.computeBeatSyncChroma = function(chroma, beats) {
    const hopSec = this.ENVELOPE_HOP_MS / 1000;
    const numFrames = chroma[0].length;
    const numBeats = beats.length;

    // For each beat, average chroma over a narrow onset window (~80ms)
    // Using full-beat averaging blurs chord boundaries because the 4096-point
    // FFT window (~93ms) causes frames near beat boundaries to bleed across.
    // A tight onset window captures what's playing right at each beat's attack.
    const onsetFrames = 8; // ~80ms at 10ms hop
    const fftLagFrames = 5; // compensate for FFT window center offset (~46ms)
    const beatChroma = [];
    for (let i = 0; i < numBeats; i++) {
        const beatFrame = Math.floor(beats[i].time / hopSec);
        // Shift back by FFT lag so we capture audio centered on the beat onset
        const startFrame = Math.max(0, beatFrame - fftLagFrames);
        const endFrame = Math.min(numFrames - 1, startFrame + onsetFrames);

        const avgChroma = new Float64Array(12);
        let count = 0;
        for (let f = startFrame; f <= endFrame; f++) {
            for (let c = 0; c < 12; c++) {
                avgChroma[c] += chroma[c][f];
            }
            count++;
        }
        if (count > 0) {
            for (let c = 0; c < 12; c++) avgChroma[c] /= count;
        }
        beatChroma.push(avgChroma);
    }

    // Cosine distance between consecutive beat chroma vectors
    const beatDistances = new Float32Array(numBeats);
    for (let i = 1; i < numBeats; i++) {
        let dot = 0, nA = 0, nB = 0;
        for (let c = 0; c < 12; c++) {
            dot += beatChroma[i][c] * beatChroma[i - 1][c];
            nA += beatChroma[i][c] * beatChroma[i][c];
            nB += beatChroma[i - 1][c] * beatChroma[i - 1][c];
        }
        const denom = Math.sqrt(nA) * Math.sqrt(nB);
        beatDistances[i] = denom > 0 ? 1 - dot / denom : 0;
    }

    return { beatChroma, beatDistances };
};

BeatCounterApp.prototype.findHarmonyPhraseOffset = function(beatDistances, beats) {
    // Find the beat position (0-7) where chord changes cluster most
    if (beats.length < 32) return 0;
    const startBeat = Math.min(16, Math.floor(beats.length * 0.1));

    const positionScores = new Float64Array(8);
    const positionCounts = new Float64Array(8);

    for (let i = Math.max(1, startBeat); i < beats.length; i++) {
        const pos = i % 8;
        // Square distances to amplify large chord changes (real phrase boundaries)
        // over small mid-phrase harmonic variations
        const d = beatDistances[i];
        positionScores[pos] += d * d;
        positionCounts[pos]++;
    }

    let maxAvg = 0, bestPos = 0;
    for (let i = 0; i < 8; i++) {
        const avg = positionCounts[i] > 0 ? positionScores[i] / positionCounts[i] : 0;
        if (avg > maxAvg) { maxAvg = avg; bestPos = i; }
    }
    return (8 - bestPos) % 8;
};
