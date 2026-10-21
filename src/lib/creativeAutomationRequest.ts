import type { CreativeAutomationRequest } from '../types';

export function buildCreativeAutomationRequest(
  automation: Record<string, unknown>,
  language: 'km' | 'en',
  id: string,
): CreativeAutomationRequest {
  const kind = automation.kind;
  const prompt = String(automation.prompt || '').trim();
  if (automation.ready !== true || (kind !== 'video' && kind !== 'image') || prompt.length < 20) {
    throw new Error('The image or video brief is incomplete. Please describe what to create.');
  }
  if (kind === 'video' && (typeof automation.voiceOverWanted !== 'boolean'
    || (automation.voiceOverWanted && !String(automation.voiceOverText || '').trim()))) {
    throw new Error('The video brief needs a clear narration choice and spoken words before generation can start.');
  }
  const platform = ['TikTok', 'YouTube', 'Facebook', 'X', 'Telegram', 'General'].includes(String(automation.platform))
    ? automation.platform as CreativeAutomationRequest['platform']
    : 'General';
  const fallbackRatio = kind === 'video'
    ? (platform === 'YouTube' || platform === 'General' ? '16:9' : '9:16')
    : '1:1';
  return {
    id,
    kind,
    imageMode: kind === 'image' && automation.imageMode === 'poster' ? 'poster' : 'visual',
    prompt,
    platform,
    aspectRatio: ['1:1', '9:16', '16:9', '4:5', '3:4'].includes(String(automation.aspectRatio))
      ? automation.aspectRatio as CreativeAutomationRequest['aspectRatio']
      : fallbackRatio,
    language,
    voiceOverWanted: kind === 'video' ? automation.voiceOverWanted as boolean : undefined,
    voiceOverText: kind === 'video' ? String(automation.voiceOverText || '').trim() : undefined,
    headline: kind === 'image' ? String(automation.headline || '').trim() : undefined,
    cta: kind === 'image' ? String(automation.cta || '').trim() : undefined,
    posterStyle: kind === 'image' ? String(automation.posterStyle || 'Modern').trim() : undefined,
    duration: kind === 'video' && [4, 6, 8].includes(Number(automation.duration)) ? Number(automation.duration) : kind === 'video' ? 8 : undefined,
    voiceGender: kind === 'video' && ['Male', 'Female'].includes(String(automation.voiceGender))
      ? automation.voiceGender as 'Male' | 'Female' : undefined,
    performanceStyle: kind === 'video' ? String(automation.performanceStyle || '').trim() || undefined : undefined,
    allowScriptShortening: kind === 'video',
  };
}
