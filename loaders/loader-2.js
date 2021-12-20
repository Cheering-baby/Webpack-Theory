function loader2(sourceCode) {
  console.log("loader 2");
  return sourceCode + '\n const loader2 = "loader2"';
}

module.exports = loader2;