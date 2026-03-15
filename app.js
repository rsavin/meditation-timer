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

  // Load an MP3 file and decode it into an AudioBuffer
  async function loadAudioBuffer(url) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    return audioCtx.decodeAudioData(arrayBuffer);
  }

  // Initialize AudioContext and load bell samples
  async function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    [bell1Buffer, bell2Buffer] = await Promise.all([
      loadAudioBuffer('bell-1.mp3'),
      loadAudioBuffer('bell-2.mp3'),
    ]);
  }

  // Build a single AudioBuffer: bell1 → silence → bell2 at intervals → silence → bell1
  function buildMeditationBuffer(durationSec, intervalMin) {
    const sampleRate = audioCtx.sampleRate;
    const channels = Math.max(bell1Buffer.numberOfChannels, bell2Buffer.numberOfChannels);
    const totalSamples = durationSec * sampleRate;
    const buffer = audioCtx.createBuffer(channels, totalSamples, sampleRate);

    // Helper: mix a source buffer into the destination buffer at a given sample offset
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

    // Bell 1 at the very start (0:00)
    mixIn(bell1Buffer, 0);

    // Bell 2 at each interval mark
    if (intervalMin > 0) {
      const intervalSec = intervalMin * 60;
      for (let t = intervalSec; t < durationSec; t += intervalSec) {
        mixIn(bell2Buffer, t * sampleRate);
      }
    }

    // Bell 1 at the very end — place it so it finishes right at (or near) the end
    // Start it bell1Buffer.duration seconds before the end, but not before 0
    const endBellStart = Math.max(0, totalSamples - bell1Buffer.length);
    mixIn(bell1Buffer, endBellStart);

    return buffer;
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
    // audioCtx.currentTime keeps ticking; we track elapsed via the context time
    // We store the context time at start, so elapsed = ctx.currentTime - startCtxTime
    return Math.floor(audioCtx.currentTime - startCtxTime);
  }

  let startCtxTime = 0;

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
    const duration = parseInt(durationSlider.value);
    const intervalMin = parseInt(intervalSlider.value);
    totalSeconds = duration * 60;
    isPaused = false;
    btnPause.textContent = 'Pause';

    savePrefs();

    // Init audio context (needs user gesture — we're inside a click handler)
    await initAudio();

    // If context was suspended from a previous session, resume it
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    // Build the single meditation audio track
    const meditationBuffer = buildMeditationBuffer(totalSeconds, intervalMin);

    // Stop any previous source
    if (sourceNode) {
      sourceNode.onended = null;
      sourceNode.stop();
      sourceNode = null;
    }

    // Create and play the source
    sourceNode = audioCtx.createBufferSource();
    sourceNode.buffer = meditationBuffer;
    sourceNode.connect(audioCtx.destination);

    // Record context time at start so we can derive elapsed
    startCtxTime = audioCtx.currentTime;
    sourceNode.start(0);

    // When the audio naturally ends, finish the meditation
    sourceNode.onended = () => {
      if (sourceNode) {
        finishMeditation(false);
      }
    };

    updateTimerUI();
    showScreen(screenTimer);

    // UI update loop
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

    // For natural completion, sourceNode already stopped via onended
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

  // Event listeners
  durationSlider.addEventListener('input', () => {
    updateDurationDisplay();
    updateIntervalMax();
    updateIntervalDisplay();
  });

  intervalSlider.addEventListener('input', updateIntervalDisplay);

  btnStart.addEventListener('click', startTimer);

  btnPause.addEventListener('click', async () => {
    if (isPaused) {
      // Resume — the audio context picks up exactly where it left off
      await audioCtx.resume();
      isPaused = false;
      uiInterval = setInterval(updateTimerUI, 250);
    } else {
      // Pause — suspending the context freezes audio AND context.currentTime
      await audioCtx.suspend();
      isPaused = true;
      clearInterval(uiInterval);
    }
    btnPause.textContent = isPaused ? 'Resume' : 'Pause';
  });

  btnFinish.addEventListener('click', () => {
    // If paused, resume context first so we can stop cleanly
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
