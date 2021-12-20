function loader1(sourceCode) {
  console.log("loader 1");
  return sourceCode + '\n const loader1 = "https://github.com/19Qingfeng"';
}

module.exports = loader1;