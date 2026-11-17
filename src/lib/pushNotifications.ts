export async function registerPushToken(_profileId: string): Promise<boolean> {
  throw new Error('Push notifications are only available on a mobile device.');
}

export async function syncPushToken(_profileId: string): Promise<void> {}

export async function unregisterPushToken(_profileId: string): Promise<void> {}

export const registerProviderPushToken = registerPushToken;
