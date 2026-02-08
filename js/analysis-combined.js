// === COMBINED: Multi-feature weighted voting ===

BeatCounterApp.prototype.computeCombinedPhraseOffset = function(song) {
    // Each method votes for its best position, weighted by its confidence
    const votes = new Float64Array(8);
    const methods = [];

    // Energy (bass band): confidence-weighted
    if (song.bands && song.bands[1]) {
        const offset = song.bands[1].phraseOffset;
        const confidence = song.bands[1].phraseConfidence || 0;
        const pos = (8 - offset) % 8;
        votes[pos] += confidence;
        methods.push({ name: 'Energy', offset, confidence });
    }

    // Harmony (beat-sync chroma): confidence-weighted
    if (song.analysis.harmonyPhraseOffset != null) {
        const offset = song.analysis.harmonyPhraseOffset;
        const confidence = song.analysis.harmonyConfidence || 0;
        const pos = (8 - offset) % 8;
        votes[pos] += confidence;
        methods.push({ name: 'Harmony', offset, confidence });
    }

    // Rhythm (onset pattern): confidence-weighted
    if (song.analysis.rhythmPhraseOffset != null) {
        const offset = song.analysis.rhythmPhraseOffset;
        const confidence = song.analysis.rhythmConfidence || 0;
        const pos = (8 - offset) % 8;
        votes[pos] += confidence;
        methods.push({ name: 'Rhythm', offset, confidence });
    }

    // Find position with most votes
    let maxVotes = 0, bestPos = 0;
    for (let i = 0; i < 8; i++) {
        if (votes[i] > maxVotes) { maxVotes = votes[i]; bestPos = i; }
    }

    return {
        votes,
        methods,
        phraseOffset: (8 - bestPos) % 8
    };
};

BeatCounterApp.prototype.getPhraseOffsetForMethod = function(song) {
    // Manual override takes precedence
    if (song.manualPhraseOffset != null) return song.manualPhraseOffset;
    if (!song.analysis) return song.bands[1].phraseOffset;
    switch (this.activeMethod) {
        case 'energy': return song.bands[1].phraseOffset;
        case 'harmony': return song.analysis.harmonyPhraseOffset;
        case 'rhythm': return song.analysis.rhythmPhraseOffset;
        case 'combined': return song.analysis.combinedPhraseOffset;
        default: return song.bands[1].phraseOffset;
    }
};
