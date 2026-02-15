'use strict';
const fs   = require('fs');
const path = require('path');
const vm   = require('vm');
const { AudioContext, OfflineAudioContext } = require('node-web-audio-api');

// ── Globals the browser JS files expect ────────────────────────────────────────
global.OfflineAudioContext = OfflineAudioContext;
global.AudioContext        = AudioContext;
global.window              = { AudioContext, webkitAudioContext: AudioContext,
                                speechSynthesis: { getVoices: () => [] } };
// Minimal document mock (constructor reads DOM elements)
const noop = () => ({});
const fakeEl = { addEventListener: () => {}, style: {}, querySelectorAll: () => [] };
global.document = {
    getElementById:    () => ({ ...fakeEl, getContext: () => ({ scale: () => {}, canvas: {} }) }),
    querySelectorAll:  () => [],
    addEventListener:  () => {},
};

// ── Minimal BeatCounterApp class (replaces app.js which requires full DOM) ────
global.BeatCounterApp = class BeatCounterApp {
    constructor() {
        this.audioContext    = new AudioContext();
        this.activeMethod    = 'energy';
        this.ENVELOPE_HOP_MS = 10;
        this.BANDS = [
            { name: 'Sub-Bass',   freq:   31.5, low:   20, high:   45 },
            { name: 'Bass',       freq:   63,   low:   45, high:   90 },
            { name: 'Low-Mid',    freq:  125,   low:   90, high:  180 },
            { name: 'Mid',        freq:  250,   low:  180, high:  355 },
            { name: 'Upper-Mid',  freq:  500,   low:  355, high:  710 },
            { name: 'Presence',   freq: 1000,   low:  710, high: 1400 },
            { name: 'Brilliance', freq: 2000,   low: 1400, high: 2800 },
            { name: 'Air',        freq: 4000,   low: 2800, high: 5600 },
        ];
    }
    showProcessing() {}
    hideProcessing()  {}
    renderSongList()  {}
    setupCanvas()     {}
};

// ── Load analysis prototype files via vm.runInThisContext ─────────────────────
const JS = path.join(__dirname, '../js');
for (const f of ['fft.js','analysis.js','analysis-harmony.js','analysis-rhythm.js','analysis-combined.js']) {
    const code = fs.readFileSync(path.join(JS, f), 'utf8');
    vm.runInThisContext(code, { filename: f });
}

// ── Test data (index is array of expected beat-1 timestamps) ─────────────────
const EXPECTED = {
    'swinginsafari.mp3': [59.1],
    'doright.mp3':       [19.0, 34.5, 42.3],
    'VIC017467.mp3':     [49.0],
};
const METHODS    = ['energy', 'harmony', 'rhythm', 'combined'];
const MP3_DIR    = path.join(__dirname, '../mp3');

// ── Helper: does the nearest beat to `target` get counted as "1"? ────────────
function checkNearestBeat(beats, phraseOffset, target) {
    let nearestIdx = 0, nearestDiff = Infinity;
    for (let i = 0; i < beats.length; i++) {
        const d = Math.abs(beats[i].time - target);
        if (d < nearestDiff) { nearestDiff = d; nearestIdx = i; }
    }
    const count = ((nearestIdx + phraseOffset) % 8) + 1;
    return {
        beatTime: beats[nearestIdx].time,
        beatIdx: nearestIdx,
        diff: nearestDiff,
        count,
        pass: count === 1,
    };
}

// ── ANSI colours ─────────────────────────────────────────────────────────────
const G = s => `\x1b[32m${s}\x1b[0m`;
const R = s => `\x1b[31m${s}\x1b[0m`;
const Y = s => `\x1b[33m${s}\x1b[0m`;
const B = s => `\x1b[36m${s}\x1b[0m`;
const D = s => `\x1b[2m${s}\x1b[0m`;

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    const app = new BeatCounterApp();
    let totalPass = 0, totalFail = 0;

    for (const [filename, expectedTimes] of Object.entries(EXPECTED)) {
        const filePath = path.join(MP3_DIR, filename);
        if (!fs.existsSync(filePath)) {
            console.log(Y(`\n⚠  ${filename} not found, skipping`));
            continue;
        }

        console.log(B(`\n── ${filename} ──────────────────────────────────`));

        const raw = fs.readFileSync(filePath);
        const arrayBuffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);

        const song = {
            name: filename,
            audioBuffer: await app.audioContext.decodeAudioData(arrayBuffer),
        };

        // Run the analysis pipeline (replicate processSong without FileReader)
        song.bands = [];
        for (let b = 0; b < app.BANDS.length; b++) {
            const bandDef = app.BANDS[b];
            process.stdout.write(`  band ${b+1}/8 ${bandDef.name}…\r`);
            const filteredData = await app.filterBand(song.audioBuffer, bandDef);
            const envelope     = app.computeEnvelope(filteredData, song.audioBuffer.sampleRate);
            const beats        = app.detectBandBeats(envelope, song.audioBuffer.sampleRate);
            const bpm          = app.estimateBpm(beats);
            const validated    = app.validate8Counts(beats, bpm, song.audioBuffer.duration);
            const phraseResult = app.findBandPhraseAlignment(validated, envelope);
            song.bands.push({
                name: bandDef.name, envelope, beats: validated, bpm,
                phraseOffset:    phraseResult.offset,
                phraseConfidence: phraseResult.confidence,
            });
        }
        process.stdout.write('                                          \r');

        // Derive global beats from bass band (index 1)
        song.beats = song.bands[1].beats;
        song.bpm   = song.bands[1].bpm;

        // Energy consensus: aggregate raw onset strengths across all bands
        const bandWeights = [0.5, 1.0, 0.8, 0.6, 0.4, 0.3, 0.2, 0.1];
        const aggregatedOnset = new Float64Array(8);
        for (let b = 0; b < song.bands.length; b++) {
            const result = app.findBandPhraseAlignment(song.beats, song.bands[b].envelope);
            if (result.positionEnergy) {
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
        let maxAO = 0, secondAO = 0, bestAP = 0;
        for (let i = 0; i < 8; i++) {
            if (aggregatedOnset[i] > maxAO) { secondAO = maxAO; maxAO = aggregatedOnset[i]; bestAP = i; }
            else if (aggregatedOnset[i] > secondAO) secondAO = aggregatedOnset[i];
        }
        // Backbeat correction: in swing, the strongest onset is typically on beat 2
        const bestEP = (bestAP - 1 + 8) % 8;
        song.energyConsensusOffset     = (8 - bestEP) % 8;
        song.energyConsensusConfidence = maxAO > 0 ? (maxAO - secondAO) / maxAO : 0;

        // Harmony
        song.analysis = {};
        process.stdout.write('  computing chromagram…\r');
        const channelData = song.audioBuffer.getChannelData(0);
        song.analysis.chroma = await app.computeChromagram(channelData, song.audioBuffer.sampleRate);
        const harmonyResult = app.computeBeatSyncChroma(song.analysis.chroma, song.beats);
        song.analysis.harmonyBeatDistances = harmonyResult.beatDistances;
        song.analysis.harmonyBeatChroma    = harmonyResult.beatChroma;
        const harmonyPhrase = app.findHarmonyPhraseOffset(harmonyResult.beatDistances, song.beats);
        song.analysis.harmonyPhraseOffset  = harmonyPhrase.offset;
        song.analysis.harmonyConfidence    = harmonyPhrase.confidence;

        // Rhythm
        song.analysis.rhythmData         = app.computeRhythmPattern(song.bands, song.beats);
        song.analysis.rhythmPhraseOffset  = song.analysis.rhythmData.phraseOffset;
        song.analysis.rhythmConfidence    = song.analysis.rhythmData.confidence;

        // Combined
        song.analysis.combinedData        = app.computeCombinedPhraseOffset(song);
        song.analysis.combinedPhraseOffset = song.analysis.combinedData.phraseOffset;
        process.stdout.write('                              \r');

        console.log(`  BPM: ${song.bpm?.toFixed(1)}   Bass beats: ${song.beats.length}   Expected "1" at: ${expectedTimes.join(', ')}s`);
        console.log();

        // Per-band phrase offsets
        console.log(D('  Per-band: ' + song.bands.map((b,i) =>
            `${b.name}[${b.phraseOffset}/${(b.phraseConfidence*100).toFixed(0)}%]`
        ).join('  ')));
        // Show aggregated onset pattern
        const aoMax = Math.max(...aggregatedOnset);
        const aoBar = Array.from(aggregatedOnset).map((v,i) =>
            `[${i}]${(v/aoMax*10).toFixed(0).padStart(2)}`).join(' ');
        console.log(D(`  Energy onset pattern: ${aoBar}  peak=${bestAP} corr=-1`));
        console.log(D(`  Energy consensus: offset=${song.energyConsensusOffset} conf=${(song.energyConsensusConfidence*100).toFixed(0)}%`));
        console.log(D(`  Harmony:  offset=${song.analysis.harmonyPhraseOffset} conf=${(song.analysis.harmonyConfidence*100).toFixed(0)}%`));
        console.log(D(`  Rhythm:   offset=${song.analysis.rhythmPhraseOffset} conf=${(song.analysis.rhythmConfidence*100).toFixed(0)}%`));
        console.log(D(`  Combined: offset=${song.analysis.combinedPhraseOffset}`));

        // Show rhythm pattern per position
        const rp = song.analysis.rhythmData.combinedPattern;
        const rpMax = Math.max(...rp);
        const rpBar = Array.from(rp).map((v,i) =>
            `[${i}]${(v/rpMax*10).toFixed(0).padStart(2)}`).join(' ');
        console.log(D(`  Rhythm pattern (pos→strength): ${rpBar}`));

        // Show beats near each expected time
        for (const targetTime of expectedTimes) {
            const nearBeats = song.beats
                .map((b, i) => ({ time: b.time, idx: i, pos: i % 8, diff: Math.abs(b.time - targetTime) }))
                .filter(b => b.diff < 3.0)
                .sort((a, b) => a.diff - b.diff)
                .slice(0, 6);
            console.log(D(`  Beats near ${targetTime}s: ` + nearBeats.map(b =>
                `t=${b.time.toFixed(3)}[i=${b.idx},pos=${b.pos},Δ=${b.diff.toFixed(3)}]`
            ).join('  ')));
        }

        // Drift analysis: check beat interval consistency between expected times
        if (expectedTimes.length >= 2) {
            const interval = 60 / song.bpm;
            for (let t = 1; t < expectedTimes.length; t++) {
                const span = expectedTimes[t] - expectedTimes[0];
                const beatsInSpan = Math.round(span / interval);
                const impliedInterval = span / beatsInSpan;
                const impliedBpm = 60 / impliedInterval;
                const drift = span - beatsInSpan * interval;
                console.log(D(`  Drift ${expectedTimes[0]}→${expectedTimes[t]}s: ${span.toFixed(3)}s = ${beatsInSpan} beats, implied BPM=${impliedBpm.toFixed(1)}, drift=${drift.toFixed(3)}s`));
            }
        }
        console.log();

        // Check each method at each expected time
        for (const targetTime of expectedTimes) {
            console.log(`  @${targetTime}s ${'Method'.padEnd(10)} ${'Offset'.padEnd(8)} ${'Nearest beat'.padEnd(16)} ${'Count'.padEnd(7)} Result`);
            console.log(`  ${'-'.repeat(65)}`);

            for (const method of METHODS) {
                app.activeMethod = method;
                const offset = app.getPhraseOffsetForMethod(song);
                const r = checkNearestBeat(song.beats, offset, targetTime);
                if (r.pass) totalPass++; else totalFail++;
                const result = r.pass ? G('✓ PASS') : R(`✗ FAIL (counted as "${r.count}")`);
                console.log(`  ${(' ').repeat(7)} ${method.padEnd(10)} ${String(offset).padEnd(8)} ${(r.beatTime.toFixed(3) + 's [i=' + r.beatIdx + ']').padEnd(16)} ${String(r.count).padEnd(7)} ${result}`);
            }
            console.log();
        }
    }

    console.log(`${'─'.repeat(50)}`);
    const summary = `${totalPass} passed, ${totalFail} failed`;
    console.log(totalFail === 0 ? G(summary) : R(summary));
}

main().catch(e => { console.error(e); process.exit(1); });
