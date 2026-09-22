const path = require('path');
const webpack = require('webpack');
const { merge } = require('webpack-merge');
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
          'process.env.PRODUCT_NAME': JSON.stringify('Nova AI'),
          'process.env': '({})',
        }),
        new GenerateDistributionExtensionsPlugin({
          configPath: path.resolve(__dirname, '../distribution.yaml'),
          targetFile: path.join(SRC_DIR, 'distribution-extensions.ts'),
        }),
      ],
    },
  );
