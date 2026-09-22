const fs = require('fs');
const path = require('path');

const ENV_FILES = [
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../.env'),
];

const parseEnvLine = (line) => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }
  const eq = trimmed.indexOf('=');
  if (eq <= 0) {
    return null;
  }
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
};

const loadEnvFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const text = fs.readFileSync(filePath, 'utf8');
  text.split(/\r?\n/).forEach((line) => {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      return;
    }
    if (process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value;
    }
  });
};

ENV_FILES.forEach(loadEnvFile);

const parseKubeconfig = require('./parseKubeconfig');

const kubeconfigFromEnv = (() => {
  const encoded = process.env.KUBECONFIG_BASE64 || process.env.KUBECONFIG_B64;
  if (!encoded) {
    return null;
  }
  let text;
  try {
    text = Buffer.from(encoded.replace(/\s/g, ''), 'base64').toString('utf8');
  } catch {
    return null;
  }
  if (!text.trim()) {
    return null;
  }
  const parsed = parseKubeconfig(text);
  if (!parsed.apiServer) {
    // eslint-disable-next-line no-console
    console.warn('[loadEnv] KUBECONFIG_BASE64 is set but does not contain a cluster server URL.');
    return null;
  }
  if (process.env.KUBECONFIG_API_SERVER === undefined) {
    process.env.KUBECONFIG_API_SERVER = parsed.apiServer;
  }
  return parsed;
})();

module.exports = { kubeconfigFromEnv };
