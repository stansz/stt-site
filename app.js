// Speech to Text — Main Application
// Uses Transformers.js Whisper for client-side transcription

let isRecording = false;
let isRealtime = true;
let audioContext = null;
let mediaStream = null;
let mediaRecorder = null;
let audioChunks = [];
let worker = null;
let fullTranscript = '';
let realtimeBuffer = [];
let realtimeTimer = null;

// DOM
const modeRealtime = document.getElementById('modeRealtime');
const modeRecord = document.getElementById('modeRecord');
const micButton = document.getElementById('micButton');
const status = document.getElementById('status');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressLabel = document.getElementById('progressLabel');
const transcript = document.getElementById('transcript');
const copyButton = document.getElementById('copyButton');
const clearButton = document.getElementById('clearButton');
const languageSelect = document.getElementById('languageSelect');

// Init worker
function initWorker() {
    if (worker) return;
    worker = new Worker('worker.js', { type: 'module' });
    worker.onmessage = (e) => {
        const msg = e.data;
        switch (msg.type) {
            case 'ready':
                status.textContent = 'Model loaded — ready!';
                progressContainer.classList.add('hidden');
                progressLabel.textContent = '';
                break;
            case 'progress':
                const pct = Math.round(msg.progress * 100);
                progressBar.style.width = pct + '%';
                progressLabel.textContent = msg.file || `Loading... ${pct}%`;
                break;
            case 'transcript':
                if (msg.final) {
                    fullTranscript += (fullTranscript ? ' ' : '') + msg.text;
                    transcript.textContent = fullTranscript;
                } else {
                    transcript.textContent = fullTranscript + (fullTranscript ? ' ' : '') + msg.text;
                }
                break;
            case 'error':
                status.textContent = 'Error: ' + msg.message;
                stopRecording();
                break;
            case 'loading':
                status.textContent = 'Loading model...';
                progressContainer.classList.remove('hidden');
                break;
        }
    };
    worker.onerror = (e) => {
        status.textContent = 'Worker error: ' + e.message;
    };
}

// Mode toggle
modeRealtime.addEventListener('click', () => {
    isRealtime = true;
    modeRealtime.classList.add('active');
    modeRecord.classList.remove('active');
});

modeRecord.addEventListener('click', () => {
    isRealtime = false;
    modeRecord.classList.add('active');
    modeRealtime.classList.remove('active');
});

// Mic button
micButton.addEventListener('click', () => {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
});

// Copy / Clear
copyButton.addEventListener('click', () => {
    const text = fullTranscript || transcript.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        copyButton.textContent = '✅ Copied!';
        setTimeout(() => copyButton.textContent = '📋 Copy', 1500);
    });
});

clearButton.addEventListener('click', () => {
    fullTranscript = '';
    transcript.textContent = '';
});

// Recording
async function startRecording() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: { channelCount: 1, sampleRate: 16000 }
        });
    } catch (err) {
        status.textContent = 'Microphone access denied';
        return;
    }

    initWorker();
    isRecording = true;
    micButton.classList.add('recording');
    audioChunks = [];
    transcript.textContent = '';
    fullTranscript = '';

    audioContext = new AudioContext({ sampleRate: 16000 });

    if (isRealtime) {
        status.textContent = 'Listening...';
        startRealtime();
    } else {
        status.textContent = 'Recording...';
        startRecordMode();
    }
}

function stopRecording() {
    isRecording = false;
    micButton.classList.remove('recording');

    if (realtimeTimer) {
        clearInterval(realtimeTimer);
        realtimeTimer = null;
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }

    if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
    }

    if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
    }

    status.textContent = 'Stopped';
}

// Real-time mode: capture chunks every 5 seconds
function startRealtime() {
    const source = audioContext.createMediaStreamSource(mediaStream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(audioContext.destination);

    let chunkBuffer = [];
    const CHUNK_DURATION = 5; // seconds
    const samplesPerChunk = 16000 * CHUNK_DURATION;

    processor.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        chunkBuffer.push(new Float32Array(data));

        // Check if we have enough for a chunk
        let total = chunkBuffer.reduce((s, b) => s + b.length, 0);
        if (total >= samplesPerChunk) {
            // Merge and send
            const merged = new Float32Array(total);
            let offset = 0;
            for (const b of chunkBuffer) {
                merged.set(b, offset);
                offset += b.length;
            }
            chunkBuffer = [];

            // Send last N samples
            const toSend = merged.length > samplesPerChunk
                ? merged.slice(merged.length - samplesPerChunk)
                : merged;

            worker.postMessage({
                type: 'transcribe',
                audio: toSend,
                language: languageSelect.value
            });
        }
    };

    // Store processor ref so it doesn't get GC'd
    window._processor = processor;
    window._source = source;
}

// Record mode: capture full audio then transcribe
function startRecordMode() {
    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        audioChunks = [];

        status.textContent = 'Transcribing...';

        // Decode audio to Float32Array
        const arrayBuf = await blob.arrayBuffer();
        const tempCtx = new AudioContext({ sampleRate: 16000 });
        try {
            const audioBuf = await tempCtx.decodeAudioData(arrayBuf);
            const audio = audioBuf.getChannelData(0);
            worker.postMessage({
                type: 'transcribe',
                audio: audio,
                language: languageSelect.value,
                final: true
            });
        } catch (err) {
            status.textContent = 'Error decoding audio: ' + err.message;
        }
        tempCtx.close();
    };
    mediaRecorder.start();
}

// Init on load
status.textContent = 'Click the mic to start';
