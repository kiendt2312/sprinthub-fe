'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, isCreateOutcomeUnknown, newMutation } from '@/lib/api';
import { selfServeCopy, selfServeError, type Locale } from '@/lib/self-serve-copy';
import styles from './self-serve-form.module.css';

type Target = { kind: 'workspace' } | { kind: 'project'; workspaceId: string };
type CreateAttempt = { readonly mutation: Readonly<ReturnType<typeof newMutation>> } & (
  | { readonly body: Readonly<Parameters<typeof api.createWorkspace>[0]> }
  | { readonly workspaceId: string; readonly body: Readonly<Parameters<typeof api.createProject>[1]> }
);

const workspaceSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const projectKey = /^[A-Z0-9]{2,10}$/u;

function suggestIdentifier(kind: Target['kind'], name: string) {
  if (kind === 'project') {
    const key = name.replace(/[^A-Za-z0-9]/gu, '').toUpperCase().slice(0, 10);
    return projectKey.test(key) ? key : '';
  }

  return name.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/đ/gu, 'd')
    .replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 64).replace(/-$/u, '');
}

export function DirectoryCreate({ title, locale, target }: { title: string; locale: Locale; target: Target }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (!open && restoreFocus.current) {
      toggle.current?.focus();
      restoreFocus.current = false;
    }
  }, [open]);

  return (
    <>
      <header className={styles.directoryHeader}>
        <h1>{title}</h1>
        <button ref={toggle} type="button" lang={locale} className="sh-button" hidden={open} onClick={() => setOpen(true)}>
          {selfServeCopy[locale][target.kind].create}
        </button>
      </header>
      {open && <CreateForm locale={locale} target={target} onCancel={() => {
        restoreFocus.current = true;
        setOpen(false);
      }} />}
    </>
  );
}

function CreateForm({ locale, target, onCancel }: { locale: Locale; target: Target; onCancel: () => void }) {
  const router = useRouter();
  const copy = selfServeCopy[locale];
  const fields = copy[target.kind];
  const prefix = `create-${target.kind}`;
  const form = useRef<HTMLFormElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const identifierField = useRef<HTMLInputElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const [name, setName] = useState('');
  const [manualIdentifier, setManualIdentifier] = useState<string | null>(null);
  const [nameInvalid, setNameInvalid] = useState(false);
  const [identifierError, setIdentifierError] = useState<'invalid' | 'duplicate' | null>(null);
  const [apiError, setApiError] = useState('');
  const [pending, setPending] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState<CreateAttempt | null>(null);
  const identifier = manualIdentifier ?? suggestIdentifier(target.kind, name);
  const locked = pending || retryAttempt !== null;

  useEffect(() => {
    nameField.current?.focus();
  }, []);

  useEffect(() => {
    if (retryAttempt && !pending) retryButton.current?.focus();
  }, [retryAttempt, pending]);

  async function send(attempt: CreateAttempt) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setApiError('');
    setIdentifierError(null);

    let destination: string;
    try {
      if ('workspaceId' in attempt) {
        const project = await api.createProject(attempt.workspaceId, attempt.body, attempt.mutation);
        destination = `/projects/${project.id}/board`;
      } else {
        const workspace = await api.createWorkspace(attempt.body, attempt.mutation);
        destination = `/workspaces/${workspace.id}`;
      }
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.code : 'INTERNAL_ERROR';
      if (isCreateOutcomeUnknown(failure)) {
        setRetryAttempt(attempt);
      } else {
        // The write quota is checked before Redis can replay an earlier result.
        if (code !== 'RATE_LIMITED') setRetryAttempt(null);
        if (code === 'WORKSPACE_SLUG_TAKEN' || code === 'PROJECT_KEY_TAKEN') {
          setIdentifierError('duplicate');
          identifierField.current?.focus();
        } else {
          setApiError(code);
        }
      }
      inFlight.current = false;
      setPending(false);
      return;
    }

    setRetryAttempt(null);
    if (form.current) router.push(destination);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || retryAttempt) return;

    const trimmedName = name.trim();
    const validName = trimmedName.length > 0 && Array.from(trimmedName).length <= 100;
    const validIdentifier = target.kind === 'workspace'
      ? identifier.length <= 64 && workspaceSlug.test(identifier)
      : projectKey.test(identifier);
    setApiError('');
    setNameInvalid(!validName);
    setIdentifierError(validIdentifier ? null : 'invalid');
    if (!validName || !validIdentifier) {
      (validName ? identifierField : nameField).current?.focus();
      return;
    }

    const mutation = newMutation();
    const attempt: CreateAttempt = target.kind === 'workspace'
      ? { body: { name: trimmedName, slug: identifier }, mutation }
      : { workspaceId: target.workspaceId, body: { name: trimmedName, key: identifier }, mutation };
    void send(attempt);
  }

  return (
    <form ref={form} method="post" className={`sh-login-form ${styles.directoryForm}`} lang={locale}
      aria-labelledby={`${prefix}-title`} onSubmit={submit} noValidate>
      <h2 id={`${prefix}-title`}>{fields.create}</h2>
      <div className={styles.field}>
        <label htmlFor={`${prefix}-name`}>{fields.name}</label>
        <input ref={nameField} id={`${prefix}-name`} name="name" value={name} required readOnly={locked}
          aria-invalid={nameInvalid} aria-describedby={nameInvalid ? `${prefix}-name-error` : undefined}
          onChange={event => {
            const value = event.target.value;
            setName(value);
            setNameInvalid(false);
            if (manualIdentifier === null && suggestIdentifier(target.kind, value) !== identifier) setIdentifierError(null);
          }} />
        {nameInvalid && <p id={`${prefix}-name-error`} className="sh-form-error" role="alert">{copy.invalidResourceName}</p>}
      </div>
      <div className={styles.field}>
        <label htmlFor={`${prefix}-identifier`}>{fields.identifier}</label>
        <input ref={identifierField} id={`${prefix}-identifier`} name={target.kind === 'workspace' ? 'slug' : 'key'}
          value={identifier} required readOnly={locked} spellCheck={false}
          aria-invalid={!!identifierError} aria-describedby={`${prefix}-${identifierError ? 'identifier-error' : 'identifier-hint'}`}
          onChange={event => {
            setManualIdentifier(event.target.value);
            setIdentifierError(null);
          }} />
        {identifierError
          ? <p id={`${prefix}-identifier-error`} className="sh-form-error" role="alert">
            {identifierError === 'invalid' ? fields.invalidIdentifier : fields.duplicate}
          </p>
          : <small id={`${prefix}-identifier-hint`}>{fields.identifierHint}</small>}
      </div>
      {apiError && <p className="sh-form-error" role="alert">{selfServeError(locale, apiError)}</p>}
      {retryAttempt && !pending && !apiError && <p className="sh-form-error" role="alert">{copy.outcomeUnknown}</p>}
      <div className={styles.actions}>
        {retryAttempt ? (
          <button ref={retryButton} type="button" className="sh-button" disabled={pending} onClick={() => void send(retryAttempt)}>
            {pending ? copy.creating : copy.retry}
          </button>
        ) : (
          <button type="submit" className="sh-button" disabled={pending}>{pending ? copy.creating : fields.create}</button>
        )}
        <button type="button" className="sh-button sh-button-secondary" disabled={pending} onClick={onCancel}>{copy.cancel}</button>
      </div>
    </form>
  );
}
