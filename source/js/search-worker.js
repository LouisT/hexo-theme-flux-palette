'use strict';
let ready;

// Process vocabulary tasks off the main thread and correlate replies by job ID
self.onmessage = async (event) => {
    const { id, type, payload } = event.data;
    try {
        if (type === 'init') {
            importScripts(payload.core);
            ready = FluxSearchCore.vocabularyIndex(payload.words);
            await ready;
            self.postMessage({ id, result: true });
            return;
        }
        const index = await ready,
            result =
                type === 'expand'
                    ? await FluxSearchCore.expand(index, payload)
                    : await FluxSearchCore.indexedSuggestions(index, payload);
        self.postMessage({ id, result });
    } catch {
        self.postMessage({ id, error: 'Vocabulary processing failed' });
    }
};
