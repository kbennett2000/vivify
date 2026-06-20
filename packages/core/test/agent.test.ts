// Acceptance: createAgent() returns an Agent; every method exists and no-ops
// without throwing (docs/cycles/cycle-0-contracts.md).

import { describe, it, expect } from 'vitest';
import { createAgent } from '../src/agent.js';
import type { Agent } from '../src/types.js';

describe('createAgent (Cycle 0 stub)', () => {
  it('resolves to an Agent exposing every public method as a function', async () => {
    const agent: Agent = await createAgent(new ArrayBuffer(0));

    expect(typeof agent.show).toBe('function');
    expect(typeof agent.hide).toBe('function');
    expect(typeof agent.play).toBe('function');
    expect(typeof agent.animations).toBe('function');
    expect(typeof agent.speak).toBe('function');
    expect(typeof agent.moveTo).toBe('function');
    expect(typeof agent.gestureAt).toBe('function');
    expect(typeof agent.stopCurrent).toBe('function');
    expect(typeof agent.stop).toBe('function');
    expect(typeof agent.on).toBe('function');
    expect(typeof agent.dispose).toBe('function');
  });

  it('runs every async method without throwing and resolves it', async () => {
    const agent = await createAgent(new ArrayBuffer(0));

    await expect(agent.show()).resolves.toBeUndefined();
    await expect(agent.hide()).resolves.toBeUndefined();
    await expect(agent.play('Greet')).resolves.toBeUndefined();
    await expect(agent.speak('hello')).resolves.toBeUndefined();
    await expect(agent.moveTo(10, 20)).resolves.toBeUndefined();
    await expect(agent.gestureAt(30, 40)).resolves.toBeUndefined();
  });

  it('animations() returns an array', async () => {
    const agent = await createAgent(new ArrayBuffer(0));
    const names = agent.animations();
    expect(Array.isArray(names)).toBe(true);
  });

  it('on / stopCurrent / stop / dispose return without throwing', async () => {
    const agent = await createAgent(new ArrayBuffer(0));

    expect(() => agent.on('show', () => {})).not.toThrow();
    expect(() => agent.stopCurrent()).not.toThrow();
    expect(() => agent.stop()).not.toThrow();
    expect(() => agent.dispose()).not.toThrow();
  });
});
