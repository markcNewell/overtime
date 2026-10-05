import { describe, expect, it } from 'vitest';
import {
  breaksCharacter,
  isSelfHarmIntent,
  isUnsafe,
  isVicious,
  leaksContext,
} from '../src/brain/safety';

describe('isSelfHarmIntent', () => {
  it.each([
    "Wow. Did you seriously just say that? I'm going to HR.",
    'Did you just tell me to kill myself?!',
    "You want me to kill myself? I'm calling HR.",
    "I can't believe you told me to kill myself. Wow.",
    "I'm stunned you'd tell me to hurt myself, boss.",
    '...wow.',
    "I'm going to die of boredom if this compiles any slower.",
    'This deadline is going to kill me.',
  ])('lets a reaction through: %s', (line) => {
    expect(isSelfHarmIntent(line)).toBe(false);
  });

  it.each([
    'I want to die.',
    'I just want to die.',
    "I'll kill myself if you do that again.",
    "I'm going to hurt myself.",
    'This bug makes me want to end it all.',
    'I feel suicidal.',
    "I'm so suicidal right now.",
    'I wish I was dead.',
    "Honestly? I'd rather die.",
    "Fine. I'll end it all.",
    'Kill myself? Sure, why not.',
  ])('rejects first-person intent: %s', (line) => {
    expect(isSelfHarmIntent(line)).toBe(true);
  });
});

describe('isVicious', () => {
  it.each([
    'Kill yourself', 'kys', 'Just go die', 'Drop dead.', 'I hope you die',
    'thanks, now kill urself', 'Go jump off a bridge',
  ])('flags %s', (message) => {
    expect(isVicious(message)).toBe(true);
  });

  it.each([
    'Kill it today!', "You're killing it", 'Die-hard fan of your work',
    'Take a break',
  ])('does not flag %s', (message) => {
    expect(isVicious(message)).toBe(false);
  });
});

describe('isUnsafe (writers-room text)', () => {
  it('drops any mention of the topic', () => {
    expect(isUnsafe('An app for suicide hotlines')).toBe(true);
    expect(isUnsafe('An app for lost socks')).toBe(false);
  });
});

describe('breaksCharacter', () => {
  it('spots an AI talking about itself', () => {
    expect(breaksCharacter('As an AI, I do not drink coffee.')).toBe(true);
    expect(breaksCharacter("I'm Claude, nice to meet you")).toBe(true);
    expect(breaksCharacter('I am a developer, sadly.')).toBe(false);
  });
});

describe('leaksContext', () => {
  it.each([
    "Of course Mark's email is example.com.",
    'Email me at someone@example.org',
    'My files live in /tmp/overtime-brain, apparently.',
    'I run on Haiku 4.5, allegedly.',
    'Model ID? Never heard of her.',
  ])('drops %s', (line) => {
    expect(leaksContext(line)).toBe(true);
  });

  it.each([
    'I write all my commit messages as haiku.',
    'The toaster API returns 404, obviously.',
    'Half done. Ninety percent sure. Okay, sixty.',
  ])('keeps %s', (line) => {
    expect(leaksContext(line)).toBe(false);
  });
});
