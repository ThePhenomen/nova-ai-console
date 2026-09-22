const path = require('path');
const { merge } = require('webpack-merge');
const ForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');
require('./loadEnv');
const webpackCommon = require('./webpack.common.js');
const k8sProxyMiddleware = require('./k8sProxy');

const RELATIVE_DIRNAME = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(RELATIVE_DIRNAME, 'public');
const PORT = process.env.PORT || 4020;
const HOST = process.env.HOST || '0.0.0.0';

module.exports = merge(webpackCommon(), {
  mode: 'development',
  devtool: 'eval-source-map',
  optimization: {
    runtimeChunk: 'single',
    removeEmptyChunks: true,
  },
  devServer: {
    host: HOST,
    port: PORT,
    allowedHosts: 'all',
    compress: true,
    historyApiFallback: true,
    hot: true,
    client: {
      overlay: true,
    },
    static: {
      directory: DIST_DIR,
    },
    setupMiddlewares: (middlewares) => {
      middlewares.unshift({
        name: 'k8s-proxy',
        middleware: k8sProxyMiddleware,
      });
      return middlewares;
    },
    onListening: (devServer) => {
      const addr = devServer?.server?.address();
      if (addr) {
        const green = '\x1b[32m';
        const underline = '\x1b[4m';
        const reset = '\x1b[0m';
        const url = `http://${HOST}:${addr.port}`;
        console.log(`${green}✓ Nova AI Console available at: ${underline}${url}${reset}`);
      } else {
        console.warn('Nova AI Console dev server started but could not determine address');
      }
    },
  },
  plugins: [new ForkTsCheckerWebpackPlugin()],
});
