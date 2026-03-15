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

  // Web Audio API
  let audioCtx = null;
  let sourceNode = null;
  let bell1Buffer = null;
  let bell2Buffer = null;
  let audioReady = false;
  let meditationBuffer = null; // Pre-generated audio buffer
  let regenerateTimer = null;  // Debounce timer for regeneration
  let startCtxTime = 0;

  // Unlock AudioContext on first user interaction (critical for iOS)
  function unlockAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Play a tiny silent buffer to unlock audio on iOS
    const silentBuffer = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
    const silentSource = audioCtx.createBufferSource();
    silentSource.buffer = silentBuffer;
    silentSource.connect(audioCtx.destination);
    silentSource.start(0);

    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    // Load bell samples, then generate initial buffer
    loadBells().then(() => {
      if (audioReady) regenerateBuffer();
    });
  }

  // Pre-load bell MP3 files
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

  // Attach unlock to multiple event types for maximum iOS compatibility
  ['touchstart', 'touchend', 'click'].forEach(evt => {
    document.addEventListener(evt, unlockAudio, { once: false, passive: true });
  });

  // Build a single AudioBuffer: bell1 → silence → bell2 at intervals → silence → bell1
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

  // Regenerate the meditation buffer from current slider values (debounced)
  function scheduleRegenerate() {
    if (!audioReady) return;
    clearTimeout(regenerateTimer);
    regenerateTimer = setTimeout(regenerateBuffer, 150);
  }

  function regenerateBuffer() {
    if (!audioReady) return;
    const duration = parseInt(durationSlider.value);
    const intervalMin = parseInt(intervalSlider.value);
    meditationBuffer = buildMeditationBuffer(duration * 60, intervalMin);
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
    if (!audioCtx) return 0;
    return Math.floor(audioCtx.currentTime - startCtxTime);
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
      regenerateBuffer();
    }

    if (!audioReady) {
      alert('Could not load bell sounds. Please check your connection.');
      return;
    }

    // If buffer wasn't generated yet (e.g. no slider interaction), generate now
    if (!meditationBuffer) {
      regenerateBuffer();
    }

    // Stop any previous source
    if (sourceNode) {
      sourceNode.onended = null;
      sourceNode.stop();
      sourceNode = null;
    }

    // Play the pre-generated buffer immediately
    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = meditationBuffer;
    sourceNode.connect(audioCtx.destination);

    startCtxTime = audioCtx.currentTime;
    sourceNode.start(0);

    sourceNode.onended = () => {
      if (sourceNode) {
        finishMeditation(false);
      }
    };

    updateTimerUI();
    showScreen(screenTimer);

    uiInterval = setInterval(updateTimerUI, 250);
  }

  function finishMeditation(early) {
    clearInterval(uiInterval);
    uiInterval = null;

    if (early && sourceNode) {
      sourceNode.onended = null;
      sourceNode.stop();
      sourceNode = null;
    }

    if (!early) {
      sourceNode = null;
    }

    const elapsed = Math.min(getElapsedSeconds(), totalSeconds);
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

    showScreen(screenComplete);
  }

  // Event listeners — regenerate buffer on slider change
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

  btnPause.addEventListener('click', async () => {
    if (isPaused) {
      await audioCtx.resume();
      isPaused = false;
      uiInterval = setInterval(updateTimerUI, 250);
    } else {
      await audioCtx.suspend();
      isPaused = true;
      clearInterval(uiInterval);
    }
    btnPause.textContent = isPaused ? 'Resume' : 'Pause';
  });

  btnFinish.addEventListener('click', () => {
    if (isPaused && audioCtx) {
      audioCtx.resume().then(() => {
        finishMeditation(true);
      });
    } else {
      finishMeditation(true);
    }
  });

  btnDone.addEventListener('click', () => {
    showScreen(screenSetup);
  });

  // Init
  ringProgress.style.strokeDasharray = CIRCUMFERENCE;
  ringProgress.style.strokeDashoffset = CIRCUMFERENCE;
  loadPrefs();
})();
