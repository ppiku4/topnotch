import { bridge } from './bridge.js';
import Slider from './Slider.jsx';
import { SunIcon, VolumeIcon } from './icons.jsx';

export function VolumeRow({ levels, hold }) {
  const value = levels.muted ? 0 : (levels.volume ?? 0) / 100;
  return (
    <div className="level-row">
      <button className="level-icon" aria-label={levels.muted ? 'Unmute' : 'Mute'} onClick={() => bridge.toggleMute()}>
        <VolumeIcon level={levels.muted ? 0 : levels.volume ?? 0} />
      </button>
      <Slider label="Volume" value={value} onChange={(v) => bridge.setVolume(v * 100)} onDragChange={hold} />
      <span className="level-value">{levels.muted ? 'Muted' : `${levels.volume ?? '–'}%`}</span>
    </div>
  );
}

export function BrightnessRow({ levels, hold }) {
  if (!levels.brightnessSupported) {
    return <div className="level-row level-unsupported"><span className="level-icon"><SunIcon /></span>Brightness control isn't available for this display</div>;
  }
  return (
    <div className="level-row">
      <span className="level-icon"><SunIcon /></span>
      <Slider label="Brightness" value={(levels.brightness ?? 0) / 100} onChange={(v) => bridge.setBrightness(v * 100)} onDragChange={hold} />
      <span className="level-value">{levels.brightness ?? '–'}%</span>
    </div>
  );
}
