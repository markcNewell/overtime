/**
 * The pure game simulation. No Electron, no file system, no clock and no
 * randomness: every function takes the time as `now` and returns new data.
 */

export { act } from './actions';
export { deriveAttitude } from './attitude';
export { resolveComplaint } from './complaints';
export { describeCondition } from './describe';
export { projectQuality } from './formulas';
export {
  addMemory,
  assign,
  beginEnding,
  goHome,
  hire,
  newGameState,
  retire,
  setBubble,
  todayKey,
} from './lifecycle';
export { capacity, grade, levelFor, xpFor } from './levels';
export { tick } from './sim';
export { ARRIVE_MS, AWAY_MINUTES } from './tuning';
