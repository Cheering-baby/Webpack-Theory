const webpack = require("./webpack");
const config = require("../example/webpack.config");
// const compiler = webpack({});
// node index.js --mode=production --devtool=true
// console.log(process.argv.slice(2))

const compiler = webpack(config);

compiler.run((err, stats) => {
  console.log(123)
  if (err) {
    console.error(err, "err");
  }
});

