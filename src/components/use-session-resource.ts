'use client';

import { useEffect, useState } from 'react';
import { ApiError, errorMessage, sessionInvalidEvent } from '@/lib/api';

type SessionResource<T> =
  | { kind: 'pending' }
  | { kind: 'ready'; data: T }
  | { kind: 'error'; message: string };

export function returnToLogin() {
  const destination = window.location.pathname + window.location.search;
  window.location.replace('/login?returnTo=' + encodeURIComponent(destination));
}

export function useSessionResource<T>(load: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [current, setCurrent] = useState<{ load: typeof load; attempt: number; value: SessionResource<T> }>();

  useEffect(() => {
    let active = true;
    const invalidate = () => {
      active = false;
      setCurrent(undefined);
      returnToLogin();
    };

    window.addEventListener(sessionInvalidEvent, invalidate);
    load().then(
      data => {
        if (active) setCurrent({ load, attempt, value: { kind: 'ready', data } });
      },
      error => {
        if (!active) return;
        if (error instanceof ApiError && error.code === 'SESSION_INVALID') {
          invalidate();
        } else {
          setCurrent({ load, attempt, value: { kind: 'error', message: errorMessage(error) } });
        }
      },
    );
    return () => {
      active = false;
      window.removeEventListener(sessionInvalidEvent, invalidate);
    };
  }, [load, attempt]);

  const state: SessionResource<T> = current?.load === load && current.attempt === attempt
    ? current.value
    : { kind: 'pending' };

  return { state, retry: () => setAttempt(last => last + 1) };
}
