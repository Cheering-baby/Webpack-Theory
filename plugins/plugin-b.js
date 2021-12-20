class PluginB {
  apply(compiler) {
    compiler.hooks.run.tap("Plugin B", () => {
      console.log("Plugin B");
    });
  }
}

module.exports = PluginB;
