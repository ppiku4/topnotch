const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const keybd_event = user32.func('void __stdcall keybd_event(uint8_t bVk, uint8_t bScan, uint32_t dwFlags, uintptr_t dwExtraInfo)');
const clipboardChangeToken = user32.func('uint32_t __stdcall GetClipboardSequenceNumber()');
const GetAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int vKey)');

const KEYEVENTF_EXTENDEDKEY = 0x1;
const KEYEVENTF_KEYUP = 0x2;
const VK_LBUTTON = 0x01;
const MEDIA_KEYS = {
  'next': 0xb0,       // VK_MEDIA_NEXT_TRACK
  'previous': 0xb1,   // VK_MEDIA_PREV_TRACK
  'play-pause': 0xb3  // VK_MEDIA_PLAY_PAUSE
};

// System media keys reach whichever app owns the current SMTC session.
function pressMediaKey(action) {
  const vk = MEDIA_KEYS[action];
  if (vk === undefined) return;
  keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY, 0);
  keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
}

function isLeftButtonDown() {
  return (GetAsyncKeyState(VK_LBUTTON) & 0x8000) !== 0;
}

const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
const GetForegroundWindow = user32.func('void * __stdcall GetForegroundWindow()');
const IsZoomed = user32.func('bool __stdcall IsZoomed(void *hWnd)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(void *hWnd)');
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void *hWnd, _Out_ RECT *rect)');
const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32 *pid)');

// The foreground window when it's maximized and belongs to another process:
// { left, top, right, bottom } in physical pixels, or null.
function maximizedForegroundRect() {
  const hwnd = GetForegroundWindow();
  if (!hwnd || !IsWindowVisible(hwnd) || !IsZoomed(hwnd)) return null;
  const pid = [0];
  GetWindowThreadProcessId(hwnd, pid);
  if (pid[0] === process.pid) return null;
  const rect = {};
  return GetWindowRect(hwnd, rect) ? rect : null;
}

// ── Dark glass ────────────────────────────────────────────────────────────
// Acrylic blur through the (undocumented but long-stable) composition accent,
// plus Windows 11 rounded corners via DWM.
const dwmapi = koffi.load('dwmapi.dll');
const ACCENT_POLICY = koffi.struct('ACCENT_POLICY', { state: 'int', flags: 'int', color: 'uint32', animationId: 'int' });
const WINCOMPATTR_DATA = koffi.struct('WINCOMPATTR_DATA', { attribute: 'int', data: 'void *', size: 'size_t' });
const SetWindowCompositionAttribute = user32.func('bool __stdcall SetWindowCompositionAttribute(intptr_t hwnd, WINCOMPATTR_DATA *data)');
const DwmSetWindowAttribute = dwmapi.func('int32 __stdcall DwmSetWindowAttribute(intptr_t hwnd, uint32 attribute, _In_ int32 *value, uint32 size)');

const WCA_ACCENT_POLICY = 19;
const ACCENT_DISABLED = 0;
const ACCENT_ENABLE_ACRYLICBLURBEHIND = 4;
const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const DWMWCP_ROUND = 2;
const DWMWA_BORDER_COLOR = 34;
const DWMWA_COLOR_NONE = 0xfffffffe;

const hwndOf = (win) => win.getNativeWindowHandle().readBigInt64LE(0);

// tint is 0xAABBGGRR.
function setAcrylic(win, on, tint = 0x8c0e0e10) {
  const buffer = koffi.alloc(ACCENT_POLICY, 1);
  koffi.encode(buffer, ACCENT_POLICY, { state: on ? ACCENT_ENABLE_ACRYLICBLURBEHIND : ACCENT_DISABLED, flags: 2, color: on ? tint : 0, animationId: 0 });
  return SetWindowCompositionAttribute(hwndOf(win), { attribute: WCA_ACCENT_POLICY, data: buffer, size: koffi.sizeof(ACCENT_POLICY) });
}

// No effect on Windows 10, where corners stay square. Windows 11 also draws
// a 1px frame around rounded windows; the island has its own hairline, so
// that frame is turned off to avoid a double border.
function setRoundedCorners(win) {
  const hwnd = hwndOf(win);
  DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, [DWMWA_COLOR_NONE | 0], 4);
  return DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, [DWMWCP_ROUND], 4);
}

function isKeyDown(vk) {
  return (GetAsyncKeyState(vk) & 0x8000) !== 0;
}

// Windows only lets the foreground app hand out focus. The file wheel opens
// while Explorer is foreground, so attach to its input queue for the switch.
const kernel32 = koffi.load('kernel32.dll');
const GetCurrentThreadId = kernel32.func('uint32 __stdcall GetCurrentThreadId()');
const AttachThreadInput = user32.func('bool __stdcall AttachThreadInput(uint32 idAttach, uint32 idAttachTo, bool fAttach)');
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(intptr_t hWnd)');
const BringWindowToTop = user32.func('bool __stdcall BringWindowToTop(intptr_t hWnd)');

function forceForeground(win) {
  const hwnd = hwndOf(win);
  const foreground = GetForegroundWindow();
  const foreignThread = foreground ? GetWindowThreadProcessId(foreground, [0]) : 0;
  const ownThread = GetCurrentThreadId();
  const attach = foreignThread && foreignThread !== ownThread;
  if (attach) AttachThreadInput(ownThread, foreignThread, true);
  try {
    BringWindowToTop(hwnd);
    return SetForegroundWindow(hwnd);
  } finally {
    if (attach) AttachThreadInput(ownThread, foreignThread, false);
  }
}

module.exports = { clipboardChangeToken, pressMediaKey, isLeftButtonDown, isKeyDown, forceForeground, maximizedForegroundRect, setAcrylic, setRoundedCorners };
