export function signOutFromGoogle(): Promise<void> {
  return Promise.resolve();
}

export async function signInWithGoogle(_selectAccount = false): Promise<boolean> {
  throw new Error('Google sign-in is not available on this platform.');
}
