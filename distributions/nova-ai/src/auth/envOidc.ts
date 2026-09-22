const readEnv = (key: string): string | undefined => {
  const value = process.env[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export const getEnvOidcConfig = (): {
  issuer: string;
  clientId: string;
  scopes?: string;
  redirectUri?: string;
} | null => {
  const issuer = readEnv('STARVAULT_OIDC_ISSUER');
  const clientId = readEnv('STARVAULT_OIDC_CLIENT_ID');
  if (!issuer || !clientId) {
    return null;
  }
  return {
    issuer: issuer.replace(/\/$/, ''),
    clientId,
    scopes: readEnv('STARVAULT_OIDC_SCOPES'),
    redirectUri: readEnv('STARVAULT_OIDC_REDIRECT_URI'),
  };
};
