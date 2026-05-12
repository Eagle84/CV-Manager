const path = require("node:path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyPlugin = require("copy-webpack-plugin");
const webpack = require("webpack");

module.exports = (_, argv) => {
  const isProd = argv.mode === "production";

  return {
    entry: path.resolve(__dirname, "src/main.tsx"),
    output: {
      path: path.resolve(__dirname, "dist"),
      filename: isProd ? "assets/[name].[contenthash:8].js" : "assets/[name].js",
      chunkFilename: isProd ? "assets/[name].[contenthash:8].chunk.js" : "assets/[name].chunk.js",
      clean: true,
      publicPath: "/",
    },
    resolve: {
      extensions: [".tsx", ".ts", ".js"],
      alias: {
        shared: path.resolve(__dirname, "../shared/src"),
      },
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          exclude: /node_modules/,
          use: {
            loader: "ts-loader",
            options: {
              transpileOnly: true,
              configFile: path.resolve(__dirname, "tsconfig.app.json"),
              compilerOptions: {
                noEmit: false,
                allowImportingTsExtensions: false,
              },
            },
          },
        },
        {
          test: /\.css$/i,
          use: ["style-loader", "css-loader"],
        },
      ],
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: path.resolve(__dirname, "index.html"),
      }),
      new CopyPlugin({
        patterns: [
          { from: path.resolve(__dirname, "public"), to: path.resolve(__dirname, "dist") },
        ],
      }),
      new webpack.DefinePlugin({
        __VITE_API_BASE__: JSON.stringify(process.env.VITE_API_BASE ?? ""),
      }),
    ],
    devServer: {
      historyApiFallback: true,
      allowedHosts: "all",
      client: false,
      hot: false,
      liveReload: false,
      proxy: [
        {
          context: ["/api"],
          target: "http://127.0.0.1:8787",
          changeOrigin: true,
        },
      ],
    },
    devtool: isProd ? "source-map" : "eval-source-map",
  };
};
