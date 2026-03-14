// webpack.config.js  
const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');  

const isDev = process.env.NODE_ENV !== 'production';
 
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

function makeConfig({ name, target, entry, filename, patterns = [], experiments = {}, clean = false }) {
  return {
    name,
    mode: isDev ? 'development' : 'production',
    target,
    entry,
    output: {
      filename,
      path: path.resolve(__dirname, 'dist'),
      devtoolModuleFilenameTemplate: 'webpack:///[absolute-resource-path]',
      clean
    },
    devtool: isDev ? 'source-map' : false,
    experiments,
    module: {
      rules: [babelRule],
    },
    optimization: {
      minimize : !isDev
    },
    stats: 'errors-warnings',
    plugins: patterns.length ? [
      new CopyWebpackPlugin({
        patterns
      })
    ] : []
  }
}


module.exports = [
  makeConfig({
    name: 'background',
    target: 'webworker',
    entry: './src/background.js',
    filename: 'background.bundle.js',
    patterns: [
      {
        from: path.resolve(__dirname, 'onnx-wasm'),
        to: 'onnx-wasm'
      },
      {
        from: path.resolve(__dirname, 'models/mental-health-bert-finetuned-onnx'),
        to: 'models/mental-health-bert-finetuned-onnx'
      },
      {
        from: path.resolve(__dirname, 'MANIFEST.json'),
        to: 'MANIFEST.json'
      },
      {
        from: path.resolve(__dirname, 'offscreen.html'),
        to: 'offscreen.html'
      },
      {
        from: path.resolve(__dirname, 'src/popup.js'),
        to: 'popup.js'
      },
      {
        from: path.resolve(__dirname, 'src/popup.html'),
        to: 'popup.html'
      },
      {
        from: path.resolve(__dirname, 'src/content.js'),
        to: 'content.js'
      },
      {
        from: path.resolve(__dirname, 'src/content.css'),
        to: 'content.css'
      },
      {
        from: path.resolve(__dirname, 'src/options.js'),
        to: 'options.js'
      },
      {
        from: path.resolve(__dirname, 'src/options.html'),
        to: 'options.html'
      },
      {
        from: path.resolve(__dirname, 'tesseract'),
        to: 'tesseract'
      },
      {
        from: path.resolve(__dirname, 'tesseract/lang'),
        to: 'tesseract/lang'
      }
    ]
  }),
  makeConfig({
    name: 'offscreen',
    target: 'web',
    entry: './src/offscreen.js',
    filename: 'offscreen.bundle.js',
    patterns: [],
    experiments: {
      topLevelAwait: true
    } 
  })
];