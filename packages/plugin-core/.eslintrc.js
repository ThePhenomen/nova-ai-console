module.exports = require('@nova-ai/eslint-config')
  .extend({
    rules: {
      'no-barrel-files/no-barrel-files': 'off',
    },
  })
  .recommendedReactTypescript(__dirname);
