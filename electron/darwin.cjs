// macOS counterparts of win32.cjs, with the same exports. Mouse and key state
// come from CoreGraphics through koffi; glass is the window's own vibrancy.
const koffi = require('koffi');
const { app } = require('electron');

const coreGraphics = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
const CGEventSourceButtonState = coreGraphics.func('bool CGEventSourceButtonState(int32_t stateID, uint32_t button)');
const CGEventSourceKeyState = coreGraphics.func('bool CGEventSourceKeyState(int32_t stateID, uint16_t key)');
const HID_STATE = 1; // kCGEventSourceStateHIDSystemState: the hardware, not one app's view

// win32.cjs takes Windows virtual-key codes; map the ones TopNotch uses.
const BUTTONS = { 0x01: 0, 0x02: 1, 0x04: 2 }; // left, right, middle
const KEYS = { 0x1b: 53 };                       // Escape

function isLeftButtonDown() {
  return CGEventSourceButtonState(HID_STATE, 0);
}

function isKeyDown(vk) {
  if (vk in BUTTONS) return CGEventSourceButtonState(HID_STATE, BUTTONS[vk]);
  if (vk in KEYS) return CGEventSourceKeyState(HID_STATE, KEYS[vk]);
  return false;
}

// Media keys go through the MediaRemote adapter instead (main.cjs).
function pressMediaKey() {}

// "Hide behind maximised windows" is Windows-only for now.
function maximizedForegroundRect() {
  return null;
}

function setAcrylic(win, on) {
  win.setVibrancy(on ? 'hud' : null, { animationDuration: 0 });
  if (on) win.setBackgroundColor('#00000000');
  return true;
}

// Frameless windows on macOS already have rounded corners.
function setRoundedCorners() {
  return true;
}

function forceForeground(win) {
  app.focus({ steal: true });
  win.focus();
  return true;
}

module.exports = { pressMediaKey, isLeftButtonDown, isKeyDown, forceForeground, maximizedForegroundRect, setAcrylic, setRoundedCorners };
