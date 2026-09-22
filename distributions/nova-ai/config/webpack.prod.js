const { merge } = require('webpack-merge');
require('./loadEnv');
const webpackCommon = require('./webpack.common.js');

module.exports = merge(webpackCommon(), {
  mode: 'production',
  devtool: 'source-map',
});
