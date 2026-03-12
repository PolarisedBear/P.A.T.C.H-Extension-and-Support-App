// webpack.config.js  
const path = require('path');  
 
module.exports = {  
  // Entry: The file where your code starts (e.g., background.js)  
  entry: './src/background.js',  
 
  // Output: Where Webpack saves the bundled file  
  output: {  
    filename: 'bundle.js', // Name of the bundled file  
    path: path.resolve(__dirname, 'dist'), // Save it to the "dist" folder  
  },  
 
  // Mode: "development" (unminified, for testing) or "production" (minified)  
  mode: 'development',  
 
  // Module rules: How to process different file types  
  module: {  
    rules: [  
      {  
        // Transpile ES6+ code using Babel  
        test: /\.js$/, // Apply to all .js files  
        exclude: /node_modules/, // Don’t process NPM modules (they’re already bundled)  
        use: {  
          loader: 'babel-loader',  
          options: { presets: ['@babel/preset-env'] } // Preset for modern JS  
        }  
      }  
    ]  
  }  
};  