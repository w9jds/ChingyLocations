const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = {
    name: 'Server',
    context: __dirname,
    target: 'node',
    mode: process.env.NODE_ENV ? process.env.NODE_ENV : 'development',
    devtool: 'sourcemap',
    entry: {
        locations: ['isomorphic-fetch', './index.ts']
    },
    output: {
        path: path.resolve(__dirname, './build'),
        filename: '[name].js',
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader'
            }
        ]
    },
    externals: [nodeExternals()],
    resolve: {
        extensions: ['.ts', '.js']
    }
};
