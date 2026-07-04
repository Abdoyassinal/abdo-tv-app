module.exports = function (api) {
  api.cache(false);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['@babel/plugin-transform-react-jsx', { runtime: 'automatic' }]
    ]
  };
};
