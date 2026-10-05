const path = require('path');

/** @type {import('webpack').Configuration} */
const extensionConfig = {
  name: 'extension',
  target: 'node',
  mode: 'none', // specified via CLI --mode
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs'
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  devtool: 'source-map'
};

/** @type {import('webpack').Configuration} */
const webviewConfig = {
  name: 'webview',
  target: 'web',
  mode: 'none', // specified via CLI --mode
  entry: './src/webview/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'webview.js'
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx']
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              transpileOnly: true
            }
          }
        ]
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  // The default 244 KiB hint targets sites downloaded over a network. This bundle
  // is read from local disk by the VS Code webview (and inlined into exported
  // reports), so only warn if it grows well beyond its current size.
  performance: {
    maxAssetSize: 512 * 1024,
    maxEntrypointSize: 512 * 1024
  },
  devtool: 'source-map'
};

module.exports = [extensionConfig, webviewConfig];
