function getDefaultKey(environmentVariable: string) {
  const rawKeys = Deno.env.get(environmentVariable);
  if (!rawKeys) return undefined;

  try {
    const keys: unknown = JSON.parse(rawKeys);
    if (keys && typeof keys === 'object' && 'default' in keys && typeof keys.default === 'string') {
      return keys.default;
    }
    console.error(`Supabase key configuration ${environmentVariable} has no default key.`);
  } catch (error) {
    console.error(`Unable to parse Supabase key configuration ${environmentVariable}:`, error);
  }
  return undefined;
}

export function getSupabaseApiKeys() {
  return {
    anonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? getDefaultKey('SUPABASE_PUBLISHABLE_KEYS'),
    serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? getDefaultKey('SUPABASE_SECRET_KEYS'),
  };
}
