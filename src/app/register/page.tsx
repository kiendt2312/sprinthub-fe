'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { handOffRegistrationEmail, useGuestLocale } from '@/components/auth-entry';
import styles from '@/components/self-serve-form.module.css';
import { Brand } from '@/components/shell';
import { api, ApiError } from '@/lib/api';
import { selfServeCopy, selfServeError } from '@/lib/self-serve-copy';

type FieldErrors = Partial<Record<'displayName' | 'email' | 'password', string>>;

export default function RegisterPage() {
  const router = useRouter();
  const locale = useGuestLocale();
  const copy = selfServeCopy[locale].register;
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [apiError, setApiError] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    const form = event.currentTarget;
    const displayNameField = form.elements.namedItem('displayName') as HTMLInputElement;
    const emailField = form.elements.namedItem('email') as HTMLInputElement;
    const passwordField = form.elements.namedItem('password') as HTMLInputElement;
    const displayName = displayNameField.value.trim();
    const email = emailField.value.trim();
    const password = passwordField.value;
    const passwordLength = Array.from(password).length;
    const fieldErrors: FieldErrors = {};
    if (!displayName || Array.from(displayName).length > 80) fieldErrors.displayName = copy.invalidName;
    if (!email || emailField.validity.typeMismatch || email.length > 254) fieldErrors.email = copy.invalidEmail;
    if (passwordLength < 15 || passwordLength > 128) fieldErrors.password = copy.invalidPassword;
    setApiError('');
    setErrors(fieldErrors);
    const firstInvalidField = Object.keys(fieldErrors)[0];
    if (firstInvalidField) {
      (form.elements.namedItem(firstInvalidField) as HTMLInputElement).focus();
      return;
    }

    inFlight.current = true;
    setPending(true);
    try {
      await api.register({ email, password, displayName });
      form.reset();
      if (form.isConnected) {
        handOffRegistrationEmail(email);
        router.replace('/login');
      }
    } catch (failure) {
      setApiError(failure instanceof ApiError ? failure.code : 'INTERNAL_ERROR');
      inFlight.current = false;
      setPending(false);
    }
  }

  function clearError(field: keyof FieldErrors) {
    if (errors[field]) setErrors(previous => ({ ...previous, [field]: undefined }));
  }

  return (
    <main className="sh-login" lang={locale}>
      <div className="sh-login-brand"><Brand /></div>
      <section className="sh-login-card" aria-labelledby="register-title">
        <h1 id="register-title">{copy.title}</h1>
        <form method="post" onSubmit={submit} className="sh-login-form" noValidate>
          <div className={styles.field}>
            <label htmlFor="register-display-name">{copy.displayName}</label>
            <input id="register-display-name" name="displayName" autoComplete="name" required readOnly={pending}
              aria-invalid={!!errors.displayName} aria-describedby={errors.displayName ? 'register-name-error' : undefined}
              onChange={() => clearError('displayName')} />
            {errors.displayName && <p id="register-name-error" className="sh-form-error" role="alert">{errors.displayName}</p>}
          </div>
          <div className={styles.field}>
            <label htmlFor="register-email">{copy.email}</label>
            <input id="register-email" name="email" type="email" autoComplete="username" required readOnly={pending}
              aria-invalid={!!errors.email} aria-describedby={errors.email ? 'register-email-error' : undefined}
              onChange={() => clearError('email')} />
            {errors.email && <p id="register-email-error" className="sh-form-error" role="alert">{errors.email}</p>}
          </div>
          <div className={styles.field}>
            <label htmlFor="register-password">{copy.password}</label>
            <input id="register-password" name="password" type="password" autoComplete="new-password" required readOnly={pending}
              aria-invalid={!!errors.password} aria-describedby={errors.password ? 'register-password-error' : 'register-password-hint'}
              onChange={() => clearError('password')} />
            {errors.password
              ? <p id="register-password-error" className="sh-form-error" role="alert">{errors.password}</p>
              : <small id="register-password-hint">{copy.passwordHint}</small>}
          </div>
          {apiError && <p className="sh-form-error" role="alert">{selfServeError(locale, apiError)}</p>}
          <button type="submit" className="sh-button" disabled={pending}>{pending ? copy.pending : copy.submit}</button>
        </form>
        <p className={styles.entryLink}><Link href="/login">{copy.signIn}</Link></p>
      </section>
    </main>
  );
}
