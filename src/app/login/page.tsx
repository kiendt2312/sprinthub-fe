'use client';

import { useState, type FormEvent } from 'react';
import { Brand } from '@/components/shell';
import { api, errorMessage } from '@/lib/api';

function returnPath() {
  const value = new URLSearchParams(window.location.search).get('returnTo');
  if (value && /^\/(projects|workspaces)(?:\/[a-z0-9_/-]+)?(?:\?.*)?$/iu.test(value)) return value;
  return '/workspaces';
}

export default function LoginPage() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const fields = new FormData(event.currentTarget);
    setPending(true);
    setError('');
    try {
      await api.login({ email: String(fields.get('email')), password: String(fields.get('password')) });
      window.location.replace(returnPath());
    } catch (failure) {
      setError(errorMessage(failure));
      setPending(false);
    }
  }

  return (
    <main className="sh-login">
      <div className="sh-login-brand"><Brand /></div>
      <section className="sh-login-card" aria-labelledby="sign-in-title">
        <h1 id="sign-in-title">Sign in</h1>
        <form onSubmit={submit} className="sh-login-form">
          <label>Email<input type="email" name="email" autoComplete="username" required /></label>
          <label>Password<input type="password" name="password" autoComplete="current-password" required /></label>
          {error && <p className="sh-form-error" role="alert">{error}</p>}
          <button type="submit" className="sh-button" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
