/** How the worker feels about the boss, derived from how they've been treated. */

import type { Attitude, Ledger, Stats } from '../shared/types';
import { ATTITUDE as A } from './tuning';

/**
 * Work out the worker's attitude to the boss.
 *
 * Fear comes from shocks and shouts, warmth from praise, bonuses, kind chat
 * and coffee, cruelty from cruel chat and shouts. Fear wins outright when it
 * dominates; otherwise harm plus a low mood turns them bitter; lots of
 * warmth makes them loyal, or sucking-up if it was mostly bought with
 * bonuses.
 *
 * @param ledger - Running counts of the boss's actions.
 * @param stats - Current stats; only mood is used.
 * @returns The attitude.
 */
export function deriveAttitude(ledger: Ledger, stats: Stats): Attitude {
  const fear = ledger.shocks * A.fearPerShock + ledger.shouts * A.fearPerShout;
  const bribes = ledger.bonuses * A.warmthPerBonus;
  const warmth =
    ledger.praises +
    bribes +
    ledger.kindChats +
    ledger.coffees * A.warmthPerCoffee;
  const cruelty = ledger.cruelChats + ledger.shouts;

  const scared =
    fear >= A.scaredMinFear &&
    fear > warmth * A.scaredOverWarmth &&
    fear >= cruelty * A.scaredOverCruelty;
  if (scared) return 'scared';

  if (fear + cruelty > warmth && stats.mood < A.bitterBelowMood) {
    return 'bitter';
  }

  const warm = warmth >= A.warmMin && warmth > (fear + cruelty) * A.warmOverHarm;
  if (!warm) return 'neutral';
  return bribes >= warmth * A.bribedShare ? 'sucking-up' : 'loyal';
}
