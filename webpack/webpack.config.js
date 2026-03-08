const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
module.exports = {
   mode: "production",
   entry: {
      service_worker: path.resolve(__dirname, "..", "src", "service_worker.ts"),
      popup: path.resolve(__dirname, "..", "src", "popup.ts"),
      content_script: path.resolve(__dirname, "..", "src", "content_script.ts"),
      youtube_content: path.resolve(__dirname, "..", "src", "youtube_content.ts"),
      youtube_main_world: path.resolve(__dirname, "..", "src", "youtube_main_world.ts"),
   },
   output: {
      path: path.join(__dirname, "../dist"),
      filename: "[name].js",
   },
   resolve: {
      extensions: [".ts", ".js"],
   },
   module: {
      rules: [
         {
            test: /\.tsx?$/,
            loader: "ts-loader",
            exclude: /node_modules/,
         },
      ],
   },
   plugins: [
      new CopyPlugin({
         patterns: [{from: ".", to: ".", context: "public"}]
      }),
   ],
};
