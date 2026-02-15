// === COMBINED: Multi-feature weighted voting ===

BeatCounterApp.prototype.computeCombinedPhraseOffset = function(song) {
    // Each method votes for its best position, weighted by its confidence
    // and a method-specific weight reflecting reliability in swing music.
    const votes = new Float64Array(8);
    const methods = [];

    // Energy (consensus across all bands): confidence-weighted
    if (song.energyConsensusOffset != null) {
        const offset = song.energyConsensusOffset;
        const confidence = song.energyConsensusConfidence || 0;
        const pos = (8 - offset) % 8;
        votes[pos] += confidence * 1.0;
        methods.push({ name: 'Energy', offset, confidence });
    }

    // Harmony (beat-sync chroma): low weight — unreliable for swing music
    // where chord changes don't consistently align with phrase boundaries.
    // Only include when confidence is high enough to be meaningful.
    const HARMONY_MIN_CONFIDENCE = 0.15;
    if (song.analysis.harmonyPhraseOffset != null &&
        (song.analysis.harmonyConfidence || 0) >= HARMONY_MIN_CONFIDENCE) {
        const offset = song.analysis.harmonyPhraseOffset;
        const confidence = song.analysis.harmonyConfidence;
        const pos = (8 - offset) % 8;
        votes[pos] += confidence * 0.5;
        methods.push({ name: 'Harmony', offset, confidence });
    }

    // Rhythm (onset pattern): confidence-weighted
    if (song.analysis.rhythmPhraseOffset != null) {
        const offset = song.analysis.rhythmPhraseOffset;
        const confidence = song.analysis.rhythmConfidence || 0;
        const pos = (8 - offset) % 8;
        votes[pos] += confidence * 1.0;
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
        case 'energy': return song.energyConsensusOffset != null ? song.energyConsensusOffset : song.bands[1].phraseOffset;
        case 'harmony': return song.analysis.harmonyPhraseOffset;
        case 'rhythm': return song.analysis.rhythmPhraseOffset;
        case 'combined': return song.analysis.combinedPhraseOffset;
        default: return song.bands[1].phraseOffset;
    }
};
