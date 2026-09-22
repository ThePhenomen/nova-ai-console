import React from 'react';
import { Alert, Bullseye, PageSection, Spinner } from '@patternfly/react-core';
import { useNavigate } from 'react-router-dom';
import { completeOidcLogin, OidcError } from './oidcClient';

const AuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const [error, setError] = React.useState<string | null>(null);

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
          setError(
            err instanceof OidcError || err instanceof Error
              ? err.message
              : 'OIDC sign-in failed.',
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
        <Alert variant="danger" isInline title="Could not complete sign-in">
          {error}
        </Alert>
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
