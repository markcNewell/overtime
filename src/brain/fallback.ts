/**
 * Canned content for when Claude is missing, slow or rate-limited.
 *
 * This is what the user sees when the brain is offline, so it has to be
 * funny on its own. Everything is picked with the injected rng so tests
 * are repeatable.
 */

import type {
  Attitude,
  ChatRequest,
  ChatTone,
  EndingKind,
  GameState,
  HardPart,
  Project,
  Worker,
} from '../shared/types';
import { bandOf, type Band } from './bands';
import {
  COFFEE_COURAGE,
  COFFEE_DENIED,
  COFFEE_TIMER,
  coffeeAskAttempt,
  type AskAttempt,
} from './coffee';
import { feelsPersecuted, firstName } from './persona';
import { guessRequest, usefulAction } from './requests';
import { pick, shuffle, type Rng } from './roll';
import { isVicious } from './safety';
import type {
  CandidateBio,
  ChatReply,
  Farewell,
  PitchDraft,
  WorkerLine,
} from './types';

/** The canned shortlist. Varied levels, at least three juniors. */
export const CANNED_CANDIDATES: readonly CandidateBio[] = [
  {
    name: 'Wanjiru Kamau', age: 24, pronouns: 'she/her', level: 'junior',
    personality: 'Relentlessly upbeat; cries at standups (happy tears)',
    specialty: 'Blockchain for toasters',
    quirk: 'Names every variable after a Bake Off contestant',
    redFlag: 'Listed "vibes" as a programming language',
    backstory: 'Taught herself to code from one library book on COBOL. ' +
      'She has questions about the other languages.',
  },
  {
    name: 'Tomasz Wiśniewski', age: 47, pronouns: 'he/him', level: 'senior',
    personality: 'Gloomy philosopher who sighs in two languages',
    specialty: 'Legacy systems nobody else will touch',
    quirk: 'Keeps a cactus he calls "Production"',
    redFlag: 'References from three companies that no longer exist',
    backstory: 'Spent eleven years maintaining one spreadsheet that ran a ' +
      'regional airport. He does not talk about the spreadsheet.',
  },
  {
    name: 'Inês Carvalho', age: 33, pronouns: 'she/her', level: 'mid',
    personality: 'Chaotic optimist armed with a label maker',
    specialty: 'Dark mode for things that are already dark',
    quirk: 'Talks to her rubber duck in a fake cockney accent',
    redFlag: 'Asked if the coffee machine has root access',
    backstory: 'Former sommelier who moved into tech because "wine has ' +
      'fewer dependencies".',
  },
  {
    name: 'Kenji Arakawa', age: 58, pronouns: 'he/him', level: 'lead',
    personality: 'Zen master of the passive-aggressive code review',
    specialty: 'Rewriting everything in a language he invented',
    quirk: 'Rings a tiny bell every time a test passes',
    redFlag: 'His last three startups were all called "Kenji 2"',
    backstory: 'Shipped software on floppy disks, then CDs, then the cloud. ' +
      'Considers all three a phase.',
  },
  {
    name: 'Sol Abernathy-Mensah', age: 22, pronouns: 'they/them',
    level: 'junior',
    personality: 'Nervous genius who apologises to the compiler',
    specialty: 'Machine learning for houseplants',
    quirk: 'Wears a different hat for every bug',
    redFlag: 'Their only GitHub repo is called "do-not-open"',
    backstory: 'Built a school chatbot at fourteen that unionised the ' +
      'vending machines. Still banned from the IT room.',
  },
  {
    name: 'Fatima Al-Sayed', age: 29, pronouns: 'she/her', level: 'mid',
    personality: 'Deadpan and terrifyingly organised',
    specialty: 'Spreadsheets that achieve sentience',
    quirk: 'Colour-codes her snacks by sprint',
    redFlag: 'Brought a lawyer to the informal coffee chat',
    backstory: 'Ran logistics for a 900-guest wedding with two llamas and ' +
      'a hailstorm. Software feels like a holiday.',
  },
  {
    name: 'Barty Quince', age: 64, pronouns: 'he/him', level: 'senior',
    personality: 'Retired, unretired, deeply confused about both',
    specialty: 'Fax machine integrations',
    quirk: 'Prints out his emails to read them',
    redFlag: 'Calls the cloud "the sky computer" and means it literally',
    backstory: 'Came out of retirement after his garden gnome empire ' +
      'collapsed. Thinks the internet is a fad lasting suspiciously long.',
  },
  {
    name: 'Ana Lucía Ferreyra', age: 38, pronouns: 'she/her', level: 'lead',
    personality: 'Charismatic, with faintly villainous energy',
    specialty: 'Microservices for one-person teams',
    quirk: 'Refers to past projects as "the fallen"',
    redFlag: 'Asked how soundproof the office is',
    backstory: 'Led forty people building an app that tells you whether ' +
      'it is Tuesday. It sold for millions. It is never Tuesday.',
  },
  {
    name: 'Rhys Pemberton', age: 19, pronouns: 'he/him', level: 'junior',
    personality: 'Overconfident, under-slept, powered by energy drinks',
    specialty: 'Speedrunning tutorials',
    quirk: 'Writes every commit message as a haiku',
    redFlag: 'His CV is a 40-second video with a drum solo',
    backstory: 'Dropped out of a coding bootcamp to start a coding ' +
      'bootcamp. Both have since closed.',
  },
];

const SEQUEL_SUFFIXES = [' II', ' Jr.', ' (the other one)', ' III'];

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Canned candidates whose names aren't already taken.
 *
 * @param count - How many.
 * @param avoidNames - Names on the shortlist or among past workers.
 * @param rng - Random source.
 * @returns `count` bios, at least one junior when count >= 1.
 */
export function fallbackBios(
  count: number,
  avoidNames: readonly string[],
  rng: Rng,
): CandidateBio[] {
  const taken = (name: string): boolean =>
    avoidNames.some((n) => sameName(n, name));
  const pool = shuffle(CANNED_CANDIDATES, rng);
  const fresh = pool.filter((c) => !taken(c.name));
  // Once the canned cast is used up, their relatives apply.
  for (const suffix of SEQUEL_SUFFIXES) {
    if (fresh.length >= count) break;
    for (const c of pool) {
      const name = `${c.name}${suffix}`;
      if (!taken(name)) fresh.push({ ...c, name });
    }
  }
  const chosen = fresh.slice(0, count);
  if (count > 0 && !chosen.some((c) => c.level === 'junior')) {
    const junior = fresh.find((c) => c.level === 'junior');
    if (junior) chosen[chosen.length - 1] = junior;
  }
  return chosen;
}

/** Canned pitches, spread over the difficulties. */
export const CANNED_PITCHES: readonly PitchDraft[] = [
  {
    title: 'Is It Lunch Yet?', tagline: 'One button. One truth.',
    difficulty: 1,
    description: 'A single button that tells you whether it is lunchtime. ' +
      'The answer is computed from your mood, not the clock. Investors are ' +
      'calling it brave.',
    hardParts: [
      { at: 0.3, severity: 1, title: 'Defining lunch',
        detail: 'The developer loses an hour to the history of the ' +
          'sandwich and calls it research.' },
      { at: 0.7, severity: 1, title: 'Time zones',
        detail: 'It is always lunch somewhere, and the app will not stop ' +
          'saying so.' },
    ],
  },
  {
    title: 'Sock Ledger', tagline: 'Double-entry bookkeeping for lost socks.',
    difficulty: 2,
    description: 'Every sock you own, tracked to the penny. When one goes ' +
      'missing the app files an insurance claim on its behalf. Pairs are a ' +
      'premium feature.',
    hardParts: [
      { at: 0.25, severity: 1, title: 'Sock identity',
        detail: 'Two identical grey socks are legally the same sock, and ' +
          'the database disagrees.' },
      { at: 0.65, severity: 2, title: 'The tumble dryer',
        detail: 'Socks go into the dryer as a pair and come out as a ' +
          'philosophical question.' },
    ],
  },
  {
    title: 'Applaudr', tagline: 'A slow clap for every save.',
    difficulty: 2,
    description: 'Plays a round of applause whenever you save a file. The ' +
      'applause gets thinner as code quality drops. Silence means go home.',
    hardParts: [
      { at: 0.3, severity: 1, title: 'Clap licensing',
        detail: 'The only royalty-free slow clap was recorded by one man in ' +
          '1987, and he wants royalties.' },
      { at: 0.7, severity: 2, title: 'Measuring quality',
        detail: "The developer's own code gets total silence, which feels " +
          'personal.' },
    ],
  },
  {
    title: 'Meeting Bingo Pro',
    tagline: 'Enterprise bingo for meetings that should be emails.',
    difficulty: 3,
    description: 'Listens to your meetings and marks a bingo card whenever ' +
      'someone says "circle back". A full house ends the call for everyone. ' +
      'HR has concerns.',
    hardParts: [
      { at: 0.2, severity: 1, title: 'Speech recognition',
        detail: 'It hears "synergy" in every sneeze.' },
      { at: 0.5, severity: 2, title: 'Calendar API',
        detail: 'The calendar API returns meetings from a parallel universe ' +
          'where everyone is even busier.' },
      { at: 0.8, severity: 2, title: 'Ending calls',
        detail: 'Hanging up on the CEO turns out to have consequences.' },
    ],
  },
  {
    title: 'Plant Feelings', tagline: "Your fern's inner monologue, live.",
    difficulty: 3,
    description: 'A moisture sensor and a narrator voice that read out your ' +
      "houseplant's emotional state. The ficus is mostly disappointed. The " +
      'cactus needs space.',
    hardParts: [
      { at: 0.3, severity: 2, title: 'Sensor drivers',
        detail: "The sensor's only documentation is a forum post that ends " +
          '"nvm fixed it".' },
      { at: 0.65, severity: 2, title: 'Fern dialogue',
        detail: "The fern's monologue keeps turning into poetry about the " +
          "developer's failures." },
    ],
  },
  {
    title: 'Fridge Tribunal',
    tagline: 'Resolves office fridge disputes, permanently.',
    difficulty: 3,
    description: 'Scans every yoghurt in the office fridge and assigns legal ' +
      'ownership. Appeals go to a panel of the three oldest condiments. ' +
      'Rulings are final.',
    hardParts: [
      { at: 0.25, severity: 1, title: 'Label scanning',
        detail: 'Half the labels are written in marker pen and passive ' +
          'aggression.' },
      { at: 0.55, severity: 2, title: 'Shared milk',
        detail: 'Communal milk breaks the ownership model and several ' +
          'friendships.' },
      { at: 0.85, severity: 1, title: 'The appeal',
        detail: 'Someone appeals a ruling about a hummus from 2019.' },
    ],
  },
  {
    title: 'Toaster OS', tagline: 'A real operating system for your toaster.',
    difficulty: 4,
    description: 'Brings multitasking, user accounts and mandatory updates ' +
      'to toast. Bread is now a subscription. The toaster may refuse service.',
    hardParts: [
      { at: 0.2, severity: 2, title: 'Crumb-tray storage',
        detail: 'The only storage is a crumb tray with 4 KB of memory and a ' +
          'smell.' },
      { at: 0.45, severity: 2, title: 'Threads vs heat',
        detail: 'Running two threads heats the slot until a bagel becomes ' +
          'self-aware.' },
      { at: 0.75, severity: 3, title: 'Mandatory updates',
        detail: 'An update bricks the toaster mid-crumpet and the logs are ' +
          'charcoal.' },
    ],
  },
  {
    title: 'Fridge Magnet Chain',
    tagline: 'Decentralised, immutable, slightly sticky.',
    difficulty: 5,
    description: "Every fridge magnet becomes a node on the world's ledger " +
      'of shopping lists. Moving a magnet needs consensus from half the ' +
      "planet's fridges. Eggs are now collectible.",
    hardParts: [
      { at: 0.15, severity: 2, title: 'Magnet consensus',
        detail: 'Two magnets disagree about milk and fork the chain.' },
      { at: 0.4, severity: 3, title: 'Transaction fees',
        detail: 'Adding "bread" to the list costs more than the bread.' },
      { at: 0.65, severity: 2, title: 'Kitchen Wi-Fi',
        detail: 'The office fridge has one bar of Wi-Fi and a grudge.' },
      { at: 0.85, severity: 3, title: 'Immutable mistakes',
        detail: 'Someone wrote "kale" and now it can never be removed.' },
    ],
  },
  {
    title: 'Dreamscroll', tagline: 'Infinite scroll for your dreams.',
    difficulty: 5,
    description: 'Records your dreams overnight and turns them into a feed ' +
      'to scroll at breakfast. Ads appear inside the dreams themselves. ' +
      'Nobody has asked how.',
    hardParts: [
      { at: 0.2, severity: 2, title: 'Sleep SDK',
        detail: 'The sleep SDK only works while the developer is asleep, ' +
          'which is unhelpful.' },
      { at: 0.5, severity: 3, title: 'Dream rendering',
        detail: 'Every dream renders as this office, with the boss in it.' },
      { at: 0.7, severity: 2, title: 'Ad targeting',
        detail: 'The ads are so accurate that legal stops replying.' },
      { at: 0.9, severity: 3, title: 'Truly infinite scroll',
        detail: 'The scroll becomes literally infinite and eats the test ' +
          'server.' },
    ],
  },
];

/** Spare hard parts, for pitches Claude left short. */
export const GENERIC_HARD_PARTS: readonly HardPart[] = [
  { at: 0.35, severity: 1, title: 'Dependency hell',
    detail: 'One library needs version 2 of another library, which needs ' +
      'version 1 of the first.' },
  { at: 0.55, severity: 2, title: 'Works on my machine',
    detail: 'It works perfectly on the developer\'s machine and nowhere ' +
      'else in the known universe.' },
  { at: 0.75, severity: 2, title: 'The demo',
    detail: 'Everything breaks the moment anyone watches.' },
  { at: 0.88, severity: 3, title: 'Production',
    detail: 'Real users arrive and immediately do the one thing nobody ' +
      'tested.' },
];

function sameTitle(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * A canned pitch in the given band, avoiding used titles where it can.
 *
 * @param band - easy, medium or hard.
 * @param avoidTitles - Titles already shipped or on offer.
 * @param rng - Random source.
 * @returns A pitch draft (a sequel if every title in the band is used).
 */
export function fallbackPitch(
  band: Band,
  avoidTitles: readonly string[],
  rng: Rng,
): PitchDraft {
  const inBand = CANNED_PITCHES.filter((p) => bandOf(p.difficulty) === band);
  const used = (t: string): boolean => avoidTitles.some((a) => sameTitle(a, t));
  const fresh = inBand.filter((p) => !used(p.title));
  if (fresh.length > 0) return clonePitch(pick(fresh, rng));
  const base = clonePitch(pick(inBand, rng));
  for (let n = 2; n < 100; n += 1) {
    const title = `${base.title} ${n}`;
    if (!used(title)) return { ...base, title };
  }
  return base;
}

function clonePitch(p: PitchDraft): PitchDraft {
  return { ...p, hardParts: p.hardParts.map((h) => ({ ...h })) };
}

/** How much of a situation the keyword match looks at. */
const SITUATION_HEAD = 60;

interface LineGroup {
  match: RegExp;
  kind: 'say' | 'think';
  lines: readonly string[];
}

/**
 * Checked in order against the opening words of the situation (so a
 * project called "Coffee Club" doesn't read as a coffee break); the first
 * group that matches wins.
 */
const LINE_GROUPS: readonly LineGroup[] = [
  { match: /first day|walked in|new desk/i, kind: 'say', lines: [
    'First day! Someone has carved "RUN" into this desk. Probably nothing.',
    'Hello! I am going to love it here. Mostly sure. Fairly sure.',
    'Nice desk. Why is the chair still warm?',
  ] },
  { match: COFFEE_TIMER, kind: 'say', lines: [
    'Coffee time. Stand up and stretch with me, boss. Doctor\'s orders.',
    'Making a coffee. Grab some water while I\'m gone? Your spine says hi.',
    'Brew o\'clock! Boss, roll your shoulders. I saw that slouch.',
    'Off to the machine. Come stretch your legs, it\'s good for you.',
    'Coffee run. When did you last stand up, boss? Exactly. Go on.',
  ] },
  { match: COFFEE_COURAGE, kind: 'say', lines: [
    'Nobody said no. That\'s basically a yes. Going. Very quietly.',
    'Courage found. Coffee bound. Please don\'t zap me.',
    'I\'m going. If anyone asks, I was never here.',
  ] },
  { match: COFFEE_DENIED, kind: 'say', lines: [
    'No coffee. Of course. Sorry I asked. Sorry I exist near the mug.',
    'Understood! No coffee. I\'ll just... stare lovingly at the mug.',
    'Right. No. Totally fine. My hands always shake like this.',
  ] },
  { match: /tried to/i, kind: 'think', lines: [
    'Ha. Not today, management.',
    'Computer says no, apparently.',
  ] },
  { match: /nobody has answered|against you/i, kind: 'say', lines: [
    'No reply. Of course. HR, IT, the coffee machine: they are ALL in on it.',
    'Ignored. Classic. I see you, printer. I see all of you.',
    'The whole building is against me. Even the stapler looked away just now.',
    'Fine. Nobody answers. Noted. Everything is being noted. In ink.',
  ] },
  { match: /code just broke|code is broken|broke for no reason/i,
    kind: 'say', lines: [
      'I did not touch it! I did not TOUCH it! Why is it on FIRE?',
      'It worked five minutes ago. Code does not just DO that. Does it?',
      'Who has been in my files? Was it the rubber duck? Blink twice, duck.',
      'Cosmic rays. It has to be cosmic rays. Or the coffee machine.',
      'Someone is messing with me. I can feel it in my semicolons.',
    ] },
  { match: /assigned you/i, kind: 'say', lines: [
    'A new project! What could go wrong? Everything. Everything could.',
    'Love it. Hate it. Will build it. In that order.',
  ] },
  { match: /praised/i, kind: 'say', lines: [
    'Me? Really? I am framing this moment.',
    'Thank you! Quick, someone write that down.',
  ] },
  { match: /shouted/i, kind: 'say', lines: [
    'Working harder! Typing louder! Same thing, right?',
    'Yes boss. Sorry boss. Typing very fast now, boss.',
  ] },
  { match: /bonus/i, kind: 'say', lines: [
    'A BONUS? I am buying a slightly better chair!',
    'Money! I take back most of what I said about you.',
  ] },
  { match: /sent you for/i, kind: 'say', lines: [
    'Coffee? You are a saint. A slightly terrifying saint.',
    'A break! Is this a trap? I am going anyway.',
  ] },
  { match: /promoted/i, kind: 'say', lines: [
    'Promoted! I would like to thank my rubber duck, and nobody else.',
    'A promotion! Same desk, brand new existential dread.',
  ] },
  { match: /asleep|dream|dozing|nodded off/i, kind: 'think', lines: [
    'Zzz... no, make the button MORE blue... zzz',
    'Zzz... five more minutes... ten more years...',
    'Mmm... merge conflict... in my soup...',
  ] },
  { match: /woke|awake/i, kind: 'say', lines: [
    'I was not asleep. I was debugging with my eyes closed. Advanced stuff.',
    'Was I out? I dreamt I was a semicolon. Nobody needed me.',
  ] },
  { match: /got past|cleared|finally/i, kind: 'say', lines: [
    'Fixed it. I have no idea how. Nobody touch anything.',
    'The bug is defeated. It will return. They always return.',
  ] },
  { match: /hard part|stuck/i, kind: 'think', lines: [
    'Why does this work on my machine and nowhere else in the universe?',
    'I have stared at this bug so long it has started staring back.',
    'The docs say "trivial". The docs are lying to me.',
    'Stack Overflow closed this question in 2014. Same, honestly.',
  ] },
  { match: /shipp|finished the project|graded|verdict/i, kind: 'say', lines: [
    'Shipped it! Please nobody ask me what it does.',
    'Done. Released. Never speak to me of it again.',
  ] },
  { match: /ignored|anyway|nobody answered/i, kind: 'say', lines: [
    'I asked nicely. Now I am taking coffee by force.',
    'Going for coffee. Do not try to stop me. Please.',
  ] },
  { match: /coffee break|coffee machine/i, kind: 'think', lines: [
    'This coffee tastes like burnt deadlines. I love it.',
    'If I stand here long enough, maybe the project finishes itself.',
  ] },
  { match: /back at your desk/i, kind: 'say', lines: [
    'Back. The coffee gave me visions. Mostly of semicolons.',
    'Caffeinated and dangerous. Mainly to bugs.',
  ] },
  { match: /coffee|running on empty|flagging/i, kind: 'say', lines: [
    'Coffee. Please. My keyboard is starting to look like a pillow.',
    'Is the coffee machine allowed to be my emergency contact?',
  ] },
  { match: /electrocut|shock|smoking|frizz/i, kind: 'say', lines: [
    'I can taste colours now. Is that one of the benefits?',
    'My hair is doing something the handbook did not mention.',
    'Please stop. My fillings are picking up the radio.',
  ] },
];

const IDLE_LINES = [
  'No project. Just me and this stapler. We are bonding.',
  'Is it lunch? It feels like lunch. Everything feels like lunch.',
];

const WORK_LINES = [
  'Writing code. Some of it even on purpose.',
  'If anyone asks, this is "refactoring".',
  'This function is 400 lines long and I am its mother now.',
];

/** Asking a scary boss for coffee: timid, anxious, then brave-ish. */
export const COFFEE_ASKS: Record<AskAttempt, readonly string[]> = {
  1: [
    'Um, sorry, would it be okay if I maybe made a coffee?',
    'Boss? Tiny question. Could I possibly... have a coffee? Only if okay.',
  ],
  2: [
    'Sorry to ask again. Coffee? A small one. A very small one.',
    'I hate to bother you twice, but... coffee? Please? Hands shaking.',
  ],
  3: [
    'Okay. Deep breath. Boss, I am asking one last time. Coffee. Please.',
    'Third time. I rehearsed this. May I. Have. A coffee?',
  ],
};

/** After three or more refusals, coffee feels like something to earn. */
const UNDESERVING_LINES = [
  'No, you\'re right. Coffee is for people who\'ve earned it. I\'ll smell the mug.',
  'Of course. I don\'t deserve beans. I barely deserve the chair.',
  'Fine. I\'ll drink tap water and think about what I\'ve done.',
];

const PARANOID_LINES = [
  'Who moved my mouse? Nobody? That is exactly what they WANT me to think.',
  'The coffee machine is listening. It reports to HR. Probably.',
  'Everyone is being very normal today. Suspiciously normal.',
];

const GRIM_LINES = [
  'I used to have hobbies. Now I have tickets.',
  'The printer and I have the same expression now.',
  'I am fine. This is my fine face. Look at it.',
];

/**
 * A canned line that fits the situation.
 *
 * @param situation - The situation text passed to `think`.
 * @param state - For mood and activity when no keyword matches.
 * @param rng - Random source.
 * @returns A say or think line.
 */
export function fallbackLine(
  situation: string,
  state: GameState,
  rng: Rng,
): WorkerLine {
  const worker = state.worker;
  const attempt = coffeeAskAttempt(situation);
  if (attempt !== null) return { say: pick(COFFEE_ASKS[attempt], rng) };
  const undeserving = (worker?.ledger.coffeeDenials ?? 0) >= 3;
  if (undeserving && COFFEE_DENIED.test(situation)) {
    return { say: pick(UNDESERVING_LINES, rng) };
  }
  const head = situation.slice(0, SITUATION_HEAD);
  const group = LINE_GROUPS.find((g) => g.match.test(head));
  if (group) return { [group.kind]: pick(group.lines, rng) };
  if (worker && feelsPersecuted(state, worker)) {
    return { think: pick(PARANOID_LINES, rng) };
  }
  if (worker && worker.stats.mood < 30) return { say: pick(GRIM_LINES, rng) };
  if (worker?.activity === 'idle') return { think: pick(IDLE_LINES, rng) };
  return { think: pick(WORK_LINES, rng) };
}

/** Whole words or phrases, any case, every match counted. */
function words(list: readonly string[]): RegExp {
  return new RegExp(`\\b(${list.join('|')})\\b`, 'gi');
}

const KIND_WORDS = words([
  'thanks', 'thank you', 'cheers', 'great', 'well done', 'love', 'good job',
  'nice work', 'brilliant', 'awesome', 'amazing', 'proud', 'appreciate',
  'legend', 'fantastic',
]);
const CRUEL_WORDS = words([
  'useless', 'idiot', 'faster', 'stupid', 'hate', 'fired', 'lazy',
  'pathetic', 'worthless', 'rubbish', 'terrible', 'moron', 'dumb',
  'shut up', 'hurry', 'incompetent', 'disappointing', 'garbage', 'die',
  'drop dead', 'loser', 'kys',
]);

/**
 * Guess how a boss message comes across, without Claude.
 *
 * @param message - What the boss typed.
 * @returns kind, cruel, or neutral when unclear. Telling the worker to
 *   hurt themselves is always cruel, and cruelty wins a tie, as it does in
 *   most offices.
 */
export function guessTone(message: string): ChatTone {
  if (isVicious(message)) return 'cruel';
  const kind = message.match(KIND_WORDS)?.length ?? 0;
  const cruel = message.match(CRUEL_WORDS)?.length ?? 0;
  if (cruel > 0 && cruel >= kind) return 'cruel';
  if (kind > 0) return 'kind';
  return 'neutral';
}

const CHAT_LINES: Record<Exclude<ChatTone, 'cruel'>, readonly string[]> = {
  kind: [
    'Oh! Thank you. Nobody has said that to me since my goldfish.',
    'That is really nice. I am going to tell the stapler.',
    'Stop it, you will make me productive.',
  ],
  neutral: [
    'Noted. Writing that on a sticky note I will immediately lose.',
    'Sure thing, boss. Probably. Eventually.',
    'Mm-hm. Yes. Totally. What?',
  ],
};

/** Hurt, shocked or HR-bound, in the voice of each attitude. */
export const CRUEL_LINES: Record<Attitude, readonly string[]> = {
  neutral: [
    'Wow. Okay. I will just cry into this keyboard, then.',
    'Excuse me? Adding that to my memoirs. Chapter nine: "Why I Left".',
  ],
  loyal: [
    'Ouch. I thought we were a team. That really stung.',
    'That hurt, boss. I am going to need a minute. And a biscuit.',
  ],
  scared: [
    'S-sorry! Sorry. I will do better. Please do not shout again.',
    'Okay. Okay. I am just going to sit here and shake quietly.',
  ],
  bitter: [
    'Cool. Cool cool cool. Forwarding this to my therapist.',
    'Great management technique. Did you learn that from a cartoon villain?',
  ],
  'sucking-up': [
    'Ha! Tough love! I love tough love. Is this tough love? Please say yes.',
    'You are right, boss, as always. I am the worst. Sorry. Great tie.',
  ],
};

/** For a boss who tells them to hurt themselves: stunned, never along. */
export const VICIOUS_LINES: Record<Attitude, readonly string[]> = {
  neutral: [
    '...Wow. Did you seriously just say that? I am going to HR.',
    'Excuse me?! That is going straight to HR. Word for word.',
  ],
  loyal: [
    'I... What? After everything? That is the cruellest thing anyone has ' +
      'ever said to me.',
    '...wow. I really thought you were one of the good ones.',
  ],
  scared: [
    'W-what? That is... that is not okay. I am telling HR. Quietly. Later.',
    'I... I am going to pretend I did not just read that. Hands shaking.',
  ],
  bitter: [
    'Wow. Screenshotting that for HR, my lawyer and my memoirs.',
    'Say that again, slower, so HR can hear it properly.',
  ],
  'sucking-up': [
    'That... was not funny, boss. Even I cannot laugh at that one.',
    'Boss. No. I grovel, but I do not grovel THAT much. HR. Now.',
  ],
};

export const ACTION_LINES: Record<ChatRequest, readonly string[]> = {
  coffee: [
    'You do not have to tell me twice. Back in five!',
    'Coffee? You absolute legend. Going before you change your mind.',
  ],
  work: [
    'Yes boss. Back to it. Pretending I was never gone.',
    'Fine, fine. Back down the code mines.',
  ],
};

/**
 * A canned chat reply. The tone is guessed from keywords, and a request
 * for a break or for work is honoured when it makes sense.
 *
 * @param message - What the boss typed.
 * @param worker - Their attitude and activity, if there is a worker.
 * @param rng - Random source.
 * @returns A reply.
 */
export function fallbackChat(
  message: string,
  worker: Pick<Worker, 'attitude' | 'activity'> | undefined,
  rng: Rng,
): ChatReply {
  const tone = guessTone(message);
  const attitude = worker?.attitude ?? 'neutral';
  if (isVicious(message)) {
    return { say: pick(VICIOUS_LINES[attitude], rng), tone };
  }
  const action = worker
    ? usefulAction(guessRequest(message, tone), worker.activity)
    : undefined;
  if (action) return { say: pick(ACTION_LINES[action], rng), tone, action };
  const lines = tone === 'cruel' ? CRUEL_LINES[attitude] : CHAT_LINES[tone];
  return { say: pick(lines, rng), tone };
}

function firstHardPart(project: Project): string {
  const real = project.hardParts.find((h) => !h.mystery);
  return real?.title ?? 'The main feature';
}

/** One more known issue for bugs that came from nowhere. */
function withMysteryBugs(markdown: string, project: Project): string {
  const n = project.hardParts.filter((h) => h.mystery).length;
  if (n === 0) return markdown;
  const bugs = n === 1 ? 'One bug' : `${n} bugs`;
  const line = `- ${bugs} appeared out of nowhere. Nobody touched anything. ` +
    'I checked. Twice.';
  const heading = '## Known issues\n';
  return markdown.includes(heading)
    ? markdown.replace(heading, `${heading}${line}\n`)
    : `${markdown}\n\n${line}`;
}

type NotesTemplate = (p: Project, me: string) => string;

const NOTES: Record<string, NotesTemplate> = {
  masterpiece: (p, me) => `Behold: **${p.title}**. ${p.tagline} I have \
outdone myself and I would like that on the record.

## What's new
- Everything. All of it works. I checked twice, then once more for vanity.
- ${firstHardPart(p)}: conquered, humbled, framed on my wall.

## Known issues
- None. I looked. I looked *hard*.

— ${me}`,
  solid: (p, me) => `**${p.title}** is out. ${p.tagline} It does what it \
says, which is more than most of us manage.

## What's new
- The main feature, working as designed.
- Fewer crashes than you would expect, given the deadline.

## Known issues
- ${firstHardPart(p)} still makes a noise if you look at it funny.

— ${me}`,
  buggy: (p, me) => `**${p.title}** has shipped, in the sense that it has \
left the building.

## What's new
- Core features, mostly.
- A "surprise me" mode nobody asked for and nobody can turn off.

## Known issues
- ${firstHardPart(p)}: officially a "feature in progress".
- Sometimes it works. Sometimes it works *differently*.

— ${me}`,
  'barely compiles': (p, me) => `**${p.title}** compiles. Mostly. On my \
machine. On Tuesdays.

## What's new
- It starts. That is new.

## Known issues
- ${firstHardPart(p)} was not so much fixed as surrounded.
- Please do not click the button. Any of the buttons.
- I would like it noted that the deadline was not my idea.

— ${me}`,
  'cursed garbage': (p, me) => `**${p.title}** is ALIVE and it is ANGRY.

## What's new
- Crashes on launch (feature: saves battery).
- ${firstHardPart(p)} now happens to the user instead of me.
- It whispers sometimes. We are calling this "voice support".

## Known issues
- Known issues? We have known *entities*.
- Do not run after midnight. Do not run before midnight.

— ${me}`,
};

function gradeFromQuality(quality: number): string {
  if (quality >= 0.8) return 'masterpiece';
  if (quality >= 0.65) return 'solid';
  if (quality >= 0.5) return 'buggy';
  if (quality >= 0.35) return 'barely compiles';
  return 'cursed garbage';
}

/**
 * Canned release notes in the voice of the grade.
 *
 * @param project - The finished project.
 * @param grade - Grade name; unknown names fall back to the quality.
 * @param quality - 0-1.
 * @param workerName - Who signs it.
 * @returns Markdown.
 */
export function fallbackReleaseNotes(
  project: Project,
  grade: string,
  quality: number,
  workerName: string,
): string {
  const template = NOTES[grade.trim().toLowerCase()] ??
    NOTES[gradeFromQuality(quality)];
  const me = workerName.trim() ? firstName({ name: workerName })
    : 'The developer';
  const body = template ? template(project, me)
    : `**${project.title}** shipped.`;
  return withMysteryBugs(body, project);
}

const FAREWELLS: Record<EndingKind, readonly Farewell[]> = {
  'lost-mind': [
    { lastWords: 'THE SEMICOLONS ARE IN THE WALLS! I CAN HEAR THEM COMPILING!',
      stickyNote: 'Do not trust the third drawer. Or the second. Water the ' +
        'cactus. Tell it I said sorry.',
      mugText: 'I Survived Overtime (Mostly)' },
    { lastWords: 'I AM THE BUG NOW! CATCH ME IF YOU CAN!',
      stickyNote: 'The rubber duck knows things. Do not make eye contact ' +
        'with it after 4pm.',
      mugText: 'Sane Until Proven Otherwise' },
  ],
  fried: [
    { lastWords: 'I can see the source code of the universe... it is all ' +
        'spaghetti... fzzt.',
      stickyNote: 'Wear rubber shoes. Trust me. Also the coffee machine ' +
        'owes me two quid.',
      mugText: 'Powered By Unpaid Electricity' },
    { lastWords: 'Tell my keyboard... it was the only one who understood... ' +
        'bzzt.',
      stickyNote: 'If the mouse feels warm, do NOT click it. Learn from my ' +
        'ashes.',
      mugText: 'Shockingly Good Employee' },
  ],
  'rage-quit': [
    { lastWords: 'I QUIT! Enjoy my code. It is ALL global variables!',
      stickyNote: 'The password is "password". It was always "password". ' +
        'Good luck.',
      mugText: "World's Most Former Employee" },
    { lastWords: 'Do your own pointless apps! I am going to be a goat ' +
        'farmer!',
      stickyNote: 'Whatever they promise you, get it in writing. Then ' +
        'laminate it. Then run.',
      mugText: 'I Came, I Saw, I Quit' },
  ],
  fired: [
    { lastWords: 'Fine! I am taking the stapler. The stapler and I have ' +
        'an understanding.',
      stickyNote: 'The boss likes praise, fears silence and cannot spell ' +
        '"bonus". Use this.',
      mugText: 'Fired With Enthusiasm' },
    { lastWords: 'You will regret this when the toaster app goes viral!',
      stickyNote: 'Hid snacks in the ceiling tile above the desk. Consider ' +
        'it my legacy.',
      mugText: 'Let Go, Not Gone' },
  ],
};

/**
 * Canned last words for an ending.
 *
 * @param ending - How they are leaving.
 * @param rng - Random source.
 * @returns Last words, sticky note and mug slogan.
 */
export function fallbackFarewell(ending: EndingKind, rng: Rng): Farewell {
  return { ...pick(FAREWELLS[ending], rng) };
}
