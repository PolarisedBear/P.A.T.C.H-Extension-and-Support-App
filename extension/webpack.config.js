// webpack.config.js  
const path = require('path');  

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

function makeConfig({ name, target, entry, filename, experiments = {} }) {
  return {
    name,
    mode: isDev ? 'development' : 'production',
    target,
    entry,
    output: {
      filename,
      path: path.resolve(__dirname, 'dist'),
      devtoolModuleFilenameTemplate: 'webpack:///[absolute-resource-path]',
      clean: true
    },
    devtool: isDev ? 'source-map' : false,
    experiments,
    module: {
      rules: [babelRule],
    },
    optimization: {
      minimize : !isDev
    },
    stats: 'errors-warnings'
  }
}


module.exports = [
  makeConfig({
    name: 'background',
    target: 'webworker',
    entry: './src/background.js',
    filename: 'background.bundle.js',
  }),
  makeConfig({
    name: 'offscreen',
    target: 'web',
    entry: './src/offscreen.js',
    filename: 'offscreen.bundle.js',
    experiments: {
      toplevelAwait: true
    } 
  })
];