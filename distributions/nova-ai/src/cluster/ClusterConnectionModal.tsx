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
import { getEnvClusterConnection, parseKubeconfig, normalizeToken } from './connectionStore';
import { clearClusterSession, K8sApiError, testClusterConnection } from './k8sClient';
import { hasClusterCredentials, type ClusterConnection } from './types';
import { useClusterConnection } from './useClusterConnection';

type AuthMode = 'token' | 'kubeconfig';

type ClusterConnectionModalProps = {
  onClose: () => void;
};

const parseApiServer = (value: string): string | null => {
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

const ClusterConnectionModal: React.FC<ClusterConnectionModalProps> = ({ onClose }) => {
  const [connection, setConnection] = useClusterConnection();
  const envConnection = getEnvClusterConnection();
  const isEnvConnection = Boolean(connection?.useEnvKubeconfig);
  const [authMode, setAuthMode] = React.useState<AuthMode>(
    connection?.clientCertificateData ? 'kubeconfig' : 'token',
  );
  const [apiServer, setApiServer] = React.useState(
    connection?.useEnvKubeconfig ? '' : (connection?.apiServer ?? ''),
  );
  const [token, setToken] = React.useState(connection?.token ?? '');
  const [kubeconfig, setKubeconfig] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  const connectionFromKubeconfig = (): ClusterConnection | null => {
    const parsed = parseKubeconfig(kubeconfig);
    if (!parsed.apiServer) {
      setError('Kubeconfig must include a cluster server URL.');
      return null;
    }
    const server = parseApiServer(parsed.apiServer);
    if (!server) {
      setError('Cluster server URL in kubeconfig is not valid.');
      return null;
    }
    const next: ClusterConnection = {
      apiServer: server,
      token: parsed.token,
      clientCertificateData: parsed.clientCertificateData,
      clientKeyData: parsed.clientKeyData,
      certificateAuthorityData: parsed.certificateAuthorityData,
    };
    if (!hasClusterCredentials(next)) {
      setError(
        'Kubeconfig must include a user token or client-certificate-data and client-key-data. Exec plugins are not supported.',
      );
      return null;
    }
    return next;
  };

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    let next: ClusterConnection | null = null;
    if (authMode === 'kubeconfig') {
      next = connectionFromKubeconfig();
      if (!next) {
        return;
      }
    } else {
      const server = parseApiServer(apiServer.trim());
      const normalized = normalizeToken(token);
      if (!server || normalized === '') {
        setError('API server URL and bearer token are required.');
        return;
      }
      next = { apiServer: server, token: normalized };
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
    clearClusterSession();
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
          {envConnection ? (
            <Alert
              variant="info"
              isInline
              title={
                isEnvConnection
                  ? `Using kubeconfig from .env (${envConnection.apiServer})`
                  : `KUBECONFIG_BASE64 in .env is set (${envConnection.apiServer}). Connect below to override it.`
              }
            >
              Certs and tokens stay on the console server. Disconnect returns to this default.
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
                placeholder="Paste a kubeconfig with a token or client certificate"
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
        {connection && !isEnvConnection ? (
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
