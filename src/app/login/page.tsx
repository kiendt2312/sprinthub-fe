'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { takeRegistrationEmail, useGuestLocale } from '@/components/auth-entry';
import styles from '@/components/self-serve-form.module.css';
import { Brand } from '@/components/shell';
import { api, errorMessage } from '@/lib/api';
import { selfServeCopy } from '@/lib/self-serve-copy';

function returnPath() {
  const value = new URLSearchParams(window.location.search).get('returnTo');
  if (value && /^\/(projects|workspaces)(?:\/[a-z0-9_/-]+)?(?:\?.*)?$/iu.test(value)) return value;
  return '/workspaces';
}

export default function LoginPage() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [registrationAccepted, setRegistrationAccepted] = useState(false);
  const locale = useGuestLocale();
  const copy = selfServeCopy[locale].register;

  useEffect(() => {
    const acceptedEmail = takeRegistrationEmail();
    if (acceptedEmail !== undefined) {
      setEmail(acceptedEmail);
      setRegistrationAccepted(true);
    }
  }, []);

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
        <div role="status" lang={locale}>
          {registrationAccepted && <p className={styles.notice}>{copy.accepted}</p>}
        </div>
        <form method="post" onSubmit={submit} className="sh-login-form">
          <label>Email<input type="email" name="email" autoComplete="username" required
            value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>Password<input type="password" name="password" autoComplete="current-password" required /></label>
          {error && <p className="sh-form-error" role="alert">{error}</p>}
          <button type="submit" className="sh-button" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className={styles.entryLink} lang={locale}><Link href="/register">{copy.title}</Link></p>
      </section>
    </main>
  );
}
