import React from 'react';
import {
  Alert,
  Button,
  Form,
  FormGroup,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Radio,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import { parseKubeconfig, normalizeToken } from './connectionStore';
import { K8sApiError, testClusterConnection } from './k8sClient';
import { useClusterConnection } from './useClusterConnection';
import type { ClusterConnection } from './types';

type AuthMode = 'token' | 'kubeconfig';

type ClusterConnectionModalProps = {
  onClose: () => void;
};

const ClusterConnectionModal: React.FC<ClusterConnectionModalProps> = ({ onClose }) => {
  const [connection, setConnection] = useClusterConnection();
  const [authMode, setAuthMode] = React.useState<AuthMode>('token');
  const [apiServer, setApiServer] = React.useState(connection?.apiServer ?? '');
  const [token, setToken] = React.useState(connection?.token ?? '');
  const [kubeconfig, setKubeconfig] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  const applyKubeconfig = (): ClusterConnection | null => {
    const parsed = parseKubeconfig(kubeconfig);
    if (!parsed.apiServer || !parsed.token) {
      setError(
        'Kubeconfig must include a cluster server URL and a user token. Client certificates and exec plugins are not supported.',
      );
      return null;
    }
    setApiServer(parsed.apiServer);
    setToken(parsed.token);
    return { apiServer: parsed.apiServer, token: parsed.token };
  };

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    let next: ClusterConnection | null = null;
    if (authMode === 'kubeconfig') {
      next = applyKubeconfig();
      if (!next) {
        return;
      }
    } else {
      const trimmedServer = apiServer.trim();
      const normalized = normalizeToken(token);
      if (trimmedServer === '' || normalized === '') {
        setError('API server URL and bearer token are required.');
        return;
      }
      try {
        const parsed = new URL(trimmedServer);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          setError('API server URL must start with https:// or http://');
          return;
        }
      } catch {
        setError('API server URL is not valid.');
        return;
      }
      next = { apiServer: trimmedServer.replace(/\/$/, ''), token: normalized };
    }

    setIsSaving(true);
    try {
      await testClusterConnection(next);
      setConnection(next);
      onClose();
    } catch (err) {
      setError(err instanceof K8sApiError ? err.message : 'Failed to connect to the cluster.');
    } finally {
      setIsSaving(false);
    }
  };

  const disconnect = () => {
    setConnection(null);
    setToken('');
    onClose();
  };

  return (
    <Modal isOpen variant="medium" onClose={onClose} aria-label="Cluster connection">
      <ModalHeader title="Cluster connection" />
      <ModalBody>
        <Form id="cluster-connection-form" onSubmit={connect}>
          {error ? (
            <Alert variant="danger" isInline title="Could not connect">
              {error}
            </Alert>
          ) : null}
          <FormGroup role="radiogroup" isInline fieldId="cluster-auth-mode" label="Credentials">
            <Radio
              id="cluster-auth-token"
              name="cluster-auth-mode"
              label="Bearer token"
              isChecked={authMode === 'token'}
              onChange={() => setAuthMode('token')}
            />
            <Radio
              id="cluster-auth-kubeconfig"
              name="cluster-auth-mode"
              label="Kubeconfig"
              isChecked={authMode === 'kubeconfig'}
              onChange={() => setAuthMode('kubeconfig')}
            />
          </FormGroup>
          {authMode === 'token' ? (
            <>
              <FormGroup label="API server URL" isRequired fieldId="cluster-api-server">
                <TextInput
                  id="cluster-api-server"
                  value={apiServer}
                  onChange={(_event, value) => setApiServer(value)}
                  placeholder="https://192.168.1.10:6443"
                  isRequired
                />
              </FormGroup>
              <FormGroup label="Bearer token" isRequired fieldId="cluster-token">
                <TextArea
                  id="cluster-token"
                  value={token}
                  onChange={(_event, value) => setToken(value)}
                  placeholder="Service account or user token"
                  autoComplete="off"
                  rows={4}
                  isRequired
                />
              </FormGroup>
            </>
          ) : (
            <FormGroup label="Kubeconfig" isRequired fieldId="cluster-kubeconfig">
              <TextArea
                id="cluster-kubeconfig"
                value={kubeconfig}
                onChange={(_event, value) => setKubeconfig(value)}
                placeholder="Paste a kubeconfig that contains server and token"
                rows={10}
                isRequired
              />
            </FormGroup>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          key="connect"
          variant="primary"
          type="submit"
          form="cluster-connection-form"
          isLoading={isSaving}
          isDisabled={isSaving}
        >
          Connect
        </Button>
        {connection ? (
          <Button key="disconnect" variant="secondary" onClick={disconnect} isDisabled={isSaving}>
            Disconnect
          </Button>
        ) : null}
        <Button key="cancel" variant="link" onClick={onClose} isDisabled={isSaving}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ClusterConnectionModal;
