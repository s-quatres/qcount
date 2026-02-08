// === VISUALIZATION ===

BeatCounterApp.prototype.getCanvasHeight = function() {
    // All methods share the same base: 12 chroma rows + 8 energy bands
    return 360;
};

BeatCounterApp.prototype.setupCanvas = function() {
    const container = document.getElementById('vizContainer');
    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth || 800;
    const height = this.getCanvasHeight();

    this.vizCanvas.width = width * dpr;
    this.vizCanvas.height = height * dpr;
    this.vizCanvas.style.height = height + 'px';
    this.vizCtx.scale(dpr, dpr);
    this.canvasWidth = width;
    this.canvasHeight = height;

    // Band labels are now drawn on canvas in drawBaseLayer
    this.bandLabelsEl.innerHTML = '';

    // Redraw if we have data
    if (this.currentSong && this.currentSong.processed) {
        const t = this.isPlaying
            ? this.audioContext.currentTime - this.startTime
            : this.pauseTime;
        this.drawVisualization(t);
    }
};

BeatCounterApp.prototype.drawVisualization = function(currentTime) {
    const ctx = this.vizCtx;
    const song = this.currentSong;
    if (!ctx || !song || !song.processed) return;

    ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);

    // Always draw chroma background + energy overlays
    this.drawBaseLayer(ctx, currentTime);

    // Then draw method-specific overlay
    switch (this.activeMethod) {
        case 'energy': this.drawEnergyOverlay(ctx, currentTime); break;
        case 'harmony': this.drawHarmonyOverlay(ctx, currentTime); break;
        case 'rhythm': this.drawRhythmOverlay(ctx, currentTime); break;
        case 'combined': this.drawCombinedOverlay(ctx, currentTime); break;
    }

    this.drawOverlays(ctx, currentTime);
};

BeatCounterApp.prototype.drawOverlays = function(ctx, currentTime) {
    const w = this.canvasWidth, h = this.canvasHeight;
    const halfWindow = this.WINDOW_SECONDS / 2;
    const windowStart = currentTime - halfWindow;
    const windowEnd = currentTime + halfWindow;
    const duration = this.currentSong.audioBuffer.duration;

    // Playhead
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    ctx.setLineDash([]);

    // Time markers
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px sans-serif';
    for (let t = Math.ceil(windowStart); t <= Math.floor(windowEnd); t++) {
        if (t < 0 || t > duration || t % 5 !== 0) continue;
        const x = ((t - windowStart) / this.WINDOW_SECONDS) * w;
        ctx.fillText(this.formatTime(t), x + 2, h - 3);
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
    }

    // Manual override indicator
    if (this.currentSong && this.currentSong.manualPhraseOffset != null) {
        ctx.fillStyle = 'rgba(76, 217, 100, 0.8)';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('MANUAL (shift-click to change, switch method to reset)', w - 330, 12);
    }
};

BeatCounterApp.prototype.drawBeatMarkers = function(ctx, beats, phraseOffset, y, h, color, windowStart, windowEnd) {
    const w = this.canvasWidth;
    for (let i = 0; i < beats.length; i++) {
        const beat = beats[i];
        if (beat.time < windowStart || beat.time > windowEnd) continue;
        const x = ((beat.time - windowStart) / this.WINDOW_SECONDS) * w;
        const count = ((i + phraseOffset) % 8) + 1;
        const isPhrase = (count === 1);

        if (isPhrase) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.5;
            ctx.globalAlpha = 0.9;
        } else {
            ctx.strokeStyle = color;
            ctx.lineWidth = 0.5;
            ctx.globalAlpha = 0.3;
        }
        ctx.beginPath();
        ctx.moveTo(x, y + 2);
        ctx.lineTo(x, y + h - 2);
        ctx.stroke();
        ctx.globalAlpha = 1.0;

        if (isPhrase) {
            ctx.fillStyle = color;
            ctx.font = 'bold 9px sans-serif';
            ctx.fillText('1', x + 2, y + 11);
        }
    }
};

// === SHARED BASE LAYER: Chroma heatmap background + Energy band overlays ===
BeatCounterApp.prototype.drawBaseLayer = function(ctx, currentTime) {
    const w = this.canvasWidth, h = this.canvasHeight;
    const song = this.currentSong;
    const chroma = song.analysis ? song.analysis.chroma : null;
    const halfWindow = this.WINDOW_SECONDS / 2;
    const windowStart = currentTime - halfWindow;
    const windowEnd = currentTime + halfWindow;
    const hopSec = this.ENVELOPE_HOP_MS / 1000;

    // --- Chroma heatmap background ---
    if (chroma) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        const rowH = h / 12;

        let maxChroma = 0;
        for (let c = 0; c < 12; c++) {
            for (let f = 0; f < chroma[c].length; f++) {
                if (chroma[c][f] > maxChroma) maxChroma = chroma[c][f];
            }
        }
        if (maxChroma === 0) maxChroma = 1;

        const startFrame = Math.max(0, Math.floor(windowStart / hopSec));
        const endFrame = Math.min(chroma[0].length - 1, Math.ceil(windowEnd / hopSec));
        const pixelsPerFrame = w / ((endFrame - startFrame) || 1);
        const step = Math.max(1, Math.floor(1 / pixelsPerFrame));

        for (let c = 0; c < 12; c++) {
            const rowY = (11 - c) * rowH; // C at bottom, B at top
            ctx.fillStyle = 'rgba(0,0,0,0.12)';
            ctx.fillRect(0, rowY, w, rowH);

            for (let f = startFrame; f <= endFrame; f += step) {
                const t = f * hopSec;
                const x = ((t - windowStart) / this.WINDOW_SECONDS) * w;
                const nextX = ((t + step * hopSec - windowStart) / this.WINDOW_SECONDS) * w;
                const val = chroma[c][f] / maxChroma;
                if (val < 0.01) continue;

                const hue = 30 + c * 25;
                const alpha = Math.min(0.5, val * 0.55);
                ctx.fillStyle = `hsla(${hue}, 80%, 55%, ${alpha})`;
                ctx.fillRect(x, rowY + 1, Math.max(1, nextX - x), rowH - 2);
            }

            // Note label on RIGHT
            ctx.fillStyle = 'rgba(255,255,255,0.35)';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(noteNames[c], w - 4, rowY + rowH - 4);
            ctx.textAlign = 'left';

            // Row separator
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, rowY + rowH);
            ctx.lineTo(w, rowY + rowH);
            ctx.stroke();
        }
    } else {
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(0, 0, w, h);
    }

    // --- Energy band overlays ---
    const bandH = h / song.bands.length;
    for (let b = 0; b < song.bands.length; b++) {
        const band = song.bands[b];
        const bandY = b * bandH;

        let maxEnv = 0;
        for (let i = 0; i < band.envelope.length; i++) {
            if (band.envelope[i] > maxEnv) maxEnv = band.envelope[i];
        }
        if (maxEnv === 0) maxEnv = 1;

        const sf = Math.max(0, Math.floor(windowStart / hopSec));
        const ef = Math.min(band.envelope.length - 1, Math.ceil(windowEnd / hopSec));

        // Filled envelope (semi-transparent)
        ctx.beginPath();
        for (let f = sf; f <= ef; f++) {
            const t = f * hopSec;
            const x = ((t - windowStart) / this.WINDOW_SECONDS) * w;
            const val = band.envelope[f] / maxEnv;
            const y = bandY + bandH - val * bandH * 0.85;
            if (f === sf) { ctx.moveTo(x, bandY + bandH); ctx.lineTo(x, y); }
            else ctx.lineTo(x, y);
        }
        const lastX = ((ef * hopSec - windowStart) / this.WINDOW_SECONDS) * w;
        ctx.lineTo(lastX, bandY + bandH);
        ctx.closePath();
        ctx.fillStyle = band.color + '18';
        ctx.fill();

        // Stroke line
        ctx.strokeStyle = band.color + '55';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let f = sf; f <= ef; f++) {
            const t = f * hopSec;
            const x = ((t - windowStart) / this.WINDOW_SECONDS) * w;
            const val = band.envelope[f] / maxEnv;
            const y = bandY + bandH - val * bandH * 0.85;
            if (f === sf) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Band frequency label on LEFT
        ctx.fillStyle = band.color + '70';
        ctx.font = '8px sans-serif';
        ctx.fillText(band.name, 4, bandY + 10);
    }
};

// === ENERGY OVERLAY: beat markers per band + consensus ===
BeatCounterApp.prototype.drawEnergyOverlay = function(ctx, currentTime) {
    const w = this.canvasWidth, h = this.canvasHeight;
    const song = this.currentSong;
    const halfWindow = this.WINDOW_SECONDS / 2;
    const windowStart = currentTime - halfWindow;
    const windowEnd = currentTime + halfWindow;
    const bandH = h / song.bands.length;

    // Per-band beat markers and confidence labels
    for (let b = 0; b < song.bands.length; b++) {
        const band = song.bands[b];
        const bandY = b * bandH;
        this.drawBeatMarkers(ctx, band.beats, band.phraseOffset || 0, bandY, bandH, band.color, windowStart, windowEnd);

        // Confidence % next to band label
        const confPct = Math.round((band.phraseConfidence || 0) * 100);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '7px sans-serif';
        ctx.fillText(confPct + '%', 4 + ctx.measureText(band.name).width + 4, bandY + 10);

        // Band separator
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, bandY + bandH);
        ctx.lineTo(w, bandY + bandH);
        ctx.stroke();
    }

    // Consensus beat markers (confidence-weighted across all bands)
    const consensusOffset = song.energyConsensusOffset || 0;
    this.drawBeatMarkers(ctx, song.beats, consensusOffset, 0, h, 'rgba(255,255,255,0.7)', windowStart, windowEnd);
};

// === HARMONY OVERLAY: beat-sync chroma distance stems ===
BeatCounterApp.prototype.drawHarmonyOverlay = function(ctx, currentTime) {
    const w = this.canvasWidth, h = this.canvasHeight;
    const song = this.currentSong;
    const beatDistances = song.analysis.harmonyBeatDistances;
    const beats = song.beats;
    const halfWindow = this.WINDOW_SECONDS / 2;
    const windowStart = currentTime - halfWindow;
    const windowEnd = currentTime + halfWindow;
    const phraseOffset = song.phraseOffset;

    let maxDist = 0;
    for (let i = 0; i < beatDistances.length; i++) {
        if (beatDistances[i] > maxDist) maxDist = beatDistances[i];
    }
    if (maxDist === 0) maxDist = 1;

    const margin = 10;

    // Draw stems at each beat position
    for (let i = 0; i < beats.length; i++) {
        const beat = beats[i];
        if (beat.time < windowStart || beat.time > windowEnd) continue;
        const x = ((beat.time - windowStart) / this.WINDOW_SECONDS) * w;
        const val = beatDistances[i] / maxDist;
        const barH = val * (h - margin * 2);
        const count = ((i + phraseOffset) % 8) + 1;
        const isPhrase = count === 1;

        if (isPhrase) {
            ctx.fillStyle = 'rgba(46, 204, 113, 0.75)';
        } else {
            ctx.fillStyle = 'rgba(46, 204, 113, 0.2)';
        }

        const stemWidth = Math.max(2, w / 80);
        ctx.fillRect(x - stemWidth / 2, h - margin - barH, stemWidth, barH);

        if (isPhrase) {
            ctx.fillStyle = '#2ecc71';
            ctx.font = 'bold 9px sans-serif';
            ctx.fillText('1', x + stemWidth / 2 + 2, h - margin - barH - 2);
        }
    }

    // Beat markers
    this.drawBeatMarkers(ctx, beats, phraseOffset, 0, h, '#2ecc71', windowStart, windowEnd);
};

// === RHYTHM OVERLAY: onset strength at beat positions ===
BeatCounterApp.prototype.drawRhythmOverlay = function(ctx, currentTime) {
    const w = this.canvasWidth, h = this.canvasHeight;
    const song = this.currentSong;
    const rhythm = song.analysis.rhythmData;
    const phraseOffset = song.phraseOffset;
    const beats = song.beats;
    const halfWindow = this.WINDOW_SECONDS / 2;
    const windowStart = currentTime - halfWindow;
    const windowEnd = currentTime + halfWindow;

    // Normalize combined pattern
    const combined = rhythm.combinedPattern;
    let maxComb = 0;
    for (let i = 0; i < 8; i++) {
        if (combined[i] > maxComb) maxComb = combined[i];
    }
    if (maxComb === 0) maxComb = 1;

    // Draw onset strength as colored circles at each beat
    for (let i = 0; i < beats.length; i++) {
        const beat = beats[i];
        if (beat.time < windowStart || beat.time > windowEnd) continue;
        const x = ((beat.time - windowStart) / this.WINDOW_SECONDS) * w;
        const pos = i % 8;
        const val = combined[pos] / maxComb;
        const count = ((i + phraseOffset) % 8) + 1;
        const isPhrase = count === 1;

        // Draw circle at bottom of canvas, size = onset strength
        const maxR = 12;
        const r = 2 + val * maxR;
        const cy = h - 20;

        ctx.beginPath();
        ctx.arc(x, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = isPhrase ? 'rgba(230, 126, 34, 0.7)' : 'rgba(230, 126, 34, 0.2)';
        ctx.fill();

        if (isPhrase) {
            ctx.strokeStyle = '#e67e22';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    // Small radar overlay in top-left corner
    const radarCX = 70;
    const radarCY = 70;
    const radarR = 50;

    // Semi-transparent background for radar
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.arc(radarCX, radarCY, radarR + 18, 0, Math.PI * 2);
    ctx.fill();

    // Radar grid
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    for (let r = 0.5; r <= 1; r += 0.5) {
        ctx.beginPath();
        ctx.arc(radarCX, radarCY, radarR * r, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Radar polygon
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
        const adjustedPos = (i + (8 - phraseOffset)) % 8;
        const angle = -Math.PI / 2 + (adjustedPos / 8) * Math.PI * 2;
        const val = combined[i] / maxComb;
        const px = radarCX + Math.cos(angle) * radarR * val;
        const py = radarCY + Math.sin(angle) * radarR * val;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(230, 126, 34, 0.3)';
    ctx.fill();
    ctx.strokeStyle = '#e67e22';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Labels around radar
    ctx.font = 'bold 9px sans-serif';
    for (let i = 0; i < 8; i++) {
        const adjustedPos = (i + (8 - phraseOffset)) % 8;
        const angle = -Math.PI / 2 + (adjustedPos / 8) * Math.PI * 2;
        const lx = radarCX + Math.cos(angle) * (radarR + 11);
        const ly = radarCY + Math.sin(angle) * (radarR + 11);
        const count = (i % 8) + 1;
        ctx.fillStyle = count === 1 ? '#e67e22' : 'rgba(255,255,255,0.4)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(count.toString(), lx, ly);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Beat markers
    this.drawBeatMarkers(ctx, beats, phraseOffset, 0, h, '#e67e22', windowStart, windowEnd);
};

// === COMBINED OVERLAY: method agreement panel ===
BeatCounterApp.prototype.drawCombinedOverlay = function(ctx, currentTime) {
    const w = this.canvasWidth, h = this.canvasHeight;
    const song = this.currentSong;
    const combined = song.analysis.combinedData;
    const phraseOffset = song.phraseOffset;
    const halfWindow = this.WINDOW_SECONDS / 2;
    const windowStart = currentTime - halfWindow;
    const windowEnd = currentTime + halfWindow;

    const methods = [
        { name: 'Energy', color: '#ff6b6b', offset: song.bands[1].phraseOffset, confidence: song.bands[1].phraseConfidence || 0 },
        { name: 'Harmony', color: '#2ecc71', offset: song.analysis.harmonyPhraseOffset, confidence: song.analysis.harmonyConfidence || 0 },
        { name: 'Rhythm', color: '#e67e22', offset: song.analysis.rhythmPhraseOffset, confidence: song.analysis.rhythmConfidence || 0 },
    ];

    // Semi-transparent panel in top-left
    const panelW = 310;
    const panelH = 20 + methods.length * 22 + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.roundRect(8, 8, panelW, panelH, 6);
    ctx.fill();

    // Title
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '9px sans-serif';
    ctx.fillText('Method agreement — beat 1 position (confidence)', 16, 22);

    // Each method's vote
    for (let m = 0; m < methods.length; m++) {
        const method = methods[m];
        const y = 32 + m * 22;
        const methodBestPos = (8 - method.offset) % 8;
        const confPct = Math.round(method.confidence * 100);

        // Method name + confidence
        ctx.fillStyle = method.color;
        ctx.font = '9px sans-serif';
        ctx.fillText(method.name, 16, y + 12);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(confPct + '%', 58, y + 12);

        // 8 position dots
        const dotStart = 90;
        const dotSpacing = 22;
        for (let pos = 0; pos < 8; pos++) {
            const dx = dotStart + pos * dotSpacing;
            const dy = y + 9;
            const isSelected = pos === methodBestPos;

            if (isSelected) {
                ctx.beginPath();
                ctx.arc(dx, dy, 6, 0, Math.PI * 2);
                ctx.fillStyle = method.color;
                ctx.globalAlpha = 0.3 + method.confidence * 0.7;
                ctx.fill();
                ctx.globalAlpha = 1.0;
                ctx.fillStyle = 'white';
                ctx.font = 'bold 8px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText((pos + 1).toString(), dx, dy + 3);
                ctx.textAlign = 'left';
            } else {
                ctx.beginPath();
                ctx.arc(dx, dy, 2.5, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(255,255,255,0.15)';
                ctx.fill();
            }
        }
    }

    // Beat markers
    this.drawBeatMarkers(ctx, song.beats, phraseOffset, 0, h, 'rgba(255,255,255,0.6)', windowStart, windowEnd);
};
