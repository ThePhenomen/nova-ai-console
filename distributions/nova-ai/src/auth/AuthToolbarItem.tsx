import React from 'react';
import { Button, Label } from '@patternfly/react-core';
import { UserIcon } from '@patternfly/react-icons';
import { usePluginStore } from '@nova-ai/plugin-core';
import { hasConsoleService } from './access';
import OidcLoginModal from './OidcLoginModal';
import { logoutOidc } from './oidcClient';
import { useAuthSession } from './useAuthSession';
import { usePlatformAccess } from './usePlatformAccess';

const personaColor = (persona: string): 'green' | 'blue' | 'grey' | 'orange' => {
  if (persona === 'admin') {
    return 'green';
  }
  if (persona === 'developer') {
    return 'blue';
  }
  if (persona === 'viewer') {
    return 'grey';
  }
  return 'orange';
};

const personaLabel = (source: string, persona: string): string => {
  if (source === 'bootstrap') {
    return 'admin (kubeconfig)';
  }
  if (persona === 'none') {
    return 'no platform role';
  }
  return persona;
};

const AuthToolbarItem: React.FC = () => {
  const store = usePluginStore();
  const [session] = useAuthSession();
  const { access } = usePlatformAccess();
  const [isOpen, setIsOpen] = React.useState(false);

  React.useEffect(() => {
    store.setFeatureFlags({
      'mlflow-experiments': hasConsoleService(access, 'mlflow'),
    });
  }, [access, store]);

  if (!session) {
    return (
      <>
        <Button variant="plain" icon={<UserIcon />} onClick={() => setIsOpen(true)} aria-label="Sign in">
          <Label color="orange" isCompact>
            Sign in
          </Label>
        </Button>
        {isOpen ? <OidcLoginModal onClose={() => setIsOpen(false)} /> : null}
      </>
    );
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      <Label color={personaColor(access.clusterPersona)} isCompact icon={<UserIcon />}>
        {access.username ?? session.user.username} · {personaLabel(access.source, access.clusterPersona)}
      </Label>
      <Button variant="link" isInline onClick={() => logoutOidc()}>
        Sign out
      </Button>
    </span>
  );
};

export default AuthToolbarItem;
