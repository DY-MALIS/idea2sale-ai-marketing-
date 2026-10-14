import { describe, expect, it } from 'vitest';
import { shouldCompleteVoiceAutomation } from '../../shared/voiceAutomationSession.js';

describe('voice automation session', () => {
  it('continues an accepted video command when the call ends before its brief returns', () => {
    expect(shouldCompleteVoiceAutomation({ commandSession: 3, currentSession: 4, voiceActive: false, mounted: true })).toBe(true);
  });

  it('discards an older command after a new call starts or the agent unmounts', () => {
    expect(shouldCompleteVoiceAutomation({ commandSession: 3, currentSession: 5, voiceActive: true, mounted: true })).toBe(false);
    expect(shouldCompleteVoiceAutomation({ commandSession: 3, currentSession: 4, voiceActive: false, mounted: false })).toBe(false);
  });
});
