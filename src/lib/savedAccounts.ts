import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';

export type SavedAccount = {
  id: string;
  name: string;
  email: string;
};

type SavedAccountCredentials = SavedAccount & { refreshToken: string };

const accountIdsKey = 'serviceconnect.saved-account-ids';
const accountKey = (id: string) => `serviceconnect.saved-account.${id}`;

let storageQueue: Promise<void> = Promise.resolve();

function enqueueStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageQueue.then(operation);
  storageQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') throw new Error('Browser storage is unavailable.');
    return localStorage.getItem(key);
  }
  return AsyncStorage.getItem(key);
}

async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') throw new Error('Browser storage is unavailable.');
    localStorage.setItem(key, value);
    return;
  }
  await AsyncStorage.setItem(key, value);
}

async function removeItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof localStorage === 'undefined') throw new Error('Browser storage is unavailable.');
    localStorage.removeItem(key);
    return;
  }
  await AsyncStorage.removeItem(key);
}

async function readAccountIds(): Promise<string[]> {
  const serializedIds = await getItem(accountIdsKey);
  if (serializedIds === null) return [];
  const parsed: unknown = JSON.parse(serializedIds);
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string')) {
    throw new Error('Saved account list is invalid. Clear the app storage and sign in again.');
  }
  return [...new Set(parsed)];
}

function isSavedAccountCredentials(value: unknown, id: string): value is SavedAccountCredentials {
  return typeof value === 'object'
    && value !== null
    && 'id' in value
    && value.id === id
    && 'name' in value
    && typeof value.name === 'string'
    && 'email' in value
    && typeof value.email === 'string'
    && 'refreshToken' in value
    && typeof value.refreshToken === 'string'
    && Boolean(value.refreshToken);
}

async function readAccount(id: string): Promise<SavedAccountCredentials | null> {
  const serializedAccount = await getItem(accountKey(id));
  if (serializedAccount === null) return null;
  const parsed: unknown = JSON.parse(serializedAccount);
  if (!isSavedAccountCredentials(parsed, id)) {
    throw new Error('A saved account is invalid. Sign in to that account again.');
  }
  return parsed;
}

async function readSavedAccounts(): Promise<SavedAccount[]> {
  const ids = await readAccountIds();
  const accounts = await Promise.all(ids.map((id) => readAccount(id)));
  return accounts.filter((account): account is SavedAccountCredentials => account !== null)
    .map(({ id, name, email }) => ({ id, name, email }));
}

export async function loadSavedAccounts(): Promise<SavedAccount[]> {
  return enqueueStorageOperation(readSavedAccounts);
}

export async function saveSessionAccount(session: Session): Promise<void> {
  const refreshToken = session.refresh_token;
  if (!refreshToken) throw new Error('The active session has no refresh token to save.');

  const metadata = session.user.user_metadata;
  const metadataName = typeof metadata.full_name === 'string'
    ? metadata.full_name
    : typeof metadata.name === 'string'
      ? metadata.name
      : '';
  const email = session.user.email ?? '';
  const account: SavedAccountCredentials = {
    id: session.user.id,
    name: metadataName || email.split('@')[0] || 'Fixhub user',
    email,
    refreshToken,
  };

  await enqueueStorageOperation(async () => {
    const ids = await readAccountIds();
    await setItem(accountKey(account.id), JSON.stringify(account));
    await setItem(accountIdsKey, JSON.stringify([...ids.filter((id) => id !== account.id), account.id]));
  });
}

export async function getSavedAccountRefreshToken(id: string): Promise<string | null> {
  return enqueueStorageOperation(async () => {
    const account = await readAccount(id);
    return account?.refreshToken ?? null;
  });
}

export async function removeSavedAccount(id: string): Promise<void> {
  await enqueueStorageOperation(async () => {
    const ids = await readAccountIds();
    await removeItem(accountKey(id));
    await setItem(accountIdsKey, JSON.stringify(ids.filter((accountId) => accountId !== id)));
  });
}
