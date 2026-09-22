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
  const [config, setConfig] = useOidcConfig();
  const [issuer, setIssuer] = React.useState(config?.issuer ?? '');
  const [clientId, setClientId] = React.useState(config?.clientId ?? 'nova-ai-console');
  const [scopes, setScopes] = React.useState(config?.scopes ?? 'openid');
  const [error, setError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const redirectUri =
    typeof window === 'undefined' ? '/auth/callback' : `${window.location.origin}/auth/callback`;

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
      scopes: scopes.trim() || 'openid',
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
        description="Nova AI Console uses the StarVault OIDC provider. Register this redirect URI on the OIDC client."
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
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  StarVault identity OIDC provider issuer. Discovery is fetched through the
                  console proxy.
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
            />
          </FormGroup>
          <FormGroup label="Scopes" fieldId="oidc-scopes">
            <TextInput
              id="oidc-scopes"
              value={scopes}
              onChange={(_event, value) => setScopes(value)}
              placeholder="openid"
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
