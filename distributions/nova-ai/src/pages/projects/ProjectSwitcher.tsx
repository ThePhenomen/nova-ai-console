import React from 'react';
import { FormSelect, FormSelectOption, Spinner } from '@patternfly/react-core';
import { useLocation, useNavigate } from 'react-router-dom';
import { canShowKserveSettings, hasProjectService } from '../../auth/access';
import { usePlatformAccess } from '../../auth/usePlatformAccess';
import { useClusterConnection } from '../../cluster/useClusterConnection';
import { listProjects } from './projectApi';
import { getSelectedProject, setSelectedProject, useSelectedProject } from './selectedProjectStore';

const PAGE_SERVICES = [
  { prefix: '/workbench', service: 'Workbench' },
  { prefix: '/experiments', service: 'Experiments' },
  { prefix: '/deployments', service: 'Deployments' },
];

const projectFromPath = (pathname: string): string | undefined => {
  const match = pathname.match(/^\/projects\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
};

const ProjectSwitcher: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const connection = useClusterConnection();
  const { access, isLoading: isAccessLoading } = usePlatformAccess();
  const selected = useSelectedProject();
  const [names, setNames] = React.useState<string[]>([]);
  const [hasLoaded, setHasLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!connection || isAccessLoading) {
      return;
    }
    let cancelled = false;
    setHasLoaded(false);
    void listProjects()
      .then((projects) => {
        if (cancelled) {
          return;
        }
        setNames(
          projects
            .map((project) => project.name)
            .filter((name) => access.canViewProject(name))
            .toSorted((left, right) => left.localeCompare(right)),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setNames([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHasLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [access, connection, isAccessLoading]);

  React.useEffect(() => {
    if (!hasLoaded) {
      return;
    }
    const fromPath = projectFromPath(location.pathname);
    if (fromPath && names.includes(fromPath)) {
      setSelectedProject(fromPath);
      return;
    }
    if (names.length === 0) {
      if (getSelectedProject()) {
        setSelectedProject('');
      }
      return;
    }
    if (!names.includes(getSelectedProject())) {
      setSelectedProject(names[0]);
    }
  }, [hasLoaded, location.pathname, names]);

  React.useEffect(() => {
    if (!selected) {
      return;
    }
    const onSettings = location.pathname === '/settings' || location.pathname.startsWith('/settings/');
    const hiddenService = PAGE_SERVICES.find(
      (item) =>
        (location.pathname === item.prefix || location.pathname.startsWith(`${item.prefix}/`)) &&
        !hasProjectService(access.forProject(selected), item.service),
    );
    if (hiddenService || (onSettings && !canShowKserveSettings(access, selected))) {
      navigate(`/projects/${encodeURIComponent(selected)}/overview`, { replace: true });
    }
  }, [access, location.pathname, navigate, selected]);

  const choose = (name: string) => {
    setSelectedProject(name);
    const match = location.pathname.match(/^\/projects\/([^/]+)(\/.*)?$/);
    if (match) {
      navigate(`/projects/${encodeURIComponent(name)}${match[2] ?? '/overview'}`);
    }
  };

  if (!connection) {
    return null;
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ fontWeight: 600 }}>Project</span>
      {hasLoaded ? null : <Spinner diameter="1rem" aria-label="Loading projects" />}
      {hasLoaded ? (
        <FormSelect
          id="global-project-switcher"
          aria-label="Project"
          value={names.includes(selected) ? selected : ''}
          onChange={(_event, value) => {
            if (value) {
              choose(value);
            }
          }}
          isDisabled={names.length === 0}
          style={{ width: '14rem' }}
        >
          {names.length === 0 ? <FormSelectOption value="" label="No projects" /> : null}
          {names.map((name) => (
            <FormSelectOption key={name} value={name} label={name} />
          ))}
        </FormSelect>
      ) : null}
    </span>
  );
};

export default ProjectSwitcher;
