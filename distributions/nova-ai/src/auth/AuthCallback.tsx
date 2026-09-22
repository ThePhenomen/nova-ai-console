import React from 'react';
import { Alert, Bullseye, Button, PageSection, Spinner } from '@patternfly/react-core';
import { useNavigate } from 'react-router-dom';
import { completeOidcLogin, formatOidcError, OidcError } from './oidcClient';
import { getAuthSession } from './authSession';

const AuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = React.useState<OidcError | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const complete = async () => {
      try {
        await completeOidcLogin(window.location.href);
        if (!cancelled) {
          navigate('/projects', { replace: true });
        }
      } catch (err) {
        if (!cancelled) {
          if (getAuthSession()) {
            navigate('/projects', { replace: true });
            return;
          }
          setError(
            err instanceof OidcError
              ? err
              : formatOidcError(err instanceof Error ? err.message : 'OIDC sign-in failed.'),
          );
        }
      }
    };
    void complete();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (error) {
    return (
      <PageSection>
        <Alert variant="danger" isInline title={error.title}>
          {error.message}
        </Alert>
        <Button variant="link" onClick={() => navigate('/projects', { replace: true })}>
          Back to console
        </Button>
      </PageSection>
    );
  }

  return (
    <PageSection>
      <Bullseye>
        <Spinner />
      </Bullseye>
    </PageSection>
  );
};

export default AuthCallback;
