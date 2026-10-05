# Overtime — design

A desktop pet for your working day. One cartoon developer sits in the bottom-right
corner of your screen at a desk next to a coffee station, building pointless apps.
Their brain is your Claude subscription (Haiku, the cheapest model). They have
moods, memories and an opinion of you. You are the boss: chat, shock, praise, shout,
send them for coffee, give a bonus, or fire them. Work them too hard and they break.
Then you hire someone new, and they find the last one's mug on the desk.

Dark office comedy, cartoon tone. Breakdowns are slapstick (running off screaming, a
smoking skeleton, a flipped desk), never self-harm talk. Haiku drops character on that
topic, and it's on a screen at work.

## Decisions (agreed 05-10-2026)

| Topic | Decision |
|---|---|
| Platforms | Windows and macOS, one Electron app. Separate worker per machine. |
| Brain | The user's own `claude` CLI in print mode, model `haiku`, tools off, thinking off. |
| Time | Real time. A project takes 1–3 hours. Time freezes when the app is closed ("they go home"). |
| Boss actions | Shock (click the worker), chat, coffee, praise, shout, bonus (once a day), mess up their code (click the monitor), fire. |
| Coffee timer 05-10 | Coffee is a timer that reminds the boss to get up too: every 20–30 min they go and make one (scared workers ask, Yes/No, then go anyway after three tries), then drink it at the desk. Replaces the energy-based breaks. |
| Feedback 05-10 | Shock only gets them back to work (no speed-up). Chat replies can act ("go for coffee"). Everything is small and attached to the scene: chat on the desk, compact menus, the office is a pop-up panel. Vicious insults get a real reaction. |
| Learning | Skill levels (junior → mid → senior → lead), attitude to the boss, and facts from chat. |
| Legacy | Departed worker leaves a mug, a sticky note and possibly a half-finished project. Nothing else (no ghost, no hall of fame). |
| Art | Flat cartoon, drawn in SVG/CSS by code. About 380×320 px window. |
| Projects | Each new idea writes a markdown brief with its hard parts. Boss picks one of three by difficulty. Editing a brief's hard parts before assigning it changes where the worker struggles. |

## The worker

### Stats

| Stat | Range | Down when | Up when |
|---|---|---|---|
| Energy | 0–100 | Working (faster on hard projects) | Coffee, going home |
| Mood | 0–100 | Shocks, shouts, cruel chat, overload, being stuck | Praise, bonus, kind chat, coffee |
| Sanity | 0–100 | Mood stays below 30 | Slowly when mood > 60; bonus |
| Skill | XP → level | never | Finishing projects |

Hidden traits (rolled at generation, 0.7–1.3): stamina (energy drain), resilience
(sanity loss), talent (XP gain, time stuck).

Hidden attitude, derived from the ledger of how the boss has treated them:
`neutral`, `loyal`, `scared`, `bitter`, `sucking-up`. It steers how they talk.

### Tuning (per real minute unless stated)

Level capacity: junior 2, mid 3, senior 4, lead 5. `gap = difficulty − capacity`.

- **Progress** per minute = `speed / baseMinutes`, `baseMinutes = 45 + 15 × (difficulty − 1)`
  (45…105). `speed = skill × energyF × sanityF × boost × stuckF`:
  - skill = `gap ≤ 0 ? 1 + 0.1 × min(2, −gap) : 1 / (1 + 0.35 × gap)`
  - energyF = `0.5 + 0.5 × energy/100` (0 when asleep)
  - sanityF = `0.7 + 0.3 × sanity/100`
  - stuckF = 0.25 while stuck on a hard part
- **Energy**: working/stuck −`0.45 × (1 + 0.1 × (difficulty − 1)) / stamina`; idle −0.15;
  making coffee +4, drinking it +8. At 0 they fall asleep (no progress) until shocked or
  sent for coffee.
- **Mood** drifts toward a target at 1 % of the gap per minute. Target 65 working, 70 idle,
  −12 per point of positive gap, −15 if energy < 20. Stuck: −0.3 × severity per minute.
- **Sanity**: if mood < 30, −`(30 − mood)/30 × 0.5 / resilience`; if mood > 60, +0.03.
- **Hard parts**: reached when progress passes `at`. Stuck for
  `10 × severity × (1 + 0.3 × max(0, gap)) / talent` minutes.
- **Coffee timer**: `20 + rng × 10` app-open minutes, counting only while working, stuck or
  idle (paused asleep, on coffee, arriving, leaving, or with the app closed). It doubles
  as a reminder for the boss to get up. When it runs out they just go (`took-break`),
  unless scared: then they ask (`wants-coffee`, attempts 1–3, 3.5 min apart) and go
  anyway 3.5 min after the third ask, about 10.5 min in all. Saying no: mood −3, timer
  restarts. A shock or shout withdraws a pending ask and restarts the timer.
- **Coffee run**: 2 min at the machine (+4 energy a minute), then back at the desk working
  as normal while drinking for 5 min (+8 energy, +0.5 mood a minute). The timer restarts
  when they sit down. A shock (or "get back to work") during the run brings them back
  with no coffee and restarts the timer. Going home clears any run or ask and restarts it.
- **Shock** gives no speed boost: it only wakes a sleeper (+15 energy) or ends a coffee
  break. Shout keeps ×1.3 for 5 min.
- **Sabotage** plants a mystery hard part where they are, after knocking progress back
  0.03 (never below 0 or behind a hard part already met). Severity `1 + min(2, n)` for
  `n` sabotages in the previous 30 min. Mood −4, sanity −4. Stuck on one: sanity
  −0.25 per minute on top.

Simulated with all traits 1, a tick every 5 s, the boss saying yes to coffee and
severity-2 hard parts (`tests/game-tuning.test.ts`), with 2 / 3 hard parts and coffee runs
included: junior on d1 76 / 93 min, mid on d3 115 / 130, senior on d4 131 / 148, lead on
d5 148 / 166 (six runs); all Masterpiece. Energy never drops below 84. Trait extremes
stretch this to 69–187 min. A scared lead on d5 who is always told no falls asleep after
2.6 h. A junior on d5 takes 5.6 h and ships "Buggy"; shocked every 3 min they lose their
mind in 74 min.

### Boss actions

| Action | Effect |
|---|---|
| Shock (click) | Gets them back to work: wakes a sleeper (+15 energy) or drags them back from coffee. No speed-up. Mood −10, sanity −3. |
| Shout | Speed ×1.3 for 5 min, mood −6, sanity −1. |
| Praise | Mood +8, halved for each praise in the last 30 min. |
| Coffee | Starts a coffee run now (refused if already on one, or arriving or leaving). Restarts the timer when they're back. |
| No (to a coffee ask) | Only while a scared worker is asking. Mood −3, counted as a refused coffee, timer restarts. |
| Bonus | Mood +25, sanity +10. Once per local calendar day, otherwise refused. |
| Chat | Claude judges the boss's tone: kind mood +4, cruel mood −6 and sanity −1. A reply can carry an action: `coffee` (they agreed to take a break) or `work` (they agreed to get back to it). Their face reacts for a few seconds. |
| Mess up their code (click the monitor) | Plants a mystery hard part at their current progress and knocks progress back 3 %. Mood −4, sanity −4. Severity 1–3, rising with each sabotage inside 30 min. Stuck on a mystery bug drains an extra 0.25 sanity a minute. They never know it was you, but get paranoid after a few. Planted during a coffee break, they find it when they sit back down. |
| Fire | Starts the `fired` ending. |

### HR complaints (added 05-10)

When a worker *says* they're going to HR (a spoken line matching HR / human resources / formal
complaint / report you), they email the boss a complaint written by Claude from what actually
happened. There's no HR character; the email comes straight from the worker. The only
notification is an envelope on the desk with an unread badge, which is safe for screen sharing.
The boss replies in the office panel's Inbox, and Claude, as the worker, judges the reply:

| Outcome | When | Effect |
|---|---|---|
| Apology | A sincere apology | Mood +10, counts as two kind chats |
| Gaslit | Denial or reframing that works (likelier on tired, low-sanity, junior or scared workers) | Sanity −10, mood −3, memory "Maybe I imagined …?" |
| Unconvinced | They don't buy it | Mood −2 |
| Backfired | Threats or insults | Mood −8, sanity −2, counts as a cruel chat |

Ignoring a complaint for 30 minutes of app-open time (closed time doesn't count) marks it
ignored: mood −6, sanity −4, and they become convinced the whole company is against them, which
colours everything they say until a (late) apology. A late reply is still allowed; late
gaslighting is less convincing. Complaints are filed at most every 10 min, with at most 3
unanswered per worker.

### Endings

| Ending | Trigger | Animation |
|---|---|---|
| Lost their mind | Sanity hits 0 | Hair on end, babbling, runs off screaming |
| Fried | 6 shocks inside 10 min (smoking warning from 4) | Skeleton flash, pile of ash, smoke |
| Rage-quit | Mood ≤ 5 for 20 minutes in a row, unless scared (scared people break instead of quitting) | Flips the desk, storms out |
| Fired | Boss fires them | Walks out carrying a box |

Every ending leaves a mug (with a slogan) and a sticky note for the next hire, plus the
project brief if a project was unfinished. The new hire gets these as `desk` memories and
may bring them up.

### Work quality

Each work minute scores `0.35 × skillMatch + 0.35 × sanity/100 + 0.2 × energy/100 + 0.1 × mood/100`,
`skillMatch = gap ≤ 0 ? 1 : max(0, 1 − 0.3 × gap)`, ×0.85 while boosted (rushed).
The project's quality is the average. Grades: ≥ 0.8 Masterpiece, ≥ 0.65 Solid,
≥ 0.5 Buggy, ≥ 0.35 Barely compiles, else Cursed garbage.

XP on finishing: `difficulty × 10 × (0.5 + quality) × talent`. Level thresholds: mid 40,
senior 120, lead 260. A candidate starts at the threshold of their level.

### Going home

When the app opens after more than 30 minutes away: energy +60 (cap 100), mood moves 30 %
toward 55, sanity +5, any coffee or boost is cleared, and they wake if asleep.

## The brain

One `claude -p` process per request, prompt on stdin, from an empty working folder so no
CLAUDE.md or project settings load:

```
claude -p --model haiku --output-format json --tools "" \
  --system-prompt-file <persona.txt> --no-session-persistence \
  --setting-sources "" --strict-mcp-config --settings <brain-settings.json>
env MAX_THINKING_TOKENS=0
```

`brain-settings.json` is `{"alwaysThinkingEnabled": false}`. Measured: ~500 tokens in,
~40 out, 4–6 s. Replies are JSON in the prompt's shape; Haiku sometimes wraps them in code
fences, so the parser takes the first JSON value it finds. `--json-schema` is avoided: it
costs 3 turns and ~5× the tokens.

Requests run one at a time. Chat jumps the queue. Every request has a canned fallback so
the game keeps going without Claude (brain status shows `offline`).

| Request | When | Returns |
|---|---|---|
| candidates | Hiring screen opens, or "show 3 more" | 3 people |
| pitches | After hire, and after each finished project | 3 projects: one easy (1–2), one medium (3), one hard (4–5) |
| think | Every 8–15 min at random, and on events (hard part, coffee, asleep, level up, arrival) | one line said or thought, maybe a memory |
| chat | Boss sends a message | reply, tone of the boss's message, maybe a memory |
| release notes | Project finished | markdown write-up whose quality matches the grade |
| farewell | An ending starts | last words, sticky note, mug slogan |

Event-driven lines are throttled to one per 90 s. The persona prompt carries name,
personality, level, attitude, condition in words ("exhausted", "on the edge"), the current
project and hard part, the last 12 memories and the last 6 chat lines.

## Files

Written under `Documents/Overtime/` (configurable):

- `pitches/<date>-<slug>.md` — one per pitched idea.
- `projects/<date>-<slug>/brief.md` — copied from the pitch on assignment.
- `projects/<date>-<slug>/release-notes.md` — written when it ships.

The brief's hard parts are a list the app reads back on assignment, so you can edit them:

```
## Where the developer will struggle

- [25%] [2] Title: what goes wrong
```

`[at%]` is how far in it hits and `[1-3]` is severity. A brief that no longer parses falls
back to the hard parts it was generated with.

## Windows

- **Overlay**: frameless, transparent, 380×320, bottom-right of the primary screen's work
  area, always on top by default, click-through except over the scene's interactive parts.
  Skips the taskbar; the macOS dock icon is hidden.
- **Office**: a 380 px pop-up panel attached to the scene: directly above it when the screen is
  tall enough, otherwise beside it. Tabs Hire (one candidate at a time), Projects (tap a pitch
  for details), Staff, Log (chat history only) and Settings. Hides when you click away; when the
  game opens it by itself it never takes keyboard focus.
- **Chat** happens on the desk: a one-line box near the worker's head, replies as speech bubbles.
- **Tray**: show/hide, always on top, hide from screen share, office, files folder, quit.
  Global shortcut Ctrl/Cmd+Shift+O shows or hides the worker.
- **Hide from screen share** uses Electron content protection. Works on Windows 10 2004+;
  on recent macOS some sharing tools still capture it, so the tray also has plain hide.

## Code layout

| Path | Job | Depends on |
|---|---|---|
| `src/shared/` | Types and the IPC contract | — |
| `src/game/` | Pure simulation: tick, actions, hire, assign, retire | shared |
| `src/brain/` | Claude CLI runner, prompts, parsing, fallbacks | shared, game (read-only helpers) |
| `src/files/` | Pitch briefs and release notes on disk | shared |
| `src/main/` | Electron: windows, tray, loop, save, IPC | everything |
| `src/preload/` | Exposes `window.overtime` | shared |
| `src/renderer/overlay/` | The corner scene and its controls | shared (via `window.overtime`) |
| `src/renderer/office/` | The office window | shared (via `window.overtime`) |

The loop ticks every 5 s: `tick` → events → brain/file reactions → save (debounced) →
broadcast state. Save is `userData/save.json`, written atomically.

## Testing

- Vitest unit tests for the simulation (durations, endings, actions, attitude, going home),
  the parser, prompt builders and the brief round-trip.
- A smoke script makes real Haiku calls for each request type.
- Overlay and office are previewed headless through Electron and screenshotted.
