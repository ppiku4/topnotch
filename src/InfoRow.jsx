import './info-row.css';
import { useLayoutEffect, useRef } from 'react';
import { useClock } from './hooks.js';
import { WeatherIcon } from './icons.jsx';

const CONDITION_TEXT = {
  clear: 'Clear', partly: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Fog', rain: 'Rain', snow: 'Snow', storm: 'Storm'
};

// "By weather" colours: warm for sun, cool for rain/snow, purple for storms.
const CONDITION_COLOR = {
  clear: '#ffd60a', partly: '#ffcc66', cloudy: '#c7c7cc', fog: '#a1a1aa', rain: '#64d2ff', snow: '#e5f6ff', storm: '#bf5af2'
};

export function weatherColor(weather, mode) {
  if (mode === 'accent') return 'var(--accent)';
  if (mode === 'weather' && weather) return CONDITION_COLOR[weather.condition] || 'var(--text)';
  return 'var(--text)';
}

function formatTime(now, config) {
  const options = { hour: 'numeric', minute: '2-digit' };
  if (config.clockSeconds) options.second = '2-digit';
  if (config.clockFormat === '12h') options.hour12 = true;
  if (config.clockFormat === '24h') { options.hour12 = false; options.hour = '2-digit'; }
  return now.toLocaleTimeString(undefined, options);
}

function formatDate(now, mode) {
  if (mode === 'off') return null;
  if (mode === 'weekday') return now.toLocaleDateString(undefined, { weekday: 'long' });
  return now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

// Day · time · weather, styled by the Appearance settings, reporting its
// natural width so the pill can fit it.
export default function InfoRow({ weather, config, onWidth }) {
  const now = useClock(!!config.clockSeconds);
  const measure = useRef(null);
  const day = formatDate(now, config.clockDate || 'full');
  const time = formatTime(now, config);
  const show = config.weatherShow || 'icon-temp';
  const temp = weather ? `${weather.temperature}${weather.unit}` : null;
  const condition = weather && show === 'detailed' ? CONDITION_TEXT[weather.condition] : null;

  useLayoutEffect(() => { if (measure.current) onWidth?.(measure.current.scrollWidth); }, [day, time, temp, condition, show, config.clockStyle, onWidth]);

  return (
    <span
      className={`info-row clock-${config.clockStyle || 'regular'}`}
      ref={measure}
      style={{ '--clock-color': config.clockColor === 'accent' ? 'var(--accent)' : 'var(--text)', '--weather-color': weatherColor(weather, config.weatherColor) }}
    >
      {day && <span className="info-day">{day}</span>}
      <span className="info-time">{time}</span>
      {weather && (
        <span className="info-weather" title={weather.place}>
          {show !== 'temp' && <WeatherIcon condition={weather.condition} isDay={weather.isDay} />}
          {temp}
          {condition && <span className="info-condition">{condition}</span>}
        </span>
      )}
    </span>
  );
}
