// Speech to Text — Main Application
// Uses Transformers.js Whisper for client-side transcription

let isRecording = false;
let isRealtime = false;
let isUploadMode = false;
let audioContext = null;
let mediaStream = null;
let mediaRecorder = null;
let audioChunks = [];
let worker = null;
let fullTranscript = '';
let modelReady = false;
let selectedModel = 'tiny';
let currentLoadedModel = null;

// DOM
const modeRealtime = document.getElementById('modeRealtime');
const modeRecord = document.getElementById('modeRecord');
const modeUpload = document.getElementById('modeUpload');
const micButton = document.getElementById('micButton');
const micIcon = document.getElementById('micIcon');
const micBlocked = document.getElementById('micBlocked');
const statusEl = document.getElementById('status');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const progressLabel = document.getElementById('progressLabel');
const transcript = document.getElementById('transcript');
const copyButton = document.getElementById('copyButton');
const clearButton = document.getElementById('clearButton');
const languageSelect = document.getElementById('languageSelect');
const modelStatusIcon = document.getElementById('modelStatusIcon');
const modelStatusText = document.getElementById('modelStatusText');
const modelDownloadBtn = document.getElementById('modelDownloadBtn');
const modelSelect = document.getElementById('modelSelect');
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');

// Info modal content
const INFO = {
    realtime: {
        title: 'Real-time Mode',
        body: 'Streams audio in 5-second chunks and transcribes each chunk as you speak. Results appear live but may have slight delays or miss words between chunks.<br><br><em style="color:var(--accent)">Experimental — may be less accurate than Record mode.</em>'
    },
    model: {
        title: 'AI Models',
        body: 'This app uses <strong>OpenAI Whisper</strong>, running entirely in your browser via Transformers.js. No audio data is sent to any server.<br><br>' +
            '<strong>🟢 Tiny</strong> — 40MB<br>' +
            '75M parameters. Best for quick notes, dictation, and short clips. Fastest transcription on any device. Good English accuracy, decent multilingual.<br><br>' +
            '<strong>🟡 Base</strong> — 75MB<br>' +
            '86M parameters. Noticeably better accuracy, especially for accented speech and noisy audio. Still fast on modern devices. Good balance of speed vs quality.<br><br>' +
            '<strong>🟠 Small</strong> — 250MB<br>' +
            '244M parameters. Significantly better multilingual support and accuracy. Handles background noise, multiple speakers, and quiet audio well. Slower on mobile — recommended for desktop.<br><br>' +
            'Models are <strong>cached</strong> by your browser after download. Switching between previously loaded models is instant.'
    },
    privacy: {
        title: '🔒 Privacy & Security',
        body: 'Your audio <strong>never leaves your device</strong>. All speech recognition runs locally in your browser.<br><br>• No data is sent to any server<br>• No recordings are stored<br>• Works offline after first load<br>• No accounts or tracking'
    }
};

// Info modal
function wireInfoTriggers() {
    document.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.classList.contains('info-trigger')) return;
        e.preventDefault();
        e.stopPropagation();
        const key = target.getAttribute('data-info');
        const info = INFO[key];
        if (!info) return;
        document.getElementById('infoModalTitle').textContent = info.title;
        document.getElementById('infoModalBody').innerHTML = info.body;
        document.getElementById('infoModal').classList.remove('hidden');
    });
    document.getElementById('infoModalClose').addEventListener('click', () => {
        document.getElementById('infoModal').classList.add('hidden');
    });
    document.getElementById('infoModal').addEventListener('click', (e) => {
        if (e.target.id === 'infoModal') document.getElementById('infoModal').classList.add('hidden');
    });
}
wireInfoTriggers();

// Model status
function updateModelStatus(state) {
    if (state === 'ready') {
        modelReady = true;
        modelStatusIcon.textContent = '✅';
        modelStatusIcon.className = 'model-status-icon ready';
        modelStatusText.textContent = selectedModel.charAt(0).toUpperCase() + selectedModel.slice(1) + ' model ready';
        modelDownloadBtn.classList.add('hidden');
        micIcon.classList.remove('hidden');
        micBlocked.classList.add('hidden');
        micButton.classList.remove('disabled');
    } else if (state === 'loading') {
        modelStatusIcon.textContent = '⏳';
        modelStatusIcon.className = 'model-status-icon loading';
        modelStatusText.textContent = 'Loading ' + selectedModel + '...';
        modelDownloadBtn.classList.add('hidden');
        micIcon.classList.remove('hidden');
        micBlocked.classList.add('hidden');
    } else {
        modelReady = false;
        modelStatusIcon.textContent = '⏳';
        modelStatusIcon.className = 'model-status-icon pending';
        modelStatusText.textContent = 'No model loaded';
        modelDownloadBtn.classList.remove('hidden');
        micIcon.classList.add('hidden');
        micBlocked.classList.remove('hidden');
        micButton.classList.add('disabled');
    }
}

// Worker
function initWorker() {
    if (worker) {
        // If switching models, terminate old worker
        if (!modelReady) return;
    }
    selectedModel = modelSelect.value;
    updateModelStatus('loading');
    worker = new Worker('worker.js', { type: 'module' });
    worker.onmessage = (e) => {
        const msg = e.data;
        switch (msg.type) {
            case 'ready':
                currentLoadedModel = msg.model;
                updateModelStatus('ready');
                statusEl.textContent = 'Ready — click the mic to start';
                progressContainer.classList.add('hidden');
                progressLabel.textContent = '';
                break;
            case 'progress':
                const pct = Math.round(msg.progress * 100);
                progressBar.style.width = pct + '%';
                progressLabel.textContent = msg.file || 'Loading... ' + pct + '%';
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
                statusEl.textContent = 'Error: ' + msg.message;
                stopRecording();
                break;
            case 'loading':
                updateModelStatus('loading');
                statusEl.textContent = 'Loading model...';
                progressContainer.classList.remove('hidden');
                break;
        }
    };
    worker.onerror = (e) => {
        statusEl.textContent = 'Worker error: ' + e.message;
    };
    worker.postMessage({ type: 'load', model: selectedModel });
}

// Download button
modelDownloadBtn.addEventListener('click', () => {
    initWorker();
});

// Model selector change — load new model
modelSelect.addEventListener('change', () => {
    selectedModel = modelSelect.value;
    modelReady = false;
    if (worker) {
        // Reuse worker, just load new model (cached models load instantly)
        updateModelStatus('loading');
        worker.postMessage({ type: 'load', model: selectedModel });
    } else {
        updateModelStatus('pending');
        statusEl.textContent = 'Download the selected model';
    }
});

const moonshineBadge = document.getElementById('moonshineBadge');
let whisperSelection = modelSelect.value;

// Mode toggles
function setMode(mode) {
    isUploadMode = mode === 'upload';
    isRealtime = mode === 'realtime';
    modeRealtime.classList.toggle('active', mode === 'realtime');
    modeRecord.classList.toggle('active', mode === 'record');
    modeUpload.classList.toggle('active', mode === 'upload');
    uploadArea.classList.toggle('hidden', mode !== 'upload');
    micButton.classList.toggle('hidden', mode === 'upload');

    if (mode === 'realtime') {
        // Real-time = Moonshine Base only
        whisperSelection = modelSelect.value;
        modelSelect.classList.add('hidden');
        moonshineBadge.classList.remove('hidden');
        if (worker) {
            const needsSwitch = currentLoadedModel !== 'moon';
            if (needsSwitch) {
                modelReady = false;
                updateModelStatus('loading');
                worker.postMessage({ type: 'load', model: 'moon' });
            }
        } else {
            selectedModel = 'moon';
            updateModelStatus('pending');
        }
    } else {
        // Record / Upload = Whisper
        modelSelect.classList.remove('hidden');
        moonshineBadge.classList.add('hidden');
        selectedModel = modelSelect.value;
        if (worker && currentLoadedModel !== selectedModel) {
            modelReady = false;
            updateModelStatus('loading');
            worker.postMessage({ type: 'load', model: selectedModel });
        } else if (!worker) {
            updateModelStatus('pending');
        }
    }

    if (mode === 'upload') {
        statusEl.textContent = modelReady ? 'Choose an audio file' : 'Download the model first';
    } else {
        statusEl.textContent = modelReady ? 'Click the mic to start' : 'Download the model first';
    }
}
modeRealtime.addEventListener('click', () => setMode('realtime'));
modeRecord.addEventListener('click', () => setMode('record'));
modeUpload.addEventListener('click', () => setMode('upload'));

// Upload handling
uploadArea.addEventListener('click', () => fileInput.click());
uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
});

function handleFile(file) {
    if (!file.type.startsWith('audio/')) {
        statusEl.textContent = 'Please select an audio file';
        return;
    }
    initWorker();
    statusEl.textContent = 'Decoding audio...';
    const reader = new FileReader();
    reader.onload = async () => {
        const tempCtx = new AudioContext({ sampleRate: 16000 });
        try {
            const audioBuf = await tempCtx.decodeAudioData(reader.result);
            const audio = audioBuf.getChannelData(0);
            statusEl.textContent = 'Transcribing...';
            worker.postMessage({
                type: 'transcribe',
                audio: audio,
                language: languageSelect.value,
                final: true,
                model: selectedModel
            });
        } catch (err) {
            statusEl.textContent = 'Error decoding audio: ' + err.message;
        }
        tempCtx.close();
    };
    reader.readAsArrayBuffer(file);
}

// Mic
micButton.addEventListener('click', () => {
    if (!modelReady) {
        statusEl.textContent = 'Please download the model first ↑';
        return;
    }
    if (isRecording) stopRecording();
    else startRecording();
});

copyButton.addEventListener('click', () => {
    const text = fullTranscript || transcript.textContent;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
        copyButton.textContent = '✅ Copied!';
        setTimeout(() => copyButton.textContent = '📋 Copy', 1500);
    });
});
clearButton.addEventListener('click', () => { fullTranscript = ''; transcript.textContent = ''; });

// Recording
async function startRecording() {
    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, sampleRate: 16000 } });
    } catch (err) {
        statusEl.textContent = 'Microphone access denied';
        return;
    }
    isRecording = true;
    micButton.classList.add('recording');
    audioChunks = [];
    // Keep previous transcript; new sessions append instead of wiping.
    audioContext = new AudioContext({ sampleRate: 16000 });
    if (isRealtime) { statusEl.textContent = 'Listening...'; startRealtime(); }
    else { statusEl.textContent = 'Recording...'; startRecordMode(); }
}

function stopRecording() {
    isRecording = false;
    micButton.classList.remove('recording');
    if (window._processor) { window._processor.disconnect(); window._processor = null; }
    if (window._source) { window._source.disconnect(); window._source = null; }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
    if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
    statusEl.textContent = 'Stopped';
}

function startRealtime() {
    const source = audioContext.createMediaStreamSource(mediaStream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(audioContext.destination);
    let chunkBuffer = [];
    const samplesPerChunk = 16000 * 2;
    processor.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        chunkBuffer.push(new Float32Array(data));
        let total = chunkBuffer.reduce((s, b) => s + b.length, 0);
        if (total >= samplesPerChunk) {
            const merged = new Float32Array(total);
            let offset = 0;
            for (const b of chunkBuffer) { merged.set(b, offset); offset += b.length; }
            chunkBuffer = [];
            const toSend = merged.length > samplesPerChunk ? merged.slice(merged.length - samplesPerChunk) : merged;
            worker.postMessage({ type: 'transcribe', audio: toSend, language: languageSelect.value, model: selectedModel });
        }
    };
    window._processor = processor;
    window._source = source;
}

function startRecordMode() {
    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        audioChunks = [];
        statusEl.textContent = 'Transcribing...';
        const arrayBuf = await blob.arrayBuffer();
        const tempCtx = new AudioContext({ sampleRate: 16000 });
        try {
            const audioBuf = await tempCtx.decodeAudioData(arrayBuf);
            worker.postMessage({ type: 'transcribe', audio: audioBuf.getChannelData(0), language: languageSelect.value, final: true, model: selectedModel });
        } catch (err) {
            statusEl.textContent = 'Error decoding audio: ' + err.message;
        }
        tempCtx.close();
    };
    mediaRecorder.start();
}

// Init
updateModelStatus('pending');
statusEl.textContent = 'Download a model to start';

// Remember last selected model
const savedModel = localStorage.getItem('stt-model');
if (savedModel && ['tiny', 'base', 'small'].includes(savedModel)) {
    modelSelect.value = savedModel;
    selectedModel = savedModel;
}
modelSelect.addEventListener('change', () => {
    localStorage.setItem('stt-model', modelSelect.value);
});

// Welcome modal (first visit)
if (!localStorage.getItem('stt-welcomed')) {
    document.getElementById('welcomeModal').classList.remove('hidden');
}
document.getElementById('welcomeClose').addEventListener('click', () => {
    document.getElementById('welcomeModal').classList.add('hidden');
    localStorage.setItem('stt-welcomed', '1');
});
