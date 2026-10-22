// Sample-data stand-in for window.topnotch (the Electron preload bridge),
// used only by capture.cjs. Song, lyrics, files and devices are made up.
(() => {
  const params = new URLSearchParams(location.search);
  const scene = params.get('scene') || 'pill';
  const listeners = {};
  const on = (name) => (cb) => { (listeners[name] ||= []).push(cb); return () => {}; };
  const emit = (name, value) => (listeners[name] || []).forEach((cb) => cb(value));
  const later = (fn, ms = 60) => setTimeout(fn, ms);

  function cover(size = 300) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, size, size);
    bg.addColorStop(0, '#2a0f5c'); bg.addColorStop(0.55, '#c2185b'); bg.addColorStop(1, '#ff8a3d');
    g.fillStyle = bg; g.fillRect(0, 0, size, size);
    const sun = g.createRadialGradient(size * 0.5, size * 0.58, 4, size * 0.5, size * 0.58, size * 0.3);
    sun.addColorStop(0, '#ffe08a'); sun.addColorStop(1, 'rgba(255,170,80,0)');
    g.fillStyle = sun; g.beginPath(); g.arc(size * 0.5, size * 0.58, size * 0.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffd36b'; g.beginPath(); g.arc(size * 0.5, size * 0.6, size * 0.17, Math.PI, 0); g.fill();
    g.fillStyle = 'rgba(20,6,40,0.9)';
    for (let i = 0; i < 9; i++) { const w = size * 0.07, h = size * (0.12 + ((i * 37) % 23) / 100); g.fillRect(i * size / 9 + 2, size * 0.78 - h + size * 0.22, w, h); }
    g.strokeStyle = 'rgba(255,120,200,0.55)'; g.lineWidth = 2;
    for (let y = 0.68; y < 1; y += 0.06) { g.beginPath(); g.moveTo(0, size * y); g.lineTo(size, size * y); g.stroke(); }
    return c.toDataURL('image/png');
  }
  function appIcon(color, letter) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = color; g.beginPath(); g.roundRect(4, 4, 56, 56, 14); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter, 32, 35);
    return c.toDataURL('image/png');
  }
  function photo(w = 1200, h = 800) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#5aa9e6'); sky.addColorStop(0.6, '#f7c59f'); sky.addColorStop(1, '#f49d6e');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff3c4'; g.beginPath(); g.arc(w * 0.7, h * 0.45, 70, 0, Math.PI * 2); g.fill();
    const hills = [['#3d5a80', 0.62], ['#2b3f5c', 0.72], ['#1b2a3d', 0.84]];
    hills.forEach(([col, base], k) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += 20) g.lineTo(x, h * base - Math.sin(x / (140 + k * 40) + k) * 50 - Math.cos(x / 70) * 12);
      g.lineTo(w, h); g.fill();
    });
    return c.toDataURL('image/png');
  }

  const title = 'Neon Skyline';
  const artist = 'Aurora Vale';
  const LYRICS = [
    [0, 'City lights are calling out my name'], [4.2, 'Running through the static and the rain'],
    [8.6, 'Every heartbeat echoes in the dark'], [12.8, 'Chasing every signal, every spark'],
    [17.1, 'Hold on, we are glowing'], [20.4, 'Ooh, the night is ours tonight'],
    [24.6, 'Under neon skylines we come alive'], [29, 'Turn it up and never say goodbye']
  ];
  const lyricStart = 60;
  const lines = LYRICS.map(([t, text]) => ({ time: lyricStart + t, text }));
  const position = scene === 'pill' ? lyricStart + 25.9 : scene === 'music' ? lyricStart + 17.4 : lyricStart + 21.6;
  const playing = !['info', 'dash-paused'].includes(scene);
  const media = () => ({ title, artist, album: 'Midnight Frequencies', art: cover(), playing, position, positionAt: Date.now(), duration: 214 });
  const noMedia = ['info'].includes(scene);

  const config = {
    scale: 1, accent: 'album', edgeGlow: 'subtle', material: 'solid', keepOpen: false, expandOnHover: true,
    clockDate: 'full', clockFormat: '12h', weatherShow: 'icon-temp', weatherColor: 'weather', clockStyle: 'regular',
    temperatureUnit: 'c', launchAtLogin: true, hideBehindMaximized: true, corners: 'rounded', bgModel: 'isnet', aiDevice: 'auto',
    features: { lyrics: true, pillLyrics: true, pillInfo: true, weather: true, glow: true, privacy: true, clipboard: true, shelf: true, timer: true, stats: true, bluetooth: true, charging: true, wheel: true }
  };

  const OPEN_TAB = { dashboard: 'dashboard', music: 'music', mixer: 'mixer', bluetooth: 'bluetooth', clipboard: 'clipboard', timer: 'timer', stats: 'stats', shelf: 'shelf' };

  const fallback = new Proxy({}, {
    get: (_, key) => {
      if (typeof key === 'string' && key.startsWith('on')) return () => () => {};
      return async () => null;
    }
  });

  const api = {
    platform: 'win32',
    getConfig: async () => config,
    onConfig: on('config'),
    setConfig: (patch) => { Object.assign(config, patch); emit('config', { ...config }); },
    setPassthrough: () => {},
    onMediaState: on('media'),
    onLyrics: on('lyrics'),
    onSystemLevels: on('levels'),
    onPrivacy: on('privacy'),
    onBluetooth: on('bluetooth'),
    onStats: on('stats'),
    onMixer: on('mixer'),
    onBluetoothDevices: on('btDevices'),
    onWeather: on('weather'),
    onClipboard: on('clipboard'),
    onShelf: on('shelf'),
    onDragNear: on('dragNear'),
    onOpenPanel: on('openPanel'),
    onConvertJob: on('convert'),
    onWheelMenu: on('wheel'),
    onEditorOpen: on('editor'),
    getDock: async () => ({ edge: 'top', anchor: null, dragging: false }),
    getDisplays: async () => [{ id: 1, label: 'Display 1 (2560×1440)', primary: true }],
    getAppInfo: async () => ({ name: 'TopNotch', version: '0.1.9', electron: '38.0.0' }),
    checkForUpdate: async () => ({ status: 'latest', current: '0.1.9' }),
    getUpdateMode: async () => ({ selfInstall: true }),
    getEditorImage: async () => ({ file: 'C:\\Users\\you\\Pictures\\sunset-hills.png', name: 'sunset-hills.png', ext: 'png', mode: 'edit', targets: ['png', 'jpg', 'webp', 'tiff', 'avif', 'gif', 'bmp', 'ico', 'psd'], image: photo() }),
    getEngines: async () => [
      { id: 'ffmpeg', label: 'ffmpeg', ready: true, source: 'app', about: 'Video and audio conversion', size: '88 MB' },
      { id: 'office', label: 'LibreOffice', ready: true, source: 'system', about: 'Office documents, spreadsheets, slides', size: '350 MB' }
    ],
    getAiModels: async () => ({ models: [
      { id: 'isnet', label: 'ISNet', installed: true, about: 'Fast, good for most photos', size: '170 MB' },
      { id: 'birefnet', label: 'BiRefNet', installed: false, about: 'Best edges for hair and fine detail', size: '890 MB' }
    ] }),
    sensorsStatus: async () => ({ installed: true, running: true, atSignIn: true }),
    getWeather: async () => null
  };
  window.topnotch = new Proxy(api, { get: (t, k) => (k in t ? t[k] : fallback[k]) });

  window.addEventListener('DOMContentLoaded', () => {
    later(() => {
      emit('weather', { temperature: 22, unit: '°C', condition: 'partly', isDay: true, place: 'Lisbon' });
      emit('levels', { levels: { volume: 64, muted: false, brightness: 80, brightnessSupported: true }, changed: null });
      if (!noMedia) emit('media', media());
      emit('lyrics', { key: `${title}|${artist}`, lines, offset: 0 });
      emit('stats', { cpu: 23, gpu: 41, ram: 58, ramUsedGb: 18.4, ramTotalGb: 32, rx: 6.4 * 1048576, tx: 820 * 1024, cpuTemp: 54, gpuTemp: 61, gpuName: 'GPU' });
      emit('mixer', [
        { pid: 1, name: 'Music player', volume: 82, muted: false, icon: appIcon('#1db954', '♪') },
        { pid: 2, name: 'Web browser', volume: 55, muted: false, icon: appIcon('#0a84ff', 'W') },
        { pid: 3, name: 'Voice chat', volume: 70, muted: false, icon: appIcon('#5865f2', 'V') }
      ]);
      emit('btDevices', [
        { name: 'Wireless Earbuds', connected: true, battery: 78 },
        { name: 'Keyboard', connected: true, battery: 15 },
        { name: 'Mouse', connected: true, battery: 64 },
        { name: 'Living Room Speaker', connected: false, battery: -1 },
        { name: 'Game Controller', connected: false, battery: -1 }
      ]);
      emit('clipboard', [
        { id: 'a', type: 'text', text: 'npm install && npm run dev', pinned: true },
        { id: 'b', type: 'text', text: 'Meeting moved to Thursday 3:00 PM — same link as last week.' },
        { id: 'c', type: 'image', text: 'Image · 1920×1080', thumb: photo(160, 100) },
        { id: 'd', type: 'text', text: 'https://github.com/ppiku4/topnotch/releases/latest' },
        { id: 'e', type: 'text', text: '#bf5af2' }
      ]);
      emit('shelf', [
        { path: 'C:\\a\\Q3-report.pdf', name: 'Q3-report.pdf' },
        { path: 'C:\\a\\sunset-hills.png', name: 'sunset-hills.png', icon: photo(96, 96) },
        { path: 'C:\\a\\budget.xlsx', name: 'budget.xlsx' },
        { path: 'C:\\a\\demo-reel.mp4', name: 'demo-reel.mp4' },
        { path: 'C:\\a\\notes.md', name: 'notes.md' }
      ]);
      if (OPEN_TAB[scene]) later(() => emit('openPanel', OPEN_TAB[scene]), 600);
      if (scene === 'osd') later(() => emit('levels', { levels: { volume: 72, muted: false, brightness: 80, brightnessSupported: true }, changed: 'volume' }), 300);
      if (scene === 'convert') later(() => emit('convert', { id: 1, status: 'running', name: 'demo-reel.mov', target: 'MP4', progress: 0.62 }), 300);
      if (scene === 'converted') later(() => emit('convert', { id: 1, status: 'done', name: 'sunset-hills.png', target: 'WEBP', output: 'C:\\a\\sunset-hills.webp' }), 300);
      if (scene === 'btconnect') later(() => emit('bluetooth', { type: 'connected', name: 'Wireless Earbuds', battery: 78 }), 300);
      if (scene === 'wheel') later(() => emit('wheel', {
        file: 'C:\\a\\sunset-hills.png', name: 'sunset-hills.png', kind: 'image', ext: 'png', downloadSizes: { ffmpeg: '88 MB', office: '350 MB', bgmodel: '170 MB' },
        actions: [
          { id: 'edit', label: 'Edit', icon: 'edit' }, { id: 'crop', label: 'Crop', icon: 'crop' }, { id: 'removebg', label: 'Remove BG', icon: 'removebg', ready: true },
          ...['jpg', 'webp', 'avif', 'tiff', 'gif', 'ico', 'pdf'].map((t) => ({ id: `to:${t}`, label: t.toUpperCase(), target: t, ready: true }))
        ]
      }), 100);
    });
  });
})();
