// === COMBINED: Multi-feature weighted voting ===

BeatCounterApp.prototype.computeCombinedPhraseOffset = function(song) {
    // Each method votes for its best position, weighted by confidence
    const votes = new Float64Array(8);

    // Energy (bass band): weight 1.0
    if (song.bands && song.bands[1]) {
        const offset = song.bands[1].phraseOffset;
        const pos = (8 - offset) % 8;
        votes[pos] += 1.0;
    }

    // Harmony (beat-sync chroma): weight 1.5 (highest - research says best)
    if (song.analysis.harmonyPhraseOffset != null) {
        const offset = song.analysis.harmonyPhraseOffset;
        const pos = (8 - offset) % 8;
        votes[pos] += 1.5;
    }

    // Rhythm (onset pattern): weight 1.0
    if (song.analysis.rhythmPhraseOffset != null) {
        const offset = song.analysis.rhythmPhraseOffset;
        const pos = (8 - offset) % 8;
        votes[pos] += 1.0;
    }

    // Find position with most votes
    let maxVotes = 0, bestPos = 0;
    for (let i = 0; i < 8; i++) {
        if (votes[i] > maxVotes) { maxVotes = votes[i]; bestPos = i; }
    }

    return {
        votes,
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
