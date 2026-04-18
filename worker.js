// Web Worker for Whisper inference

// Import transformers.js as ESM
importScripts('https://cdn.jsdelivr.net/npm/@huggingface/transformers');

const { pipeline } = self.transformers;

// Initialize the pipeline
let asrPipeline;

async function initPipeline() {
    try {
        // Load the Whisper model
        asrPipeline = await pipeline(
            'automatic-speech-recognition', 
            'onnx-community/whisper-tiny',
            { progress_callback: updateProgress }
        );
        self.postMessage({ type: 'ready' });
    } catch (error) {
        console.error('Error loading model:', error);
        self.postMessage({ type: 'error', error: error.message });
    }
}

// Update progress during model loading
function updateProgress(progress) {
    self.postMessage({ 
        type: 'progress', 
        data: Math.round(progress * 100) 
    });
}

// Handle incoming messages from the main thread
self.onmessage = async (event) => {
    const { type, audio, sampleRate, blob } = event.data;

    if (!asrPipeline) {
        await initPipeline();
    }

    if (type === 'realtime') {
        // Process real-time audio chunks
        const result = await asrPipeline(audio, { sampleRate });
        self.postMessage({ type: 'transcript', data: result.text });
    } else if (type === 'record') {
        // Process recorded audio blob
        const audioBuffer = await blob.arrayBuffer();
        const result = await asrPipeline(audioBuffer);
        self.postMessage({ type: 'transcript', data: result.text });
    }
};