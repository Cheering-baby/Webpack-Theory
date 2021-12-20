class PluginA {
  apply(compiler) {
    compiler.hooks.run.tap('Plugin A', () => {
      console.log("Plugin A")
    })
  }
}

module.exports = PluginA;