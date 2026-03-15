(() => {
  // Elements
  const screenSetup = document.getElementById('screen-setup');
  const screenTimer = document.getElementById('screen-timer');
  const screenComplete = document.getElementById('screen-complete');

  const durationSlider = document.getElementById('duration');
  const durationValue = document.getElementById('duration-value');
  const intervalSlider = document.getElementById('interval');
  const intervalValue = document.getElementById('interval-value');
  const btnStart = document.getElementById('btn-start');

  const timeRemaining = document.getElementById('time-remaining');
  const timeElapsed = document.getElementById('time-elapsed');
  const ringProgress = document.getElementById('ring-progress');
  const btnPause = document.getElementById('btn-pause');
  const btnFinish = document.getElementById('btn-finish');

  const completeDuration = document.getElementById('complete-duration');
  const btnDone = document.getElementById('btn-done');

  // Constants
  const CIRCUMFERENCE = 2 * Math.PI * 90; // r=90
  const VOLUME = 0.8;

  // State
  let totalSeconds = 0;
  let isPaused = false;
  let uiInterval = null;

  // Audio
  let audioCtx = null;
  let bell1Buffer = null;
  let bell2Buffer = null;
  let audioReady = false;
  let meditationBlobUrl = null; // Pre-generated WAV blob URL
  let regenerateTimer = null;

  // The <audio> element for playback (survives background/lock screen)
  const audioEl = new Audio();
  audioEl.preload = 'auto';
  let meditationActive = false; // Track whether a meditation session is running

  // Unlock audio on first user interaction (critical for iOS)
  function unlockAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // iOS: play silent audio element to unlock it for background playback
    audioEl.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
    audioEl.play().catch(() => {});

    // Also unlock AudioContext (needed for decoding)
    const silentBuffer = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    const silentSource = audioCtx.createBufferSource();
    silentSource.buffer = silentBuffer;
    silentSource.connect(audioCtx.destination);
    silentSource.start(0);

    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    loadBells().then(() => {
      if (audioReady) regenerateWav();
    });
  }

  ['touchstart', 'touchend', 'click'].forEach(evt => {
    document.addEventListener(evt, unlockAudio, { once: false, passive: true });
  });

  // Load bell MP3 files and decode into AudioBuffers
  async function loadBells() {
    if (audioReady) return;
    try {
      const [resp1, resp2] = await Promise.all([
        fetch('bell-1.mp3'),
        fetch('bell-2.mp3'),
      ]);
      const [buf1, buf2] = await Promise.all([
        resp1.arrayBuffer(),
        resp2.arrayBuffer(),
      ]);
      bell1Buffer = await audioCtx.decodeAudioData(buf1);
      bell2Buffer = await audioCtx.decodeAudioData(buf2);
      audioReady = true;
    } catch (e) {
      console.error('Failed to load bell audio:', e);
    }
  }

  // Build a single AudioBuffer with bells mixed in at the right times
  function buildMeditationBuffer(durationSec, intervalMin) {
    const sampleRate = audioCtx.sampleRate;
    const channels = Math.max(bell1Buffer.numberOfChannels, bell2Buffer.numberOfChannels);
    const totalSamples = durationSec * sampleRate;
    const buffer = audioCtx.createBuffer(channels, totalSamples, sampleRate);

    function mixIn(srcBuffer, offsetSamples) {
      for (let ch = 0; ch < channels; ch++) {
        const dst = buffer.getChannelData(ch);
        const srcCh = Math.min(ch, srcBuffer.numberOfChannels - 1);
        const src = srcBuffer.getChannelData(srcCh);
        const len = Math.min(src.length, totalSamples - offsetSamples);
        for (let i = 0; i < len; i++) {
          dst[offsetSamples + i] += src[i] * VOLUME;
        }
      }
    }

    mixIn(bell1Buffer, 0);

    if (intervalMin > 0) {
      const intervalSec = intervalMin * 60;
      for (let t = intervalSec; t < durationSec; t += intervalSec) {
        mixIn(bell2Buffer, t * sampleRate);
      }
    }

    const endBellStart = Math.max(0, totalSamples - bell1Buffer.length);
    mixIn(bell1Buffer, endBellStart);

    return buffer;
  }

  // Convert an AudioBuffer to a WAV Blob
  function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const numSamples = buffer.length;
    const dataSize = numSamples * blockAlign;
    const headerSize = 44;
    const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
    const view = new DataView(arrayBuffer);

    // WAV header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Interleave channels and write PCM samples
    const channels = [];
    for (let ch = 0; ch < numChannels; ch++) {
      channels.push(buffer.getChannelData(ch));
    }

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        let sample = channels[ch][i];
        sample = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  }

  function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // Regenerate WAV blob from current slider values (debounced)
  function scheduleRegenerate() {
    if (!audioReady) return;
    clearTimeout(regenerateTimer);
    regenerateTimer = setTimeout(regenerateWav, 150);
  }

  function regenerateWav() {
    if (!audioReady) return;
    const duration = parseInt(durationSlider.value);
    const intervalMin = parseInt(intervalSlider.value);
    const buffer = buildMeditationBuffer(duration * 60, intervalMin);
    const wavBlob = audioBufferToWav(buffer);

    // Revoke old blob URL to free memory
    if (meditationBlobUrl) {
      URL.revokeObjectURL(meditationBlobUrl);
    }
    meditationBlobUrl = URL.createObjectURL(wavBlob);
  }

  // Formatting
  function formatTime(totalSec) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // localStorage
  function savePrefs() {
    const prefs = {
      duration: parseInt(durationSlider.value),
      interval: parseInt(intervalSlider.value),
    };
    localStorage.setItem('meditationPrefs', JSON.stringify(prefs));
  }

  function loadPrefs() {
    try {
      const prefs = JSON.parse(localStorage.getItem('meditationPrefs'));
      if (prefs) {
        durationSlider.value = Math.max(1, Math.min(120, prefs.duration));
        updateIntervalMax();
        intervalSlider.value = Math.max(0, Math.min(parseInt(intervalSlider.max), prefs.interval));
      }
    } catch {
      // use defaults
    }
    updateDurationDisplay();
    updateIntervalDisplay();
  }

  // UI updates
  function updateDurationDisplay() {
    durationValue.textContent = `${durationSlider.value} min`;
  }

  function updateIntervalMax() {
    const dur = parseInt(durationSlider.value);
    const max = dur - 1;
    intervalSlider.max = max < 0 ? 0 : max;
    if (parseInt(intervalSlider.value) > max) {
      intervalSlider.value = Math.max(0, max);
    }
  }

  function updateIntervalDisplay() {
    const val = parseInt(intervalSlider.value);
    intervalValue.textContent = val === 0 ? 'Off' : `${val} min`;
  }

  function showScreen(screen) {
    screenSetup.classList.remove('active');
    screenTimer.classList.remove('active');
    screenComplete.classList.remove('active');
    screen.classList.add('active');
  }

  function getElapsedSeconds() {
    if (audioEl.paused && !isPaused) return 0;
    return Math.floor(audioEl.currentTime);
  }

  function updateTimerUI() {
    const elapsed = Math.min(getElapsedSeconds(), totalSeconds);
    const remaining = totalSeconds - elapsed;
    timeRemaining.textContent = formatTime(remaining);
    timeElapsed.textContent = `${formatTime(elapsed)} elapsed`;

    const progress = elapsed / totalSeconds;
    const offset = CIRCUMFERENCE * (1 - progress);
    ringProgress.style.strokeDasharray = CIRCUMFERENCE;
    ringProgress.style.strokeDashoffset = offset;

    // Update Media Session position
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
      try {
        navigator.mediaSession.setPositionState({
          duration: totalSeconds,
          position: elapsed,
          playbackRate: 1,
        });
      } catch {}
    }
  }

  // Media Session API — lock screen controls
  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    const duration = parseInt(durationSlider.value);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'Meditation',
      artist: duration + ' min',
      album: 'Meditation Timer',
    });

    navigator.mediaSession.setActionHandler('play', () => {
      if (isPaused) {
        audioEl.play();
        isPaused = false;
        uiInterval = setInterval(updateTimerUI, 250);
        btnPause.textContent = 'Pause';
      }
    });

    navigator.mediaSession.setActionHandler('pause', () => {
      if (!isPaused) {
        audioEl.pause();
        isPaused = true;
        clearInterval(uiInterval);
        btnPause.textContent = 'Resume';
      }
    });

    navigator.mediaSession.setActionHandler('stop', () => {
      finishMeditation(true);
    });

    // Disable seek controls
    navigator.mediaSession.setActionHandler('seekbackward', null);
    navigator.mediaSession.setActionHandler('seekforward', null);
    navigator.mediaSession.setActionHandler('seekto', null);
  }

  // Timer
  async function startTimer() {
    totalSeconds = parseInt(durationSlider.value) * 60;
    isPaused = false;
    btnPause.textContent = 'Pause';

    savePrefs();

    // Ensure audio context is unlocked
    unlockAudio();

    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    // Wait for bells to load if not ready yet
    if (!audioReady) {
      await loadBells();
      regenerateWav();
    }

    if (!audioReady) {
      alert('Could not load bell sounds. Please check your connection.');
      return;
    }

    // If WAV wasn't generated yet, generate now
    if (!meditationBlobUrl) {
      regenerateWav();
    }

    // Set the audio source and play
    audioEl.src = meditationBlobUrl;
    audioEl.currentTime = 0;

    meditationActive = true;

    try {
      await audioEl.play();
    } catch (e) {
      console.error('Playback failed:', e);
      meditationActive = false;
      return;
    }

    setupMediaSession();
    updateTimerUI();
    showScreen(screenTimer);

    uiInterval = setInterval(updateTimerUI, 250);
  }

  // Audio ended naturally — only finish if a meditation is actually running
  audioEl.addEventListener('ended', () => {
    if (meditationActive) {
      finishMeditation(false);
    }
  });

  function finishMeditation(early) {
    clearInterval(uiInterval);
    uiInterval = null;

    // Capture elapsed before pausing (pause makes getElapsedSeconds return 0)
    const elapsed = Math.min(getElapsedSeconds(), totalSeconds);

    meditationActive = false;

    if (early) {
      audioEl.pause();
    }
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    let durationText;
    if (mins === 0) {
      durationText = `${secs} second${secs !== 1 ? 's' : ''}`;
    } else if (secs === 0) {
      durationText = `${mins} minute${mins !== 1 ? 's' : ''}`;
    } else {
      durationText = `${mins} min ${secs} sec`;
    }
    completeDuration.textContent = `You meditated for ${durationText}.`;

    // Clear media session
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('stop', null);
    }

    showScreen(screenComplete);
  }

  // Event listeners — regenerate WAV on slider change
  durationSlider.addEventListener('input', () => {
    updateDurationDisplay();
    updateIntervalMax();
    updateIntervalDisplay();
    scheduleRegenerate();
  });

  intervalSlider.addEventListener('input', () => {
    updateIntervalDisplay();
    scheduleRegenerate();
  });

  btnStart.addEventListener('click', startTimer);

  btnPause.addEventListener('click', () => {
    if (isPaused) {
      audioEl.play();
      isPaused = false;
      uiInterval = setInterval(updateTimerUI, 250);
    } else {
      audioEl.pause();
      isPaused = true;
      clearInterval(uiInterval);
    }
    btnPause.textContent = isPaused ? 'Resume' : 'Pause';
  });

  btnFinish.addEventListener('click', () => {
    finishMeditation(true);
  });

  btnDone.addEventListener('click', () => {
    showScreen(screenSetup);
  });

  // Init
  ringProgress.style.strokeDasharray = CIRCUMFERENCE;
  ringProgress.style.strokeDashoffset = CIRCUMFERENCE;
  loadPrefs();
})();
