class BeatCounterApp {
    constructor() {
        this.audioContext = null;
        this.songs = [];
        this.currentSong = null;
        this.isPlaying = false;
        this.sourceNode = null;
        this.gainNode = null;
        this.startTime = 0;
        this.pauseTime = 0;
        this.animationFrame = null;
        this.scheduledCounts = [];
        this.currentCount = 0;

        // Voice
        this.synth = window.speechSynthesis;
        this.selectedVoice = null;
        this.voiceVolume = 0.7;
        this.musicVolume = 1.0;

        // Visualization
        this.WINDOW_SECONDS = 30;
        this.BAND_HEIGHT = 70;
        this.BAND_GAP = 2;
        this.ENVELOPE_HOP_MS = 10; // 10ms per envelope frame

        // 8 octave frequency bands
        this.BANDS = [
            { name: 'Sub-Bass', freq: 31.5, low: 20, high: 45, color: '#ff6b6b' },
            { name: 'Bass', freq: 63, low: 45, high: 90, color: '#ffa502' },
            { name: 'Low-Mid', freq: 125, low: 90, high: 180, color: '#ffd93d' },
            { name: 'Mid', freq: 250, low: 180, high: 355, color: '#6bcb77' },
            { name: 'Upper-Mid', freq: 500, low: 355, high: 710, color: '#4d96ff' },
            { name: 'Presence', freq: 1000, low: 710, high: 1400, color: '#9b59b6' },
            { name: 'Brilliance', freq: 2000, low: 1400, high: 2800, color: '#e056a0' },
            { name: 'Air', freq: 4000, low: 2800, high: 5600, color: '#00d2d3' },
        ];

        // UI Elements
        this.fileInput = document.getElementById('fileInput');
        this.fileBtn = document.getElementById('fileBtn');
        this.songList = document.getElementById('songList');
        this.playerPanel = document.getElementById('playerPanel');
        this.playBtn = document.getElementById('playBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.currentTimeEl = document.getElementById('currentTime');
        this.totalTimeEl = document.getElementById('totalTime');
        this.beatIndicator = document.getElementById('beatIndicator');
        this.currentCountEl = document.getElementById('currentCount');
        this.bpmValue = document.getElementById('bpmValue');
        this.beatsValue = document.getElementById('beatsValue');
        this.phrasesValue = document.getElementById('phrasesValue');
        this.voiceVolSlider = document.getElementById('voiceVolSlider');
        this.voiceVolValue = document.getElementById('voiceVolValue');
        this.musicVolSlider = document.getElementById('musicVolSlider');
        this.musicVolValue = document.getElementById('musicVolValue');
        this.processingOverlay = document.getElementById('processingOverlay');
        this.processingText = document.getElementById('processingText');
        this.processingDetail = document.getElementById('processingDetail');
        this.beatDots = document.querySelectorAll('.beat-dot');

        // Canvas
        this.vizCanvas = document.getElementById('vizCanvas');
        this.vizCtx = this.vizCanvas.getContext('2d');
        this.bandLabelsEl = document.getElementById('bandLabels');

        // Active detection method
        this.activeMethod = 'energy';

        this.bindEvents();
        this.selectBestVoice();
        this.setupCanvas();
    }
}

// === UI METHODS ===

BeatCounterApp.prototype.bindEvents = function() {
    // File input
    this.fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));

    // Drag and drop
    this.fileBtn.addEventListener('dragover', (e) => {
        e.preventDefault();
        this.fileBtn.style.borderColor = 'rgba(255,255,255,0.8)';
        this.fileBtn.style.background = 'rgba(255,255,255,0.2)';
    });

    this.fileBtn.addEventListener('dragleave', () => {
        this.fileBtn.style.borderColor = 'rgba(255,255,255,0.4)';
        this.fileBtn.style.background = 'rgba(255,255,255,0.1)';
    });

    this.fileBtn.addEventListener('drop', (e) => {
        e.preventDefault();
        this.fileBtn.style.borderColor = 'rgba(255,255,255,0.4)';
        this.fileBtn.style.background = 'rgba(255,255,255,0.1)';
        this.handleFiles(e.dataTransfer.files);
    });

    // Playback controls
    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.stopBtn.addEventListener('click', () => this.stop());

    // Canvas click to seek, shift-click to set beat 1
    this.vizCanvas.addEventListener('click', (e) => {
        if (!this.currentSong || !this.currentSong.processed) return;
        const rect = this.vizCanvas.getBoundingClientRect();
        const xRatio = (e.clientX - rect.left) / rect.width;
        const currentTime = this.isPlaying
            ? this.audioContext.currentTime - this.startTime
            : this.pauseTime;
        const windowStart = currentTime - this.WINDOW_SECONDS / 2;
        const clickTime = windowStart + xRatio * this.WINDOW_SECONDS;

        if (e.shiftKey) {
            // Shift-click: set nearest beat as "1"
            this.setManualBeatOne(clickTime);
        } else {
            this.seek(Math.max(0, Math.min(clickTime, this.currentSong.audioBuffer.duration)));
        }
    });

    // Volume sliders
    this.voiceVolSlider.addEventListener('input', (e) => {
        this.voiceVolume = e.target.value / 100;
        this.voiceVolValue.textContent = e.target.value + '%';
    });

    this.musicVolSlider.addEventListener('input', (e) => {
        this.musicVolume = e.target.value / 100;
        this.musicVolValue.textContent = e.target.value + '%';
        if (this.gainNode) {
            this.gainNode.gain.value = this.musicVolume;
        }
    });

    // Voice selection
    if (this.synth.onvoiceschanged !== undefined) {
        this.synth.onvoiceschanged = () => this.selectBestVoice();
    }

    // Resize canvas on window resize
    window.addEventListener('resize', () => this.setupCanvas());

    // Method selector buttons
    document.querySelectorAll('.method-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            this.activeMethod = btn.dataset.method;
            document.querySelectorAll('.method-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Switching method clears manual override
            if (this.currentSong) {
                this.currentSong.manualPhraseOffset = null;
            }

            // Update phrase offset and re-schedule counts if playing
            if (this.currentSong && this.currentSong.processed) {
                this.currentSong.phraseOffset = this.getPhraseOffsetForMethod(this.currentSong);
                this.setupCanvas();
                if (this.isPlaying) {
                    const currentTime = this.audioContext.currentTime - this.startTime;
                    this.synth.cancel();
                    this.clearScheduledCounts();
                    this.scheduleAllCounts(currentTime);
                    this.drawVisualization(currentTime);
                } else {
                    this.drawVisualization(this.pauseTime);
                }
            }
        });
    });
};

BeatCounterApp.prototype.handleFiles = async function(files) {
    if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    for (const file of files) {
        if (!file.type.startsWith('audio/')) continue;

        // Check if already added
        if (this.songs.find(s => s.name === file.name)) continue;

        const song = {
            name: file.name,
            file: file,
            audioBuffer: null,
            beats: [],
            bpm: 0,
            processed: false
        };

        this.songs.push(song);
    }

    this.renderSongList();
};

BeatCounterApp.prototype.renderSongList = function() {
    this.songList.innerHTML = '';

    for (const song of this.songs) {
        const item = document.createElement('div');
        item.className = 'song-item';
        if (this.currentSong === song) {
            item.classList.add('selected');
        }
        if (song.processed) {
            item.classList.add('ready');
        }

        let statusText = 'Click to process';
        if (song.processed) {
            statusText = 'Ready';
        }

        item.innerHTML = `
            <span class="song-name">${song.name}</span>
            ${song.processed ? `<span class="song-bpm">${song.bpm} BPM</span>` : ''}
            <span class="song-status">${statusText}</span>
        `;

        item.addEventListener('click', () => this.selectSong(song));
        this.songList.appendChild(item);
    }
};

BeatCounterApp.prototype.selectSong = async function(song) {
    this.stop();
    this.currentSong = song;
    this.playerPanel.style.display = 'block';
    this.renderSongList();

    if (!song.processed) {
        await this.processSong(song);
    }

    this.updatePlayerUI();
};

BeatCounterApp.prototype.updatePlayerUI = function() {
    const song = this.currentSong;
    if (!song) return;

    if (song.processed) {
        this.playBtn.disabled = false;
        this.playBtn.textContent = 'Play';
        this.bpmValue.textContent = song.bpm;
        this.beatsValue.textContent = song.beats.length;
        this.phrasesValue.textContent = Math.floor(song.beats.length / 8);
        this.totalTimeEl.textContent = this.formatTime(song.audioBuffer.duration);
        this.drawVisualization(0);
    } else {
        this.playBtn.disabled = true;
        this.playBtn.textContent = 'Processing...';
        this.bpmValue.textContent = '--';
        this.beatsValue.textContent = '--';
        this.phrasesValue.textContent = '--';
    }

    this.currentCountEl.textContent = '-';
    this.currentTimeEl.textContent = '0:00';
};

// === INTERACTION METHODS ===

BeatCounterApp.prototype.setManualBeatOne = function(clickTime) {
    const song = this.currentSong;
    if (!song || !song.processed) return;

    // Find the nearest beat to the click
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < song.beats.length; i++) {
        const dist = Math.abs(song.beats[i].time - clickTime);
        if (dist < nearestDist) {
            nearestDist = dist;
            nearestIdx = i;
        }
    }

    // Set the phrase offset so this beat becomes "1"
    // count = ((i + phraseOffset) % 8) + 1, we want count=1 so (i + offset) % 8 = 0
    song.manualPhraseOffset = (8 - (nearestIdx % 8)) % 8;
    song.phraseOffset = song.manualPhraseOffset;

    // Reschedule counts if playing
    if (this.isPlaying) {
        const currentTime = this.audioContext.currentTime - this.startTime;
        this.synth.cancel();
        this.clearScheduledCounts();
        this.scheduleAllCounts(currentTime);
        this.drawVisualization(currentTime);
    } else {
        this.drawVisualization(this.pauseTime);
    }

    console.log(`Manual beat 1 set: beat #${nearestIdx} at ${song.beats[nearestIdx].time.toFixed(2)}s, phraseOffset=${song.manualPhraseOffset}`);
};

BeatCounterApp.prototype.clearManualOverride = function() {
    const song = this.currentSong;
    if (!song) return;
    song.manualPhraseOffset = null;
    song.phraseOffset = this.getPhraseOffsetForMethod(song);
    if (this.isPlaying) {
        const currentTime = this.audioContext.currentTime - this.startTime;
        this.synth.cancel();
        this.clearScheduledCounts();
        this.scheduleAllCounts(currentTime);
        this.drawVisualization(currentTime);
    } else {
        this.drawVisualization(this.pauseTime);
    }
};

// === PLAYBACK METHODS ===

BeatCounterApp.prototype.togglePlay = function() {
    if (this.isPlaying) {
        this.pause();
    } else {
        this.play();
    }
};

BeatCounterApp.prototype.play = async function() {
    if (!this.currentSong || !this.currentSong.processed) return;

    // Resume audio context if suspended
    if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
    }

    // Create source and gain nodes
    this.sourceNode = this.audioContext.createBufferSource();
    this.sourceNode.buffer = this.currentSong.audioBuffer;

    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = this.musicVolume;

    this.sourceNode.connect(this.gainNode);
    this.gainNode.connect(this.audioContext.destination);

    // Calculate start position
    const offset = this.pauseTime;
    this.startTime = this.audioContext.currentTime - offset;

    this.sourceNode.start(0, offset);
    this.isPlaying = true;

    this.playBtn.textContent = 'Pause';
    this.playBtn.classList.add('playing');

    // Schedule all the counts
    this.scheduleAllCounts(offset);

    // Start animation loop
    this.updatePlayback();

    // Handle song end
    this.sourceNode.onended = () => {
        if (this.isPlaying) {
            this.stop();
        }
    };
};

BeatCounterApp.prototype.pause = function() {
    if (!this.isPlaying) return;

    this.pauseTime = this.audioContext.currentTime - this.startTime;
    this.sourceNode.stop();
    this.isPlaying = false;

    // Cancel scheduled speech
    this.synth.cancel();
    this.clearScheduledCounts();

    this.playBtn.textContent = 'Resume';
    this.playBtn.classList.remove('playing');

    if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
    }

    // Redraw visualization at paused position
    this.drawVisualization(this.pauseTime);
};

BeatCounterApp.prototype.stop = function() {
    if (this.sourceNode) {
        try {
            this.sourceNode.stop();
        } catch (e) {}
    }

    this.isPlaying = false;
    this.pauseTime = 0;

    this.synth.cancel();
    this.clearScheduledCounts();

    this.playBtn.textContent = 'Play';
    this.playBtn.classList.remove('playing');

    this.currentTimeEl.textContent = '0:00';
    this.currentCountEl.textContent = '-';
    this.beatIndicator.classList.remove('pulse', 'accent');
    this.clearDots();

    if (this.animationFrame) {
        cancelAnimationFrame(this.animationFrame);
    }

    // Redraw visualization at time 0
    if (this.currentSong && this.currentSong.processed) {
        this.drawVisualization(0);
    }
};

BeatCounterApp.prototype.seek = function(time) {
    const wasPlaying = this.isPlaying;

    if (this.isPlaying) {
        this.sourceNode.stop();
        this.synth.cancel();
        this.clearScheduledCounts();
    }

    this.pauseTime = Math.max(0, Math.min(time, this.currentSong.audioBuffer.duration));
    this.isPlaying = false;

    if (wasPlaying) {
        this.play();
    } else {
        this.currentTimeEl.textContent = this.formatTime(this.pauseTime);
        this.drawVisualization(this.pauseTime);
    }
};

BeatCounterApp.prototype.scheduleAllCounts = function(startOffset) {
    this.clearScheduledCounts();

    const beats = this.currentSong.beats;
    const phraseOffset = this.currentSong.phraseOffset || 0;
    const audioContextTime = this.audioContext.currentTime;

    for (let i = 0; i < beats.length; i++) {
        const beat = beats[i];
        const beatTime = beat.time - startOffset;

        if (beatTime < 0) continue; // Skip past beats

        // Apply phrase offset so "1" falls on accented beats
        const count = ((i + phraseOffset) % 8) + 1; // 1-8
        const triggerTime = audioContextTime + beatTime;

        // Schedule the count
        const timeout = setTimeout(() => {
            this.triggerCount(count);
        }, beatTime * 1000);

        this.scheduledCounts.push(timeout);
    }
};

BeatCounterApp.prototype.clearScheduledCounts = function() {
    for (const timeout of this.scheduledCounts) {
        clearTimeout(timeout);
    }
    this.scheduledCounts = [];
};

BeatCounterApp.prototype.triggerCount = function(count) {
    this.currentCount = count;

    // Update visual
    this.currentCountEl.textContent = count;
    this.beatIndicator.classList.remove('accent');
    if (count === 1) {
        this.beatIndicator.classList.add('accent');
    }

    this.beatIndicator.classList.add('pulse');
    setTimeout(() => this.beatIndicator.classList.remove('pulse'), 80);

    this.updateDots(count - 1);

    // Speak the count
    this.speakCount(count);
};

BeatCounterApp.prototype.speakCount = function(count) {
    if (this.synth.speaking) {
        this.synth.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(count.toString());

    if (this.selectedVoice) {
        utterance.voice = this.selectedVoice;
    }

    utterance.rate = 1.5;
    utterance.volume = this.voiceVolume;
    utterance.pitch = count === 1 ? 1.1 : 0.95;

    this.synth.speak(utterance);
};

BeatCounterApp.prototype.updatePlayback = function() {
    if (!this.isPlaying) return;

    const currentTime = this.audioContext.currentTime - this.startTime;
    this.currentTimeEl.textContent = this.formatTime(currentTime);

    // Draw the visualization
    this.drawVisualization(currentTime);

    this.animationFrame = requestAnimationFrame(() => this.updatePlayback());
};

// === UTILITY METHODS ===

BeatCounterApp.prototype.updateDots = function(index) {
    this.beatDots.forEach((dot, i) => {
        dot.classList.remove('current');
        if (i === index) {
            dot.classList.add('current');
        }
    });
};

BeatCounterApp.prototype.clearDots = function() {
    this.beatDots.forEach(dot => dot.classList.remove('current'));
};

BeatCounterApp.prototype.formatTime = function(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

BeatCounterApp.prototype.selectBestVoice = function() {
    const voices = this.synth.getVoices();
    if (voices.length === 0) return;

    const preferred = ['Samantha', 'Karen', 'Moira', 'Tessa', 'Fiona', 'Daniel', 'Google'];

    for (const name of preferred) {
        const voice = voices.find(v => v.name.includes(name));
        if (voice) {
            this.selectedVoice = voice;
            return;
        }
    }

    const englishVoice = voices.find(v => v.lang.startsWith('en'));
    if (englishVoice) {
        this.selectedVoice = englishVoice;
    }
};

BeatCounterApp.prototype.showProcessing = function(text, detail) {
    this.processingText.textContent = text;
    this.processingDetail.textContent = detail;
    this.processingOverlay.classList.add('active');
};

BeatCounterApp.prototype.hideProcessing = function() {
    this.processingOverlay.classList.remove('active');
};
