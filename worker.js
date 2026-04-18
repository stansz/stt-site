// Whisper Worker — ESM module worker
// Runs Whisper inference via Transformers.js

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

// Allow local model caching
env.allowLocalModels = false;

let transcriber = null;
let isLoading = false;

async function loadModel() {
    if (transcriber) return;
    if (isLoading) return;
    isLoading = true;

    self.postMessage({ type: 'loading' });

    try {
        transcriber = await pipeline(
            'automatic-speech-recognition',
            'onnx-community/whisper-tiny',
            {
                dtype: 'q8',
                progress_callback: (progress) => {
                    if (progress.status === 'progress' && progress.progress !== undefined) {
                        self.postMessage({
                            type: 'progress',
                            progress: progress.progress / 100,
                            file: progress.file || ''
                        });
                    } else if (progress.status === 'initiate') {
                        self.postMessage({
                            type: 'progress',
                            progress: 0,
                            file: progress.file || 'Initializing...'
                        });
                    }
                }
            }
        );
        self.postMessage({ type: 'ready' });
    } catch (err) {
        self.postMessage({ type: 'error', message: err.message });
    } finally {
        isLoading = false;
    }
}

self.onmessage = async (event) => {
    const { type, audio, language, final } = event.data;

    if (type === 'transcribe') {
        // Load model if needed
        if (!transcriber) {
            await loadModel();
        }

        if (!audio || audio.length === 0) return;

        try {
            const result = await transcriber(audio, {
                language: language || 'en',
                task: 'transcribe',
                return_timestamps: false,
            });

            self.postMessage({
                type: 'transcript',
                text: result.text || '',
                final: !!final
            });
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }
    }
};
