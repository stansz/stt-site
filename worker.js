// Whisper Worker — ESM module worker
// Runs Whisper / Moonshine inference via Transformers.js

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

env.allowLocalModels = false;

const MODELS = {
    tiny:  { id: 'onnx-community/whisper-tiny',        size: '~40MB',   label: 'Tiny (fastest)' },
    base:  { id: 'onnx-community/whisper-base',        size: '~75MB',   label: 'Base (balanced)' },
    small: { id: 'onnx-community/whisper-small',       size: '~250MB',  label: 'Small (accurate)' },
    moon:  { id: 'onnx-community/moonshine-base-ONNX', size: '~100MB',  label: 'Moonshine Base (real-time)' },
};

let transcriber = null;
let isLoading = false;
let currentModel = null;

async function loadModel(modelKey) {
    if (transcriber && currentModel === modelKey) return;
    if (isLoading) return;

    isLoading = true;
    currentModel = modelKey;
    const model = MODELS[modelKey];
    self.postMessage({ type: 'loading', model: modelKey, label: model.label });

    try {
        transcriber = await pipeline(
            'automatic-speech-recognition',
            model.id,
            {
                dtype: 'q8',
                progress_callback: (progress) => {
                    if (progress.status === 'progress' && progress.progress !== undefined) {
                        self.postMessage({ type: 'progress', progress: progress.progress / 100, file: progress.file || '' });
                    } else if (progress.status === 'initiate') {
                        self.postMessage({ type: 'progress', progress: 0, file: progress.file || 'Initializing...' });
                    }
                }
            }
        );
        self.postMessage({ type: 'ready', model: modelKey });
    } catch (err) {
        self.postMessage({ type: 'error', message: err.message });
    } finally {
        isLoading = false;
    }
}

self.onmessage = async (event) => {
    const { type, audio, language, final, model } = event.data;

    if (type === 'load') {
        await loadModel(model || 'tiny');
        return;
    }

    if (type === 'transcribe') {
        if (!transcriber) await loadModel(model || 'tiny');
        if (!audio || audio.length === 0) return;

        try {
            const result = await transcriber(audio, {
                language: language || 'en',
                task: 'transcribe',
                return_timestamps: false,
            });
            self.postMessage({ type: 'transcript', text: result.text || '', final: !!final });
        } catch (err) {
            self.postMessage({ type: 'error', message: err.message });
        }
    }
};
