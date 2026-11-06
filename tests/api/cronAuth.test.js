import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import { isAuthorizedScheduledRequest } from '../../api/_cronAuth.js';

const originalSecret = process.env.CRON_SECRET;
const audience = 'https://aime.angkorgate.ai/scheduler';
const repository = 'DY-MALIS/idea2sale-ai-marketing-';
const workflowRef = `${repository}/.github/workflows/telegram-scheduler.yml@refs/heads/main`;

let privateKey;
let publicKey;

beforeEach(async () => {
  ({ privateKey, publicKey } = await generateKeyPair('RS256'));
  process.env.CRON_SECRET = 'vercel-cron-secret';
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

const request = (headers = {}, query = {}) => ({ headers, query });

async function githubToken(overrides = {}) {
  const claims = {
    repository,
    ref: 'refs/heads/main',
    workflow_ref: workflowRef,
    event_name: 'schedule',
    ...overrides,
  };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer('https://token.actions.githubusercontent.com')
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

describe('scheduled request authorization', () => {
  it('keeps Vercel CRON_SECRET authentication working', async () => {
    expect(await isAuthorizedScheduledRequest(request({ authorization: 'Bearer vercel-cron-secret' }), publicKey)).toBe(true);
    expect(await isAuthorizedScheduledRequest(request({}, { secret: 'vercel-cron-secret' }), publicKey)).toBe(true);
  });

  it('accepts a signed token from the exact scheduler workflow', async () => {
    const token = await githubToken();
    expect(await isAuthorizedScheduledRequest(request({ 'x-github-oidc-token': token }), publicKey)).toBe(true);
  });

  it('rejects tokens from another repository, branch, workflow, or event', async () => {
    for (const claims of [
      { repository: 'other/repository' },
      { ref: 'refs/heads/other' },
      { workflow_ref: `${repository}/.github/workflows/other.yml@refs/heads/main` },
      { event_name: 'pull_request' },
    ]) {
      const token = await githubToken(claims);
      expect(await isAuthorizedScheduledRequest(request({ 'x-github-oidc-token': token }), publicKey)).toBe(false);
    }
  });

  it('rejects malformed and unsigned requests', async () => {
    expect(await isAuthorizedScheduledRequest(request(), publicKey)).toBe(false);
    expect(await isAuthorizedScheduledRequest(request({ 'x-github-oidc-token': 'not-a-jwt' }), publicKey)).toBe(false);
    expect(await isAuthorizedScheduledRequest(request({ authorization: 'Bearer wrong' }), publicKey)).toBe(false);
  });
});
