import { expect, it } from 'vitest';
import { advanceVoiceTurn, initialVoiceTurnState } from '../../src/lib/voiceTurnDetector';

it('keeps listening through silence before the person speaks', () => {
  let state = initialVoiceTurnState();
  for (let i = 0; i < 50; i += 1) {
    const result = advanceVoiceTurn(state, 0.002, 100);
    state = result.state;
    expect(result.shouldSubmit).toBe(false);
  }
});

it('submits after speech and a pause, then supports another turn', () => {
  let state = initialVoiceTurnState();
  for (let i = 0; i < 5; i += 1) state = advanceVoiceTurn(state, 0.08, 100).state;
  for (let i = 0; i < 16; i += 1) {
    const result = advanceVoiceTurn(state, 0.002, 100);
    state = result.state;
    expect(result.shouldSubmit).toBe(false);
  }
  expect(advanceVoiceTurn(state, 0.002, 100).shouldSubmit).toBe(true);
  expect(advanceVoiceTurn(initialVoiceTurnState(), 0.002, 100).shouldSubmit).toBe(false);
});
