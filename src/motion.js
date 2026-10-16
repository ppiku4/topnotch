// Apple-style springs: critically-damped-ish with a hint of overshoot,
// expressed as framer-motion duration/bounce springs.
export const SPRING_ISLAND = { type: 'spring', duration: 0.55, bounce: 0.28 };  // shape morphs
export const SPRING_SOFT = { type: 'spring', duration: 0.5, bounce: 0.12 };     // content in/out
export const SPRING_SNAPPY = { type: 'spring', duration: 0.3, bounce: 0.2 };    // small UI bits

// Content swaps inside the island: grow out of the center with a blur,
// shrink back into it on the way out.
export const CONTENT = {
  initial: { opacity: 0, scale: 0.9, filter: 'blur(8px)' },
  animate: { opacity: 1, scale: 1, filter: 'blur(0px)', transition: { ...SPRING_SOFT, delay: 0.06 } },
  exit: { opacity: 0, scale: 0.94, filter: 'blur(6px)', transition: { duration: 0.16, ease: [0.4, 0, 1, 1] } }
};

// Tab content slides a little in the direction of travel.
export const tabMotion = (direction) => ({
  initial: { opacity: 0, x: 18 * direction, filter: 'blur(4px)' },
  animate: { opacity: 1, x: 0, filter: 'blur(0px)', transition: SPRING_SOFT },
  exit: { opacity: 0, x: -18 * direction, filter: 'blur(4px)', transition: { duration: 0.14 } }
});

// Children fade up one after another.
export const STAGGER = {
  animate: { transition: { staggerChildren: 0.035, delayChildren: 0.05 } }
};
export const RISE = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: SPRING_SOFT }
};

export const PRESS = { whileTap: { scale: 0.86 }, transition: SPRING_SNAPPY };
