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

  // State
  let totalSeconds = 0;
  let elapsedSeconds = 0;
  let intervalMinutes = 0;
  let timerInterval = null;
  let isPaused = false;
  let bellsFired = new Set();

  // Audio — MP3 bells
  const bell1 = new Audio('bell-1.mp3');
  const bell2 = new Audio('bell-2.mp3');
  bell1.volume = 0.8;
  bell2.volume = 0.8;

  function playBell1() {
    bell1.currentTime = 0;
    bell1.play();
  }

  function playBell2() {
    bell2.currentTime = 0;
    bell2.play();
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

  function updateTimerUI() {
    const remaining = totalSeconds - elapsedSeconds;
    timeRemaining.textContent = formatTime(remaining);
    timeElapsed.textContent = `${formatTime(elapsedSeconds)} elapsed`;

    const progress = elapsedSeconds / totalSeconds;
    const offset = CIRCUMFERENCE * (1 - progress);
    ringProgress.style.strokeDasharray = CIRCUMFERENCE;
    ringProgress.style.strokeDashoffset = offset;
  }

  // Timer
  function startTimer() {
    const duration = parseInt(durationSlider.value);
    intervalMinutes = parseInt(intervalSlider.value);
    totalSeconds = duration * 60;
    elapsedSeconds = 0;
    isPaused = false;
    bellsFired = new Set();
    btnPause.textContent = 'Pause';

    savePrefs();
    playBell1();
    updateTimerUI();
    showScreen(screenTimer);

    timerInterval = setInterval(tick, 1000);
  }

  function tick() {
    if (isPaused) return;

    elapsedSeconds++;
    updateTimerUI();

    // Check interval bells
    if (intervalMinutes > 0) {
      const elapsedMin = elapsedSeconds / 60;
      const bellNumber = Math.floor(elapsedMin / intervalMinutes);
      if (bellNumber > 0 && !bellsFired.has(bellNumber) && elapsedSeconds < totalSeconds) {
        bellsFired.add(bellNumber);
        playBell2();
      }
    }

    // Check if done
    if (elapsedSeconds >= totalSeconds) {
      finishMeditation(false);
    }
  }

  function finishMeditation(early) {
    clearInterval(timerInterval);
    timerInterval = null;

    if (!early) {
      playBell1();
    }

    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
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

  btnPause.addEventListener('click', () => {
    isPaused = !isPaused;
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
