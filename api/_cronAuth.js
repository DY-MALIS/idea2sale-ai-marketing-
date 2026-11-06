import { createRemoteJWKSet, jwtVerify } from 'jose';

const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_AUDIENCE = 'https://aime.angkorgate.ai/scheduler';
const GITHUB_REPOSITORY = 'DY-MALIS/idea2sale-ai-marketing-';
const GITHUB_WORKFLOW_REF = `${GITHUB_REPOSITORY}/.github/workflows/telegram-scheduler.yml@refs/heads/main`;
const githubKeys = createRemoteJWKSet(new URL(`${GITHUB_ISSUER}/.well-known/jwks`));

export async function isAuthorizedScheduledRequest(req, keySet = githubKeys) {
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.authorization === `Bearer ${secret}` || req.query?.secret === secret)) {
    return true;
  }

  const token = req.headers['x-github-oidc-token'];
  if (typeof token !== 'string' || token.length > 8192) return false;

  try {
    const { payload } = await jwtVerify(token, keySet, {
      issuer: GITHUB_ISSUER,
      audience: GITHUB_AUDIENCE,
      algorithms: ['RS256'],
      maxTokenAge: '10m',
    });
    return payload.repository === GITHUB_REPOSITORY &&
      payload.ref === 'refs/heads/main' &&
      payload.workflow_ref === GITHUB_WORKFLOW_REF &&
      (payload.event_name === 'schedule' || payload.event_name === 'workflow_dispatch');
  } catch {
    return false;
  }
}
