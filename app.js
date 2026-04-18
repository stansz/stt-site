// Main application logic for the speech-to-text tool

// DOM elements
const modeToggle = document.getElementById('mode-toggle');
const micButton = document.getElementById('mic-button');
const transcriptArea = document.getElementById('transcript');
const copyButton = document.getElementById('copy-button');
const clearButton = document.getElementById('clear-button');
const languageSelect = document.getElementById('language-select');
const progressIndicator = document.getElementById('progress-indicator');

// App state
let isRecording = false;
let isRealtime = true;
let audioContext;
let mediaStream;
let mediaRecorder;
let audioChunks = [];
let worker;

// Initialize the app
function init() {
    // Set up event listeners
    modeToggle.addEventListener('change', toggleMode);
    micButton.addEventListener('click', toggleRecording);
    copyButton.addEventListener('click', copyTranscript);
    clearButton.addEventListener('click', clearTranscript);

    // Initialize Web Worker
    worker = new Worker('worker.js');
    worker.onmessage = handleWorkerMessage;

    // Check for WebGPU support
    if (navigator.gpu) {
        console.log('WebGPU is supported!');
    } else {
        console.log('WebGPU is not supported, falling back to WASM.');
    }
}

// Toggle between real-time and record mode
function toggleMode() {
    isRealtime = modeToggle.checked;
    micButton.textContent = isRealtime ? 'Start Listening' : 'Start Recording';
}

// Toggle recording state
function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

// Start recording
async function startRecording() {
    isRecording = true;
    micButton.textContent = isRealtime ? 'Stop Listening' : 'Stop Recording';
    transcriptArea.textContent = '';

    try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContext = new AudioContext();

        if (isRealtime) {
            // Real-time mode: process audio chunks
            const source = audioContext.createMediaStreamSource(mediaStream);
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            source.connect(processor);
            processor.connect(audioContext.destination);
            processor.onaudioprocess = processAudio;
        } else {
            // Record mode: capture full audio
            mediaRecorder = new MediaRecorder(mediaStream);
            mediaRecorder.ondataavailable = handleDataAvailable;
            mediaRecorder.start();
        }
    } catch (error) {
        console.error('Error accessing microphone:', error);
        isRecording = false;
        micButton.textContent = isRealtime ? 'Start Listening' : 'Start Recording';
    }
}

// Stop recording
function stopRecording() {
    isRecording = false;
    micButton.textContent = isRealtime ? 'Start Listening' : 'Start Recording';

    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }

    if (mediaRecorder) {
        mediaRecorder.stop();
    }

    if (audioContext) {
        audioContext.close();
    }
}

// Process audio chunks in real-time mode
function processAudio(event) {
    const audioData = event.inputBuffer.getChannelData(0);
    worker.postMessage({
        type: 'realtime',
        audio: audioData,
        sampleRate: audioContext.sampleRate
    });
}

// Handle recorded audio data in record mode
function handleDataAvailable(event) {
    audioChunks.push(event.data);
    if (mediaRecorder.state === 'inactive') {
        const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        audioChunks = [];
        worker.postMessage({
            type: 'record',
            blob: audioBlob
        });
    }
}

// Handle messages from the worker
function handleWorkerMessage(event) {
    const { type, data } = event.data;
    if (type === 'transcript') {
        transcriptArea.textContent += data;
    } else if (type === 'progress') {
        progressIndicator.textContent = `Loading model: ${data}%`;
    }
}

// Copy transcript to clipboard
function copyTranscript() {
    navigator.clipboard.writeText(transcriptArea.textContent)
        .then(() => alert('Transcript copied to clipboard!'))
        .catch(err => console.error('Failed to copy:', err));
}

// Clear transcript
function clearTranscript() {
    transcriptArea.textContent = '';
}

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', init);