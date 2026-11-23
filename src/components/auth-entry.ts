'use client';

import { useSyncExternalStore } from 'react';
import type { Locale } from '@/lib/self-serve-copy';

let registrationEmail: string | undefined;

export function handOffRegistrationEmail(email: string) {
  registrationEmail = email;
}

export function takeRegistrationEmail() {
  const email = registrationEmail;
  registrationEmail = undefined;
  return email;
}

function subscribe(listener: () => void) {
  window.addEventListener('languagechange', listener);
  return () => window.removeEventListener('languagechange', listener);
}

function getLocale(): Locale {
  return navigator.language.toLowerCase().split('-')[0] === 'vi' ? 'vi' : 'en';
}

function getDefaultLocale(): Locale {
  return 'en';
}

export function useGuestLocale() {
  return useSyncExternalStore(subscribe, getLocale, getDefaultLocale);
}
