// Cycle 3 — state→animation selection + movement/gesture direction (pure).
// See docs/cycles/cycle-3-renderer.md.

import { describe, it, expect } from 'vitest';
import { animationForState, directionTo, moveState, gestureState } from '../src/states.js';

describe('animationForState', () => {
  const states: Record<string, string[]> = {
    Showing: ['Show'],
    IdlingLevel1: ['Idle1', 'Idle2', 'Idle3'],
    Empty: [],
  };

  it('returns undefined for a missing state', () => {
    expect(animationForState(states, 'DoesNotExist')).toBeUndefined();
  });

  it('returns undefined for an empty list', () => {
    expect(animationForState(states, 'Empty')).toBeUndefined();
  });

  it('returns the sole animation for a single-entry state', () => {
    expect(animationForState(states, 'Showing')).toBe('Show');
  });

  it('picks from a multi-entry state by injected rng', () => {
    // floor(rng()*3): 0 → Idle1, ~0.5 → Idle2 (floor(1.5)=1), ~0.99 → Idle3.
    expect(animationForState(states, 'IdlingLevel1', () => 0)).toBe('Idle1');
    expect(animationForState(states, 'IdlingLevel1', () => 0.5)).toBe('Idle2');
    expect(animationForState(states, 'IdlingLevel1', () => 0.99)).toBe('Idle3');
  });
});

describe('directionTo', () => {
  it('picks Right when moving right', () => {
    expect(directionTo(0, 0, 100, 10)).toBe('Right');
  });

  it('picks Left when moving left', () => {
    expect(directionTo(100, 0, 0, 10)).toBe('Left');
  });

  it('picks Down when moving down', () => {
    expect(directionTo(0, 0, 10, 100)).toBe('Down');
  });

  it('picks Up when moving up', () => {
    expect(directionTo(0, 100, 10, 0)).toBe('Up');
  });

  it('breaks |dx|==|dy| ties horizontally (Right when dx>=0)', () => {
    expect(directionTo(0, 0, 50, 50)).toBe('Right');
    expect(directionTo(0, 0, -50, 50)).toBe('Left');
  });
});

describe('moveState / gestureState', () => {
  it('builds the Moving<Dir> / Gesturing<Dir> state names', () => {
    expect(moveState('Left')).toBe('MovingLeft');
    expect(moveState('Up')).toBe('MovingUp');
    expect(gestureState('Right')).toBe('GesturingRight');
    expect(gestureState('Down')).toBe('GesturingDown');
  });
});
