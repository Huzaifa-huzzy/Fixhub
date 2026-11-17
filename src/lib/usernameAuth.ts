export function normalizeUsername(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}
