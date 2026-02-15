// === CORE ANALYSIS PIPELINE ===

BeatCounterApp.prototype.processSong = async function(song) {
    this.showProcessing('Loading audio...', song.name);

    try {
        // Ensure AudioContext is active (Safari suspends it without user gesture)
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        const arrayBuffer = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(song.file);
        });
        song.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

        // Analyze each frequency band
        song.bands = [];
        for (let b = 0; b < this.BANDS.length; b++) {
            const bandDef = this.BANDS[b];
            this.showProcessing(
                `Analyzing band ${b + 1}/${this.BANDS.length}...`,
                `${bandDef.name} (${bandDef.low}-${bandDef.high} Hz)`
            );

            // Allow UI to update
            await new Promise(r => setTimeout(r, 10));

            // Filter audio to this frequency band
            const filteredData = await this.filterBand(song.audioBuffer, bandDef);

            // Compute energy envelope
            const envelope = this.computeEnvelope(filteredData, song.audioBuffer.sampleRate);

            // Detect beats on this band's envelope
            const beats = this.detectBandBeats(envelope, song.audioBuffer.sampleRate);

            // Estimate BPM from this band's beats
            const bpm = this.estimateBpm(beats);

            // Validate and regularize beats
            const validatedBeats = this.validate8Counts(beats, bpm, song.audioBuffer.duration);

            // Find phrase alignment
            const phraseResult = this.findBandPhraseAlignment(validatedBeats, envelope);

            song.bands.push({
                name: bandDef.name,
                color: bandDef.color,
                envelope: envelope,
                beats: validatedBeats,
                bpm: bpm,
                phraseOffset: phraseResult.offset,
                phraseConfidence: phraseResult.confidence,
            });
        }

        // Derive global beats from bass band (index 1) for voice counting
        const bassBand = song.bands[1];
        song.beats = bassBand.beats;
        song.bpm = bassBand.bpm;

        // Compute energy consensus: aggregate raw onset strengths across all bands
        // evaluated against the BASS beat grid, then apply backbeat correction once
        // on the cleaner aggregated signal.
        const bandWeights = [0.5, 1.0, 0.8, 0.6, 0.4, 0.3, 0.2, 0.1];
        const aggregatedOnset = new Float64Array(8);
        for (let b = 0; b < song.bands.length; b++) {
            const band = song.bands[b];
            const result = this.findBandPhraseAlignment(song.beats, band.envelope);
            if (result.positionEnergy) {
                // Normalize each band's pattern to 0-1 so loud bands don't dominate
                let bandMax = 0;
                for (let i = 0; i < 8; i++) {
                    if (result.positionEnergy[i] > bandMax) bandMax = result.positionEnergy[i];
                }
                if (bandMax > 0) {
                    for (let i = 0; i < 8; i++) {
                        aggregatedOnset[i] += (result.positionEnergy[i] / bandMax) * (bandWeights[b] || 0.1);
                    }
                }
            }
        }
        // Find peak in aggregated onset pattern and apply backbeat correction
        let maxAO = 0, secondAO = 0, bestAP = 0;
        for (let i = 0; i < 8; i++) {
            if (aggregatedOnset[i] > maxAO) {
                secondAO = maxAO;
                maxAO = aggregatedOnset[i];
                bestAP = i;
            } else if (aggregatedOnset[i] > secondAO) {
                secondAO = aggregatedOnset[i];
            }
        }
        // Backbeat correction: in swing, the strongest onset is typically on beat 2
        const bestEP = (bestAP - 1 + 8) % 8;
        song.energyConsensusOffset = (8 - bestEP) % 8;
        song.energyConsensusConfidence = maxAO > 0 ? (maxAO - secondAO) / maxAO : 0;

        // === Additional analyses for phrase detection methods ===
        song.analysis = {};

        // 1. Chromagram + hi-res spectral centroid (both from FFT)
        this.showProcessing('Computing chromagram...', 'This may take a moment');
        await new Promise(r => setTimeout(r, 10));
        const channelData = song.audioBuffer.getChannelData(0);
        const sampleRate = song.audioBuffer.sampleRate;
        song.analysis.chroma = await this.computeChromagram(channelData, sampleRate);
        // 2. Harmony: beat-synchronous chroma distance
        this.showProcessing('Computing harmony analysis...', 'Beat-sync chroma distance');
        await new Promise(r => setTimeout(r, 10));
        const harmonyResult = this.computeBeatSyncChroma(song.analysis.chroma, song.beats);
        song.analysis.harmonyBeatDistances = harmonyResult.beatDistances;
        song.analysis.harmonyBeatChroma = harmonyResult.beatChroma;
        const harmonyPhrase = this.findHarmonyPhraseOffset(harmonyResult.beatDistances, song.beats);
        song.analysis.harmonyPhraseOffset = harmonyPhrase.offset;
        song.analysis.harmonyConfidence = harmonyPhrase.confidence;

        // 5. Rhythm: per-band onset patterns
        this.showProcessing('Computing rhythm analysis...', 'Per-band onset patterns');
        await new Promise(r => setTimeout(r, 10));
        song.analysis.rhythmData = this.computeRhythmPattern(song.bands, song.beats);
        song.analysis.rhythmPhraseOffset = song.analysis.rhythmData.phraseOffset;
        song.analysis.rhythmConfidence = song.analysis.rhythmData.confidence;

        // 6. Combined: multi-feature weighted voting
        this.showProcessing('Computing combined analysis...', 'Multi-method voting');
        await new Promise(r => setTimeout(r, 10));
        song.analysis.combinedData = this.computeCombinedPhraseOffset(song);
        song.analysis.combinedPhraseOffset = song.analysis.combinedData.phraseOffset;

        // Log all phrase offsets and confidences for debugging
        console.log('Phrase offsets (confidence):', {
            energyConsensus: song.energyConsensusOffset + ' (' + (song.energyConsensusConfidence * 100).toFixed(1) + '%)',
            harmony: song.analysis.harmonyPhraseOffset + ' (' + (song.analysis.harmonyConfidence * 100).toFixed(1) + '%)',
            rhythm: song.analysis.rhythmPhraseOffset + ' (' + (song.analysis.rhythmConfidence * 100).toFixed(1) + '%)',
            combined: song.analysis.combinedPhraseOffset,
            perBand: song.bands.map(b => b.name + ': ' + b.phraseOffset + ' (' + ((b.phraseConfidence || 0) * 100).toFixed(0) + '%)'),
        });

        // Set initial phrase offset based on active method
        song.phraseOffset = this.getPhraseOffsetForMethod(song);

        // Debug: log Bass band beats 14-24s with counts
        const dbgBeats = song.beats.filter(b => b.time >= 14 && b.time <= 24);
        console.log('Bass beats 14-24s (phraseOffset=' + song.phraseOffset + '):',
            dbgBeats.map(b => {
                const idx = song.beats.indexOf(b);
                return 't=' + b.time.toFixed(3) + ' idx=' + idx + ' count=' + (((idx + song.phraseOffset) % 8) + 1);
            })
        );

        song.processed = true;
        this.hideProcessing();
        this.renderSongList();
        this.setupCanvas();

    } catch (error) {
        console.error('Error processing song:', error);
        this.hideProcessing();
        alert('Error processing audio file: ' + error.message);
    }
};

BeatCounterApp.prototype.filterBand = async function(audioBuffer, bandDef) {
    const sampleRate = audioBuffer.sampleRate;
    const length = audioBuffer.length;
    const offlineCtx = new OfflineAudioContext(1, length, sampleRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;

    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = bandDef.freq;
    // Q = center / bandwidth
    const bandwidth = bandDef.high - bandDef.low;
    filter.Q.value = bandDef.freq / bandwidth;

    source.connect(filter);
    filter.connect(offlineCtx.destination);
    source.start(0);

    const rendered = await offlineCtx.startRendering();
    return rendered.getChannelData(0);
};

BeatCounterApp.prototype.computeEnvelope = function(channelData, sampleRate) {
    const hopSamples = Math.floor(sampleRate * this.ENVELOPE_HOP_MS / 1000);
    const frameSamples = hopSamples * 2; // 20ms frame
    const numFrames = Math.floor((channelData.length - frameSamples) / hopSamples);
    const envelope = new Float32Array(numFrames);

    for (let i = 0; i < numFrames; i++) {
        const start = i * hopSamples;
        let energy = 0;
        for (let j = 0; j < frameSamples && (start + j) < channelData.length; j++) {
            energy += channelData[start + j] * channelData[start + j];
        }
        envelope[i] = Math.sqrt(energy / frameSamples);
    }

    return envelope;
};

BeatCounterApp.prototype.detectBandBeats = function(envelope, sampleRate) {
    // Spectral flux on the energy envelope
    const hopSec = this.ENVELOPE_HOP_MS / 1000;
    const fluxValues = [];

    for (let i = 1; i < envelope.length; i++) {
        const flux = Math.max(0, envelope[i] - envelope[i - 1]);
        fluxValues.push({ time: i * hopSec, flux, energy: envelope[i] });
    }

    if (fluxValues.length === 0) return [];

    // Normalize flux
    const maxFlux = Math.max(...fluxValues.map(f => f.flux));
    if (maxFlux > 0) {
        fluxValues.forEach(f => f.flux /= maxFlux);
    }

    // Peak picking with adaptive threshold
    const beats = [];
    const windowSize = 10;
    const threshold = 0.3;
    const minBeatInterval = 0.2;

    for (let i = windowSize; i < fluxValues.length - windowSize; i++) {
        const current = fluxValues[i];

        let localAvg = 0;
        for (let j = i - windowSize; j <= i + windowSize; j++) {
            localAvg += fluxValues[j].flux;
        }
        localAvg /= (windowSize * 2 + 1);

        const isLocalMax = current.flux > fluxValues[i - 1].flux &&
                           current.flux > fluxValues[i + 1].flux;
        const aboveThreshold = current.flux > localAvg + threshold;

        if (isLocalMax && aboveThreshold) {
            if (beats.length === 0 || current.time - beats[beats.length - 1].time > minBeatInterval) {
                beats.push({ time: current.time, energy: current.energy });
            }
        }
    }

    return beats;
};

BeatCounterApp.prototype.estimateBpm = function(beats) {
    const intervals = [];
    for (let i = 1; i < beats.length; i++) {
        const interval = beats[i].time - beats[i - 1].time;
        if (interval > 0.25 && interval < 1.5) {
            intervals.push(interval);
        }
    }

    const bpmHistogram = {};
    for (const interval of intervals) {
        const bpm = Math.round(60 / interval);
        const roundedBpm = Math.round(bpm / 5) * 5;
        bpmHistogram[roundedBpm] = (bpmHistogram[roundedBpm] || 0) + 1;
    }

    let bestBpm = 120;
    let bestCount = 0;
    for (const [bpm, count] of Object.entries(bpmHistogram)) {
        if (count > bestCount) {
            bestCount = count;
            bestBpm = parseInt(bpm);
        }
    }

    const targetInterval = 60 / bestBpm;
    const nearIntervals = intervals.filter(i =>
        Math.abs(i - targetInterval) / targetInterval < 0.2
    );

    if (nearIntervals.length > 0) {
        nearIntervals.sort((a, b) => a - b);
        const medianInterval = nearIntervals[Math.floor(nearIntervals.length / 2)];
        bestBpm = Math.round(60 / medianInterval);
    }

    return bestBpm;
};

BeatCounterApp.prototype.validate8Counts = function(beats, bpm, duration) {
    // Thorough analysis: create a plan and fit it to the actual beats

    if (beats.length < 16) {
        console.log('Too few beats detected, generating from BPM');
        return this.generateBeatsFromBpm(bpm, duration);
    }

    console.log(`\n=== BEAT PLAN ANALYSIS ===`);
    console.log(`Detected ${beats.length} beats, initial BPM estimate: ${bpm}`);

    // Step 1: Refine BPM by analyzing intervals across the whole song
    const intervals = [];
    for (let i = 1; i < beats.length; i++) {
        intervals.push(beats[i].time - beats[i - 1].time);
    }

    // Filter to reasonable intervals (40-200 BPM range)
    const validIntervals = intervals.filter(i => i > 0.3 && i < 1.5);

    // Check for double-time: if most intervals are around half the expected
    const expectedInterval = 60 / bpm;
    const halfIntervals = validIntervals.filter(i => i < expectedInterval * 0.7);
    const normalIntervals = validIntervals.filter(i => i >= expectedInterval * 0.7 && i <= expectedInterval * 1.3);

    let refinedInterval = expectedInterval;
    if (halfIntervals.length > normalIntervals.length * 2) {
        // Detected at double tempo, halve it
        refinedInterval = expectedInterval / 2;
        console.log(`Detected double-time, adjusting interval from ${expectedInterval.toFixed(3)}s to ${refinedInterval.toFixed(3)}s`);
    } else if (normalIntervals.length > 10) {
        // Use median of normal intervals for robustness against outliers
        normalIntervals.sort((a, b) => a - b);
        refinedInterval = normalIntervals[Math.floor(normalIntervals.length / 2)];
    }

    const refinedBpm = Math.round(60 / refinedInterval);
    console.log(`Refined BPM: ${refinedBpm} (interval: ${refinedInterval.toFixed(3)}s)`);

    // Step 2: Find the best starting point by testing different offsets
    const startTime = beats[0].time;
    const endTime = duration - 0.5;

    // Test multiple start offsets to find best alignment
    let bestStartOffset = 0;
    let bestMatchScore = -Infinity;

    for (let testOffset = 0; testOffset < refinedInterval; testOffset += refinedInterval / 16) {
        let score = 0;
        let gridTime = startTime + testOffset;

        while (gridTime < Math.min(endTime, startTime + 30)) { // Test first 30 seconds
            // Find nearest detected beat
            let minDist = Infinity;
            for (const beat of beats) {
                const dist = Math.abs(beat.time - gridTime);
                if (dist < minDist) minDist = dist;
            }
            // Score based on how close the grid point is to a detected beat
            if (minDist < refinedInterval * 0.25) {
                score += 1 - (minDist / refinedInterval);
            }
            gridTime += refinedInterval;
        }

        if (score > bestMatchScore) {
            bestMatchScore = score;
            bestStartOffset = testOffset;
        }
    }

    console.log(`Best start offset: ${bestStartOffset.toFixed(3)}s (score: ${bestMatchScore.toFixed(2)})`);

    // Step 3: Create the beat grid with the refined parameters
    const finalBeats = [];
    let gridTime = startTime + bestStartOffset;

    // If first grid beat is before song start, advance it
    while (gridTime < 0) {
        gridTime += refinedInterval;
    }

    // Step 4: For each grid position, snap to nearest detected beat if close enough
    while (gridTime < endTime) {
        // Find nearest detected beat within tolerance
        let nearestBeat = null;
        let nearestDist = Infinity;

        for (const beat of beats) {
            const dist = Math.abs(beat.time - gridTime);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearestBeat = beat;
            }
        }

        // Snap to detected beat if within 20% of interval, otherwise use grid
        if (nearestDist < refinedInterval * 0.2 && nearestBeat) {
            finalBeats.push({ time: nearestBeat.time, energy: nearestBeat.energy });
        } else {
            finalBeats.push({ time: gridTime, energy: 0.5 });
        }

        gridTime += refinedInterval;
    }

    // Step 5: Verify the plan matches the song
    let matchedBeats = 0;
    for (const finalBeat of finalBeats) {
        for (const detectedBeat of beats) {
            if (Math.abs(finalBeat.time - detectedBeat.time) < refinedInterval * 0.15) {
                matchedBeats++;
                break;
            }
        }
    }

    const matchRate = matchedBeats / finalBeats.length;
    console.log(`Plan has ${finalBeats.length} beats, ${matchedBeats} matched to detected (${(matchRate * 100).toFixed(1)}%)`);
    console.log(`=== END ANALYSIS ===\n`);

    // Attach match rate as a property so callers can assess grid quality
    finalBeats.matchRate = matchRate;
    return finalBeats;
};

BeatCounterApp.prototype.generateBeatsFromBpm = function(bpm, duration, startTime) {
    if (startTime === undefined) startTime = 0.5;
    const interval = 60 / bpm;
    const beats = [];

    for (let t = startTime; t < duration - 0.5; t += interval) {
        beats.push({ time: t, energy: 0.5 });
    }

    return beats;
};

BeatCounterApp.prototype.findBandPhraseAlignment = function(beats, envelope) {
    // Find best offset (0-7) so beat 1 aligns with strongest onset in this band.
    // Uses onset (energy rise / spectral flux) rather than peak energy, because
    // in swing music beat 2 often sustains higher energy than the downbeat.
    // The downbeat has the strongest energy INCREASE (attack/chord change).
    if (beats.length < 32) return { offset: 0, confidence: 0 };

    const hopSec = this.ENVELOPE_HOP_MS / 1000;
    const startBeat = Math.min(16, Math.floor(beats.length * 0.1));
    const analysisBeats = beats.slice(startBeat);

    const windowHalf = 3; // ±30ms window

    // Get max onset strength (energy rise) in a window around each beat
    const beatOnsets = analysisBeats.map((beat, idx) => {
        const centerFrame = Math.floor(beat.time / hopSec);
        let maxOnset = 0;
        for (let w = -windowHalf; w <= windowHalf; w++) {
            const f = centerFrame + w;
            if (f >= 1 && f < envelope.length) {
                const flux = Math.max(0, envelope[f] - envelope[f - 1]);
                maxOnset = Math.max(maxOnset, flux);
            }
        }
        return { index: startBeat + idx, onset: maxOnset };
    });

    // Onset-weighted scoring: sum onset strengths at each position (0-7)
    const positionEnergy = new Float64Array(8);
    const positionCounts = new Float64Array(8);
    for (const bo of beatOnsets) {
        const pos = bo.index % 8;
        positionEnergy[pos] += bo.onset;
        positionCounts[pos]++;
    }

    // Average onset per position
    for (let i = 0; i < 8; i++) {
        if (positionCounts[i] > 0) positionEnergy[i] /= positionCounts[i];
    }

    let maxEnergy = 0;
    let secondMax = 0;
    let bestPos = 0;
    for (let i = 0; i < 8; i++) {
        if (positionEnergy[i] > maxEnergy) {
            secondMax = maxEnergy;
            maxEnergy = positionEnergy[i];
            bestPos = i;
        } else if (positionEnergy[i] > secondMax) {
            secondMax = positionEnergy[i];
        }
    }

    const confidence = maxEnergy > 0 ? (maxEnergy - secondMax) / maxEnergy : 0;

    // In swing music the backbeat (beat "2") carries the strongest accent,
    // so the onset peak lands one position AFTER the musical "1".
    // Shift back by one to find the true phrase start.
    const phraseStartPos = (bestPos - 1 + 8) % 8;
    return {
        offset: (8 - phraseStartPos) % 8,
        confidence,
        positionEnergy: positionEnergy,  // raw per-position onset strengths
    };
};
