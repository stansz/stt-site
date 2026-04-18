// Service Worker for caching model files

const CACHE_NAME = 'whisper-model-cache';
const MODEL_URLS = [
    'https://cdn.jsdelivr.net/npm/@huggingface/transformers',
    'https://huggingface.co/onnx-community/whisper-tiny/resolve/main/model.onnx',
    'https://huggingface.co/onnx-community/whisper-tiny/resolve/main/config.json',
    'https://huggingface.co/onnx-community/whisper-tiny/resolve/main/tokenizer.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(MODEL_URLS))
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => response || fetch(event.request))
    );
});