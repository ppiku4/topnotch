// Current weather from Open-Meteo (free, no key). Location comes from the
// city in settings (Open-Meteo geocoding) or, if empty, from the public IP
// (ipwho.is), which is approximate.
const REFRESH_MS = 20 * 60 * 1000;

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`${new URL(url).host} ${response.status}`);
  return response.json();
}

async function locate(city) {
  if (city) {
    const data = await getJson('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({ name: city, count: '1' }));
    const place = data.results?.[0];
    if (!place) throw new Error(`city not found: ${city}`);
    return { latitude: place.latitude, longitude: place.longitude, name: place.name };
  }
  const data = await getJson('https://ipwho.is/');
  if (!data.success) throw new Error('IP location unavailable');
  return { latitude: data.latitude, longitude: data.longitude, name: data.city };
}

// WMO weather codes to a small set of icons the renderer draws.
function condition(code) {
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  return 'rain';
}

function createWeather({ getConfig, onChange, log }) {
  let timer = null;
  let place = null;
  let placeKey = null;

  async function refresh() {
    const { weatherCity, temperatureUnit, features } = getConfig();
    if (!features.weather) return;
    try {
      const key = weatherCity.trim().toLowerCase();
      if (!place || placeKey !== key) { place = await locate(weatherCity.trim()); placeKey = key; }
      const data = await getJson('https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
        latitude: String(place.latitude),
        longitude: String(place.longitude),
        current: 'temperature_2m,weather_code,is_day',
        temperature_unit: temperatureUnit === 'f' ? 'fahrenheit' : 'celsius'
      }));
      onChange({
        temperature: Math.round(data.current.temperature_2m),
        unit: temperatureUnit === 'f' ? '°F' : '°C',
        condition: condition(data.current.weather_code),
        isDay: data.current.is_day === 1,
        place: place.name
      });
    } catch (error) {
      log('weather: ' + error.message);
    }
  }

  return {
    start() {
      if (timer) return;
      refresh();
      timer = setInterval(refresh, REFRESH_MS);
    },
    stop() { clearInterval(timer); timer = null; },
    refresh,
    reset() { place = null; refresh(); }
  };
}

module.exports = { createWeather };
