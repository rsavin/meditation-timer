const AUDIO_CACHE = 'meditation-audio-v1';

self.addEventListener('message', async (event) => {
  if (event.data.type === 'cache-audio') {
    const { url, blob } = event.data;
    const cache = await caches.open(AUDIO_CACHE);
    const response = new Response(blob, {
      headers: {
        'Content-Type': blob.type,
        'Content-Length': blob.size,
        'Accept-Ranges': 'bytes',
      }
    });
    await cache.put(url, response);
    event.source.postMessage({ type: 'audio-cached', url });
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/generated-audio/')) return;
  event.respondWith(handleAudioRequest(event.request));
});

async function handleAudioRequest(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const cachedResponse = await cache.match(request.url);

  if (!cachedResponse) {
    return new Response('Not found', { status: 404 });
  }

  const blob = await cachedResponse.blob();
  const totalSize = blob.size;
  const rangeHeader = request.headers.get('Range');

  // iOS Safari sends Range requests for <audio> — must respond with 206
  if (rangeHeader) {
    const matches = rangeHeader.match(/bytes=(\d+)-(\d*)/);
    if (matches) {
      const start = parseInt(matches[1], 10);
      const end = matches[2] ? parseInt(matches[2], 10) : totalSize - 1;
      const chunkSize = end - start + 1;
      const slicedBlob = blob.slice(start, end + 1);

      return new Response(slicedBlob, {
        status: 206,
        headers: {
          'Content-Type': blob.type,
          'Content-Length': chunkSize,
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
        }
      });
    }
  }

  return new Response(blob, {
    status: 200,
    headers: {
      'Content-Type': blob.type,
      'Content-Length': totalSize,
      'Accept-Ranges': 'bytes',
    }
  });
}
