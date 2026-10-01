// The legacy unauthenticated redirect must not issue YouTube OAuth state.
// Connections start at /api/auth/tiktok?provider=youtube with a Firebase token.
export default function handler(req, res) {
  return res.status(401).send('Connect your account from your signed-in profile.');
}
