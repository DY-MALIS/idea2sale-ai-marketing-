import { useState } from 'react';
import { linkWithPopup } from 'firebase/auth';
import { auth, googleProvider, signInWithGoogle } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

export default function TelegramConnect() {
  const { user, loading } = useAuth();
  const state = new URLSearchParams(window.location.search).get('state') || '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      if (!/^[a-f0-9]{48}$/.test(state)) throw new Error('This Telegram sign-in link is invalid. Send /login to the bot again.');
      let account = user;
      if (!account) {
        account = await signInWithGoogle();
        if (!account) throw new Error('Complete Google sign-in, then return to this page.');
      } else {
        if (!account.providerData.some((provider) => provider.providerId === 'google.com')) {
          await linkWithPopup(account, googleProvider);
        }
        const googleAccount = await signInWithGoogle();
        if (!googleAccount) throw new Error('Complete Google sign-in, then return to this page.');
        if (googleAccount.uid !== account.uid) throw new Error('Google signed in to a different website account. Use the account shown above or sign out first.');
        account = googleAccount;
      }
      const idToken = await account.getIdToken(true);
      const response = await fetch('/api/telegram/webhook?action=complete-google-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ state }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'Could not connect Telegram.');
      setDone(true);
      window.history.replaceState(null, '', '/telegram-connect');
    } catch (err: any) {
      setError(err?.message || 'Could not connect Telegram.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-16 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-8 shadow-lg dark:bg-slate-900">
        <h1 className="mb-3 text-2xl font-bold">Connect Telegram</h1>
        {done ? (
          <p>Your Telegram chat is connected. Return to the bot to receive approvals.</p>
        ) : (
          <>
            <p className="mb-4 text-sm">Sign in with the Google account linked to your existing website account. This connects your Telegram chat to that account.</p>
            {user && <p className="mb-4 text-sm">Current website account: <strong>{user.email || user.uid}</strong></p>}
            {!loading && <button type="button" onClick={connect} disabled={busy} className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Connecting…' : 'Continue with Google'}</button>}
            {loading && <p>Checking your website session…</p>}
            {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
            <p className="mt-5 text-xs text-slate-500">Need another account? <button type="button" onClick={() => auth.signOut()} className="underline">Sign out of the website</button>, then continue with Google.</p>
          </>
        )}
      </div>
    </main>
  );
}
