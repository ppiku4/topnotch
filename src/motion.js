// Apple-style springs. visualDuration is when the motion looks finished
// (the tail settles invisibly after it), so these read quick but never
// stop abruptly, and a spring that's interrupted keeps its velocity.
export const SPRING_ISLAND = { type: 'spring', visualDuration: 0.42, bounce: 0.22 };  // shape morphs
export const SPRING_SOFT = { type: 'spring', visualDuration: 0.38, bounce: 0.08 };    // content in/out
export const SPRING_SNAPPY = { type: 'spring', visualDuration: 0.24, bounce: 0.14 };  // small UI bits

const EASE_OUT = [0.32, 0.72, 0, 1];  // iOS-like deceleration
const EASE_IN = [0.5, 0, 0.75, 0];

// Content swaps inside the island: grow out of the center with a light
// blur while the shape morphs, shrink back into it on the way out. Opacity
// leads (and the blur is small) so nothing smears across the resize.
export const CONTENT = {
  initial: { opacity: 0, scale: 0.94, filter: 'blur(4px)' },
  animate: {
    opacity: 1, scale: 1, filter: 'blur(0px)',
    transition: { ...SPRING_SOFT, delay: 0.05, opacity: { duration: 0.22, ease: EASE_OUT, delay: 0.07 } }
  },
  exit: { opacity: 0, scale: 0.96, filter: 'blur(3px)', transition: { duration: 0.13, ease: EASE_IN } }
};

// Tab content slides a little in the direction of travel.
export const tabMotion = (direction) => ({
  initial: { opacity: 0, x: 14 * direction },
  animate: { opacity: 1, x: 0, transition: { ...SPRING_SOFT, opacity: { duration: 0.2, ease: EASE_OUT } } },
  exit: { opacity: 0, x: -10 * direction, transition: { duration: 0.12, ease: EASE_IN } }
});

// Children fade up one after another.
export const STAGGER = {
  animate: { transition: { staggerChildren: 0.035, delayChildren: 0.05 } }
};
export const RISE = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: SPRING_SOFT }
};

// A light press: enough to feel, not so deep the icon looks like it jumps.
export const PRESS = { whileTap: { scale: 0.92 }, transition: SPRING_SNAPPY };
