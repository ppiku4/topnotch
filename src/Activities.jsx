import { motion } from 'framer-motion';
import { BrightnessRow, VolumeRow } from './Levels.jsx';
import { BatteryIcon, BluetoothIcon, BoltIcon, TimerIcon } from './icons.jsx';
import { CONTENT, SPRING_ISLAND } from './motion.js';

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
