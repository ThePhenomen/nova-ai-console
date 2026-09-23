const path = require('path');
const webpack = require('webpack');
const { merge } = require('webpack-merge');
require('./loadEnv');
const createWebpackCommon = require('../../base/config/webpack.common.js');
const GenerateDistributionExtensionsPlugin = require('../../base/config/generateDistributionExtensionsPlugin');

const SRC_DIR = path.resolve(__dirname, '../src');
const TITLE = 'Nova AI Console';

module.exports = (overrides = {}) =>
  merge(
    createWebpackCommon({
      distributionSrcDir: SRC_DIR,
      title: TITLE,
      ...overrides,
    }),
    {
      plugins: [
        new webpack.DefinePlugin({
          'process.env': JSON.stringify({
            PRODUCT_NAME: 'Nova AI',
            STARVAULT_OIDC_ISSUER: process.env.STARVAULT_OIDC_ISSUER || '',
            STARVAULT_OIDC_CLIENT_ID: process.env.STARVAULT_OIDC_CLIENT_ID || '',
            STARVAULT_OIDC_SCOPES: process.env.STARVAULT_OIDC_SCOPES || '',
            STARVAULT_OIDC_REDIRECT_URI: process.env.STARVAULT_OIDC_REDIRECT_URI || '',
            KUBECONFIG_API_SERVER: process.env.KUBECONFIG_API_SERVER || '',
            NOVA_CONSOLE_URL: process.env.NOVA_CONSOLE_URL || '',
          }),
        }),
        new GenerateDistributionExtensionsPlugin({
          configPath: path.resolve(__dirname, '../distribution.yaml'),
          targetFile: path.join(SRC_DIR, 'distribution-extensions.ts'),
        }),
      ],
    },
  );
