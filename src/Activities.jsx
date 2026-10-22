import { motion } from 'framer-motion';
import { BrightnessRow, VolumeRow } from './Levels.jsx';
import { BatteryIcon, BluetoothIcon, BoltIcon, TimerIcon } from './icons.jsx';
import { CONTENT, SPRING_ISLAND } from './motion.js';
import { bridge } from './bridge.js';

// Icons pop in with a little overshoot, like iOS live activities.
const POP = { initial: { scale: 0.4, opacity: 0 }, animate: { scale: 1, opacity: 1, transition: { ...SPRING_ISLAND, delay: 0.08 } } };

// One live activity at a time; Island picks which.
export default function Activity({ activity, levels, hold }) {
  const { kind, data } = activity;
  if (kind === 'osd') {
    return (
      <motion.div className="activity activity-osd" {...CONTENT}>
        {data === 'brightness' ? <BrightnessRow levels={levels} hold={hold} /> : <VolumeRow levels={levels} hold={hold} />}
      </motion.div>
    );
  }
  if (kind === 'bluetooth') {
    const connected = data.type !== 'disconnected';
    return (
      <motion.div className="activity" {...CONTENT}>
        <motion.span {...POP} className={`activity-icon ${connected ? 'is-blue' : 'is-dim'}`}><BluetoothIcon /></motion.span>
        <div className="activity-text">
          <div className="activity-title">{data.name}</div>
          <div className="activity-sub">{data.type === 'battery' ? 'Battery low' : connected ? 'Connected' : 'Disconnected'}</div>
        </div>
        {connected && data.battery >= 0 && (
          <span className={`activity-battery${data.battery <= 20 ? ' is-low' : ''}`}><BatteryIcon level={data.battery} />{data.battery}%</span>
        )}
      </motion.div>
    );
  }
  if (kind === 'battery') {
    const charging = data.charging;
    return (
      <motion.div className="activity" {...CONTENT}>
        <motion.span {...POP} className={`activity-icon ${charging ? 'is-green' : data.reason === 'low' ? 'is-red' : 'is-dim'}`}>{charging ? <BoltIcon /> : <BatteryIcon level={data.level} />}</motion.span>
        <div className="activity-text">
          <div className="activity-title">{charging ? 'Charging' : data.reason === 'low' ? 'Battery low' : 'On battery'}</div>
        </div>
        <span className={`activity-battery${data.level <= 20 && !charging ? ' is-low' : ''}`}>{data.level}%</span>
      </motion.div>
    );
  }
  if (kind === 'convert') return <ConvertActivity job={data} />;
  if (kind === 'timer') {
    return (
      <motion.div className="activity" {...CONTENT}>
        <motion.span {...POP} className="activity-icon is-orange"><TimerIcon /></motion.span>
        <div className="activity-text">
          <div className="activity-title">{data.title}</div>
          {data.sub && <div className="activity-sub">{data.sub}</div>}
        </div>
      </motion.div>
    );
  }
  return null;
}

// File wheel conversion: a progress ring while it runs, then "Show".
function ConvertActivity({ job }) {
  const r = 10;
  const length = 2 * Math.PI * r;
  const done = job.status === 'done';
  const failed = job.status === 'error';
  const sub = failed ? job.error : done ? (job.output || '').split(/[\\/]/).pop() : job.progress > 0 ? `${Math.round(job.progress * 100)}%` : 'Converting…';
  return (
    <motion.div className="activity activity-convert" {...CONTENT}>
      {done || failed ? (
        <motion.span {...POP} className={`activity-icon ${done ? 'is-green' : 'is-red'}`}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            {done ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <><path d="M7 7l10 10" /><path d="M17 7L7 17" /></>}
          </svg>
        </motion.span>
      ) : (
        <svg className="convert-ring" viewBox="0 0 26 26">
          <circle className="track" cx="13" cy="13" r={r} />
          <circle className="fill" cx="13" cy="13" r={r} strokeDasharray={length} strokeDashoffset={length * (1 - Math.max(0.04, job.progress || 0))} />
        </svg>
      )}
      <div className="activity-text">
        <div className="activity-title">{failed ? `Couldn’t convert to ${job.target}` : done ? `Converted to ${job.target}` : `${job.name} → ${job.target}`}</div>
        <div className="activity-sub" title={sub}>{sub}</div>
      </div>
      {done && job.output && <button className="activity-action" onClick={() => bridge.showConverted(job.output)}>Show</button>}
    </motion.div>
  );
}
