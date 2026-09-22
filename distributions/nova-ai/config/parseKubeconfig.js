const kubeconfigScalar = (text, key) => {
  const match = text.match(new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm'));
  if (!match) {
    return undefined;
  }
  const value = match[1].trim().replace(/^['"]|['"]$/g, '');
  if (value === '|' || value === '|-' || value === '>' || value === '>-') {
    const lines = text.slice(match.index ?? 0).split('\n').slice(1);
    const block = [];
    for (const line of lines) {
      if (line.startsWith(' ') || line.startsWith('\t')) {
        block.push(line.trim());
        continue;
      }
      break;
    }
    const joined = block.join('').trim();
    return joined === '' ? undefined : joined;
  }
  return value === '' ? undefined : value;
};

const parseKubeconfig = (text) => {
  const apiServer = kubeconfigScalar(text, 'server');
  const token = kubeconfigScalar(text, 'token');
  const clientCertificateData = kubeconfigScalar(text, 'client-certificate-data');
  const clientKeyData = kubeconfigScalar(text, 'client-key-data');
  const certificateAuthorityData = kubeconfigScalar(text, 'certificate-authority-data');
  return {
    ...(apiServer ? { apiServer: apiServer.replace(/\/$/, '') } : {}),
    ...(token ? { token } : {}),
    ...(clientCertificateData ? { clientCertificateData } : {}),
    ...(clientKeyData ? { clientKeyData } : {}),
    ...(certificateAuthorityData ? { certificateAuthorityData } : {}),
  };
};

module.exports = parseKubeconfig;
