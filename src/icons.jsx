// Small stroke icons, 24×24 viewBox, currentColor.
const Stroke = ({ children, className = '' }) => (
  <svg viewBox="0 0 24 24" className={`stroke-icon ${className}`} aria-hidden>{children}</svg>
);

export const PlayIcon = () => <svg viewBox="0 0 24 24" className="fill-icon"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" /></svg>;
export const PauseIcon = () => <svg viewBox="0 0 24 24" className="fill-icon"><rect x="5.5" y="4" width="4.5" height="16" rx="1.4" /><rect x="14" y="4" width="4.5" height="16" rx="1.4" /></svg>;
export const PrevIcon = () => <svg viewBox="0 0 24 24" className="fill-icon"><path d="M11 6.5v11a.8.8 0 0 1-1.25.66L2.4 12.66a.8.8 0 0 1 0-1.32l7.35-5.5A.8.8 0 0 1 11 6.5zM21 6.5v11a.8.8 0 0 1-1.25.66l-7.35-5.5a.8.8 0 0 1 0-1.32l7.35-5.5A.8.8 0 0 1 21 6.5z" /></svg>;
export const NextIcon = () => <svg viewBox="0 0 24 24" className="fill-icon"><path d="M3 6.5v11a.8.8 0 0 0 1.25.66l7.35-5.5a.8.8 0 0 0 0-1.32l-7.35-5.5A.8.8 0 0 0 3 6.5zM13 6.5v11a.8.8 0 0 0 1.25.66l7.35-5.5a.8.8 0 0 0 0-1.32l-7.35-5.5A.8.8 0 0 0 13 6.5z" /></svg>;

export function VolumeIcon({ level }) {
  return (
    <Stroke>
      <path className="fill" d="M4 9.5h3l4.5-4v13L7 14.5H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1z" />
      {level === 0 && <path d="M16 9.5l5 5M21 9.5l-5 5" />}
      {level > 0 && <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />}
      {level > 50 && <path d="M18.3 6.6a7.6 7.6 0 0 1 0 10.8" />}
    </Stroke>
  );
}

export const SunIcon = () => (
  <Stroke>
    <circle className="fill" cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
  </Stroke>
);
export const HomeIcon = () => <Stroke><path d="M3.5 11 12 4l8.5 7M6 9.5V20h12V9.5" /></Stroke>;
export const TrayIcon = () => <Stroke><path d="M3.5 13.5 6 5h12l2.5 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" /><path d="M3.5 13.5h5l1 2h5l1-2h5" /></Stroke>;
export const ClipboardIcon = () => <Stroke><rect x="5" y="4.5" width="14" height="16" rx="2" /><path d="M9 4.5V3.5h6v1M8.5 10h7M8.5 14h5" /></Stroke>;
export const TimerIcon = () => <Stroke><circle cx="12" cy="13" r="7.5" /><path d="M12 9v4l2.5 2M10 2.5h4" /></Stroke>;
export const ChartIcon = () => <Stroke><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></Stroke>;
export const GearIcon = () => <Stroke><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Stroke>;
export const PinIcon = ({ filled }) => <Stroke className={filled ? 'is-filled' : ''}><path className={filled ? 'fill' : ''} d="M9 3.5h6l-1 6 3 3v1.5H7V12.5l3-3z" /><path d="M12 15v5.5" /></Stroke>;
export const CloseIcon = () => <Stroke><path d="M6 6l12 12M18 6 6 18" /></Stroke>;
export const PhoneIcon = () => <Stroke><path className="fill" d="M6.6 3.5h2.6l1.5 4-2 1.3a10 10 0 0 0 6.5 6.5l1.3-2 4 1.5v2.6a2 2 0 0 1-2.1 2A16.5 16.5 0 0 1 4.6 5.6a2 2 0 0 1 2-2.1z" /></Stroke>;
export const BluetoothIcon = () => <Stroke><path d="M7 7.5l10 9-5 4.5v-18l5 4.5-10 9" /></Stroke>;
export const BoltIcon = () => <Stroke><path className="fill" d="M13 2.5 5 13.5h6l-1 8 8-11h-6z" /></Stroke>;
export const BatteryIcon = ({ level = 100 }) => (
  <Stroke>
    <rect x="2.5" y="7" width="17" height="10" rx="2.2" />
    <path d="M21.5 10.5v3" />
    <rect className="fill" x="4.5" y="9" width={Math.max(1, 13 * level / 100)} height="6" rx="1" />
  </Stroke>
);
export const ArrowDownIcon = () => <Stroke><path d="M12 4v16M6 14l6 6 6-6" /></Stroke>;
export const ArrowUpIcon = () => <Stroke><path d="M12 20V4M6 10l6-6 6 6" /></Stroke>;
export const ImageIcon = () => <Stroke><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M20.5 16l-5-5-9 8.5" /></Stroke>;
export const GridIcon = () => <Stroke><rect x="4" y="4" width="6.5" height="6.5" rx="1.6" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" /></Stroke>;
export const MusicIcon = () => <Stroke><path d="M9 18V5.5l11-2V16" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></Stroke>;
export const SlidersIcon = () => <Stroke><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></Stroke>;
export const CoffeeIcon = () => <Stroke><path d="M4.5 9h12v5.5a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5zM16.5 10.5h1.5a2.5 2.5 0 0 1 0 5h-1.6M8 3.5v2.5M11.5 3.5v2.5" /></Stroke>;
export const PulseIcon = () => <Stroke><path d="M3 12h4l2.5-6 4 12 2.5-6H21" /></Stroke>;
export const CalculatorIcon = () => <Stroke><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="M8.5 7h7M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15v2.5M8.5 18h.01M12 18h.01" /></Stroke>;
export const ScissorsIcon = () => <Stroke><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="6.5" cy="17.5" r="2.5" /><path d="M8.5 8 20 18M8.5 16 20 6" /></Stroke>;
export const ChevronIcon = () => <Stroke><path d="M9.5 6l6 6-6 6" /></Stroke>;
export function WeatherIcon({ condition = 'cloudy', isDay = true }) {
  const sun = isDay
    ? <><circle cx="9" cy="9" r="3.2" /><path d="M9 2.5v1.2M2.5 9h1.2M4.4 4.4l.85.85M13.6 4.4l-.85.85" /></>
    : <path d="M12 4.5a4.5 4.5 0 1 0 4.5 6 3.6 3.6 0 0 1-4.5-6z" />;
  const cloud = <path d="M7 19h10a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1A3 3 0 0 0 7 19z" />;
  if (condition === 'clear') return <Stroke>{isDay ? <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></> : <path d="M15 4.5a7.5 7.5 0 1 0 4.5 11 6 6 0 0 1-4.5-11z" />}</Stroke>;
  if (condition === 'partly') return <Stroke>{sun}{cloud}</Stroke>;
  if (condition === 'rain') return <Stroke>{cloud}<path d="M9 21.5l-.6 1.2M13 21.5l-.6 1.2M17 21.5l-.6 1.2" transform="translate(0 -1.5)" /></Stroke>;
  if (condition === 'snow') return <Stroke>{cloud}<path d="M9 21.5h.01M12.5 21.5h.01M16 21.5h.01" /></Stroke>;
  if (condition === 'storm') return <Stroke>{cloud}<path d="M12.5 13.5l-2 3.5h3l-2 3.5" /></Stroke>;
  return <Stroke>{cloud}</Stroke>;
}
export function BatteryRing({ level = 100, charging }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 24 24" className="battery-ring" aria-hidden>
      <circle cx="12" cy="12" r={r} className="ring-track" />
      <circle cx="12" cy="12" r={r} className="ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - level / 100)} transform="rotate(-90 12 12)" />
      {charging && <path className="ring-bolt" d="M12.8 7.5 9.8 12.4h2.6l-1.2 4.1 3-4.9h-2.6z" />}
    </svg>
  );
}
export const RefreshIcon = () => <Stroke><path d="M20 11a8 8 0 0 0-14.3-4.6L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.6l1.7-2.1M20 20v-4.5h-4.5" /></Stroke>;
export const PaletteIcon = () => <Stroke><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.1-1.6-1.1-2.7 0-.9.7-1.6 1.6-1.6h2.1a4.1 4.1 0 0 0 4.1-4.1C20.5 6.6 16.7 3.5 12 3.5z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7.5" r="1" /><circle cx="14.5" cy="7.5" r="1" /></Stroke>;
export const BookIcon = () => <Stroke><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15H5.5A1.5 1.5 0 0 0 4 20.5zM20 5.5A1.5 1.5 0 0 0 18.5 4H13v15h5.5a1.5 1.5 0 0 1 1.5 1.5z" /></Stroke>;
export const InfoIcon = () => <Stroke><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.01" /></Stroke>;
export const MonitorIcon = () => <Stroke><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M8.5 20h7M12 16.5V20" /></Stroke>;
export const ExpandIcon = () => <Stroke><path d="M14 4h6v6M10 20H4v-6M20 4l-6.5 6.5M4 20l6.5-6.5" /></Stroke>;
export const PointerIcon = () => <Stroke><path d="M5 3.5l13 6.2-5.6 1.7-1.7 5.6z" /><path d="M12.4 11.4l6 6" /></Stroke>;
export const ShrinkIcon = () => <Stroke><path d="M4 10h6V4M20 14h-6v6M10 10 3.5 3.5M14 14l6.5 6.5" /></Stroke>;
export const LyricsIcon = () => <Stroke><path d="M4 7h10M4 12h7M4 17h9" /><path d="M17 17.5V8l4-1" /><circle cx="15.5" cy="17.5" r="1.8" /></Stroke>;
export const CameraIcon = () => <Stroke><rect x="3" y="6.5" width="13" height="11" rx="2" /><path d="M16 10.5l5-3v9l-5-3z" /></Stroke>;
export const FolderIcon = () => <Stroke><path d="M3.5 7A1.5 1.5 0 0 1 5 5.5h4.2l2 2.2H19A1.5 1.5 0 0 1 20.5 9.2V17A1.5 1.5 0 0 1 19 18.5H5A1.5 1.5 0 0 1 3.5 17z" /></Stroke>;
export const WheelIcon = () => <Stroke><rect x="7" y="3.5" width="10" height="17" rx="5" /><path d="M12 7v3" /></Stroke>;
export const GlowIcon = () => <Stroke><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="8" strokeDasharray="2 3" /></Stroke>;
export const SquareIcon = () => <Stroke><rect x="4.5" y="4.5" width="15" height="15" rx="4" /></Stroke>;
export const LayersIcon = () => <Stroke><path d="M12 3.5 3 8.5l9 5 9-5zM3 13l9 5 9-5" /></Stroke>;
export const ClockIcon = () => <Stroke><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Stroke>;
export const SparkleIcon = () => <Stroke><path d="M12 3l1.6 3.9L17.5 8.5l-3.9 1.6L12 14l-1.6-3.9L6.5 8.5l3.9-1.6z" /><path d="M5 15l.8 1.9 1.9.8-1.9.8L5 20.4l-.8-1.9-1.9-.8 1.9-.8zM18 14l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z" /></Stroke>;
export const ChipIcon = () => <Stroke><rect x="6" y="6" width="12" height="12" rx="2" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" /></Stroke>;
export const MemoryIcon = () => <Stroke><rect x="3" y="7" width="18" height="10" rx="1.6" /><path d="M7 10v4M11 10v4M15 10v4M6 17v2.5M10 17v2.5M14 17v2.5M18 17v2.5" /></Stroke>;
export const SignalIcon = () => <Stroke><path d="M4 18.5a11 11 0 0 1 16 0M7 15.5a7 7 0 0 1 10 0M10 12.6a3 3 0 0 1 4 0" /><circle className="fill" cx="12" cy="18.5" r="1.2" /></Stroke>;
export const ThermometerIcon = () => <Stroke><path d="M10 4.5a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z" /><path d="M12 10v6" /></Stroke>;
