import React from 'react';
import { Button, Label } from '@patternfly/react-core';
import { UserIcon } from '@patternfly/react-icons';
import { usePluginStore } from '@nova-ai/plugin-core';
import { hasConsoleService } from './access';
import { CONSOLE_NAV_SERVICES } from '../consoleServices';
import { getEnvOidcConfig } from './envOidc';
import OidcLoginModal from './OidcLoginModal';
import { getOidcConfig } from './oidcStore';
import { logoutOidc, startOidcLogin } from './oidcClient';
import { useAuthSession } from './useAuthSession';
import { usePlatformAccess } from './usePlatformAccess';

const AuthToolbarItem: React.FC = () => {
  const store = usePluginStore();
  const [session] = useAuthSession();
  const { access } = usePlatformAccess();
  const [isOpen, setIsOpen] = React.useState(false);

  React.useEffect(() => {
    store.setFeatureFlags(
      Object.fromEntries(
        CONSOLE_NAV_SERVICES.map((service) => [
          service.id,
          hasConsoleService(access, service.title),
        ]),
      ),
    );
  }, [access, store]);

  const signIn = async () => {
    const config = getEnvOidcConfig() ?? getOidcConfig();
    if (!config) {
      setIsOpen(true);
      return;
    }
    try {
      await startOidcLogin(config);
    } catch {
      setIsOpen(true);
    }
  };

  if (!session) {
    return (
      <>
        <Button variant="plain" icon={<UserIcon />} onClick={() => void signIn()} aria-label="Sign in">
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
      <Label color="grey" isCompact icon={<UserIcon />}>
        {access.username ?? session.user.username}
      </Label>
      <Button variant="link" isInline onClick={() => logoutOidc()}>
        Sign out
      </Button>
    </span>
  );
};

export default AuthToolbarItem;
