import React from 'react';
import {
  Alert,
  Button,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextInput,
} from '@patternfly/react-core';
import { getEnvOidcConfig } from './envOidc';
import { OidcError, startOidcLogin } from './oidcClient';
import { useOidcConfig } from './useOidcConfig';

type OidcLoginModalProps = {
  onClose: () => void;
};

const parseIssuer = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return value.replace(/\/$/, '');
  } catch {
    return null;
  }
};

const OidcLoginModal: React.FC<OidcLoginModalProps> = ({ onClose }) => {
  const envConfig = getEnvOidcConfig();
  const [config, setConfig] = useOidcConfig();
  const [issuer, setIssuer] = React.useState(config?.issuer ?? envConfig?.issuer ?? '');
  const [clientId, setClientId] = React.useState(
    config?.clientId ?? envConfig?.clientId ?? 'nova-ai-console',
  );
  const [clientSecret, setClientSecret] = React.useState(config?.clientSecret ?? '');
  const [scopes, setScopes] = React.useState(
    config?.scopes ?? envConfig?.scopes ?? 'openid name email',
  );
  const [error, setError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const envLocked = Boolean(envConfig);
  const redirectUri =
    config?.redirectUri ||
    envConfig?.redirectUri ||
    (typeof window === 'undefined' ? '/auth/callback' : `${window.location.origin}/auth/callback`);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const nextIssuer = parseIssuer(issuer.trim());
    const nextClientId = clientId.trim();
    if (!nextIssuer || nextClientId === '') {
      setError('StarVault issuer URL and OIDC client ID are required.');
      return;
    }
    const next = {
      issuer: nextIssuer,
      clientId: nextClientId,
      clientSecret: clientSecret.trim() || undefined,
      scopes: scopes.trim() || 'openid',
      redirectUri,
    };
    setConfig(next);
    setIsSaving(true);
    try {
      await startOidcLogin(next);
    } catch (err) {
      setError(err instanceof OidcError || err instanceof Error ? err.message : 'Failed to start OIDC login.');
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen variant="medium" onClose={onClose} aria-label="Sign in with StarVault">
      <ModalHeader
        title="Sign in with StarVault"
        description={
          envLocked
            ? 'OIDC settings are loaded from the console .env file.'
            : 'Nova AI Console uses the StarVault OIDC provider. Set values in .env or enter them here.'
        }
      />
      <ModalBody>
        <Form id="oidc-login-form" onSubmit={submit}>
          {error ? (
            <Alert variant="danger" isInline title="Could not start sign-in">
              {error}
            </Alert>
          ) : null}
          <FormGroup label="Issuer URL" isRequired fieldId="oidc-issuer">
            <TextInput
              id="oidc-issuer"
              value={issuer}
              onChange={(_event, value) => setIssuer(value)}
              placeholder="https://starvault.example.com/v1/identity/oidc/provider/nova"
              isRequired
              isDisabled={envLocked}
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  STARVAULT_OIDC_ISSUER. Discovery is fetched through the console proxy.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Client ID" isRequired fieldId="oidc-client-id">
            <TextInput
              id="oidc-client-id"
              value={clientId}
              onChange={(_event, value) => setClientId(value)}
              placeholder="nova-ai-console"
              isRequired
              isDisabled={envLocked}
            />
          </FormGroup>
          {envLocked ? null : (
            <FormGroup label="Client secret" fieldId="oidc-client-secret">
              <TextInput
                id="oidc-client-secret"
                type="password"
                value={clientSecret}
                onChange={(_event, value) => setClientSecret(value)}
                autoComplete="off"
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    Prefer STARVAULT_OIDC_CLIENT_SECRET in .env so the secret stays on the
                    webpack proxy. Required for confidential StarVault clients.
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
          )}
          <FormGroup label="Scopes" fieldId="oidc-scopes">
            <TextInput
              id="oidc-scopes"
              value={scopes}
              onChange={(_event, value) => setScopes(value)}
              placeholder="openid name email"
              isDisabled={envLocked}
            />
          </FormGroup>
          <FormGroup label="Redirect URI" fieldId="oidc-redirect-uri">
            <TextInput id="oidc-redirect-uri" value={redirectUri} isDisabled />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          key="signin"
          variant="primary"
          type="submit"
          form="oidc-login-form"
          isLoading={isSaving}
          isDisabled={isSaving}
        >
          Sign in
        </Button>
        <Button key="cancel" variant="link" onClick={onClose} isDisabled={isSaving}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default OidcLoginModal;
