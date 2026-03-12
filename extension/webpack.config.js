// webpack.config.js  
const path = require('path');  
 
const babelRule = {
  test: /\.js$/,
  exclude: /node_modules/,
  use: {
    loader: 'babel-loader',
    options: {
      presets: ['@babel/preset-env'],
    },
  },
};

module.exports = [
  {
    name: 'background',
    mode: 'production',
    target: 'webworker',
    entry: './src/background.js',
    output: {
      filename: 'background.bundle.js',
      path: path.resolve(__dirname, 'dist'),
    },
    devtool: false,
    module: {
      rules: [babelRule],
    },
  },
  {
    name: 'offscreen',
    mode: 'production',
    target: 'web',
    entry: './src/offscreen.js',
    output: {
      filename: 'offscreen.bundle.js',
      path: path.resolve(__dirname, 'dist'),
    },
    devtool: false,
    experiments: {
      topLevelAwait: true,
    },
    module: {
      rules: [babelRule],
    },
  },
];