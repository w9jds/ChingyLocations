const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = {
    name: 'Server',
    context: __dirname,
    target: 'node',
    devtool: 'sourcemap',
    entry: {
        locations: ['babel-polyfill', 'isomorphic-fetch', './index.ts']
    },
    output: {
        path: path.resolve(__dirname, './build'),
        filename: '[name].js',
    },
    module: {
        loaders: [
            {
                test: /\.tsx?$/,
                use: [
                    {
                        loader: 'babel-loader',
                        options: {
                            presets: [
                                ['env', {'modules': false}]
                            ]
                        }
                    },
                    'ts-loader'
                ]
            }
        ]
    },
    externals: [nodeExternals()],
    resolve: {
        extensions: ['.ts', '.js']
    }
};
