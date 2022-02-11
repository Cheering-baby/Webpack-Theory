const { SyncHook } = require("tapable");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const generator = require("@babel/generator").default;
const t = require("@babel/types");
const { toUnixPath, tryExtensions, getSourceCode } = require("./utils");
const path = require("path");
const fs = require("fs");

class Compiler {
  constructor(options) {
    this.options = options;
    // 相对路径根路径 Context参数
    this.rootPath = this.options.context || toUnixPath(process.cwd());
    // 创建plugin hooks
    this.hooks = {
      // 开始编译时的钩子
      run: new SyncHook(),
      // 输出asset到output目前之前执行（写入文件之前）
      emit: new SyncHook(),
      // 编译完成时执行
      done: new SyncHook(),
    };
    // 保存所有入口模块对象
    this.entries = new Set();
    // 保存所有模块依赖对象
    this.modules = new Set();
    // 所有的代码块对象
    this.chunks = new Set();
    // 存放本地产出的文件对象
    this.assets = new Set();
    // 所有编译产出文件名
    this.files = new Set();
  }

  // run是编译的方法
  // 同时接受外部传递的回调函数
  run(callback) {
    // 当调用run方法时，触发开始编译的plugins
    this.hooks.run.call();
    // 获取入口配置对象
    const entry = this.getEntry();
    // 编译入口文件
    this.buildEntryModule(entry);
    this.exportFile(callback)
  }

  exportFile(callback) {
    const output = this.options.output;
    // 根据chunks生成assets内容
    this.chunks.forEach((chunk) => {
      const parseFileName = output.filename.replace("[name]", chunk.name);
      this.assets[parseFileName] = getSourceCode(chunk);
    });
    // 调用Plugin emit钩子
    this.hooks.emit.call();
    // 先判断目录是否存在，存在直接fs.write 不存在则先创建
    if (!fs.existsSync(output.path)) {
      fs.mkdirSync(output.path);
    }
    // files中保存所有的生成文件名
    this.files = Object.keys(this.assets);
    Object.keys(this.assets).forEach((filename) => {
      const filePath = path.join(output.path, filename);
      fs.writeFileSync(filePath, this.assets[filename]);
    });
    // 结束之后触发钩子
    this.hooks.done.call();
    callback(null, {
      toJson: () => ({
        entries: this.entries,
        modules: this.modules,
        files: this.files,
        chunks: this.chunks,
        assets: this.assets,
      }),
    });
  }

  buildEntryModule(entry) {
    Object.keys(entry).forEach((entryName) => {
      const entryPath = entry[entryName];
      const entryObj = this.buildModule(entryName, entryPath); // 编译对应的入口文件
      this.entries.add(entryObj); // 加入入口文件集合
      this.buildUpChunk(entryName, entryObj);
    });
  }

  // 根据入口文件和依赖模块组装chunks
  buildUpChunk(entryName, entryObj) {
    const chunk = {
      name: entryName, // 每一个文件入口作为一个chunk
      entryModule: entryObj, // 编译后的对象
      modules: Array.from(this.modules).filter((i) =>
        i.name.includes(entryName)
      ),
    };
    this.chunks.add(chunk);
  }

  buildModule(moduleName, modulePath) {
    // 读取文件源代码
    const originSourceCode = (this.originSourceCode = fs.readFileSync(
      modulePath,
      "utf-8"
    ));
    this.moduleCode = originSourceCode;
    this.handleLoader(modulePath); // 每个文件都要匹配loader插件规则
    const module = this.handleWebpackCompiler(moduleName, modulePath);
    return module;
  }

  handleWebpackCompiler(moduleName, modulePath) {
    // 将当前模块相对于项目启动根目录计算出相对路径 作为模块ID ./example/src/entry1.js
    const moduleId =
      "./" + toUnixPath(path.relative(this.rootPath, modulePath));
    // 创建模块对象
    const module = {
      id: moduleId,
      dependencies: new Set(), // 该模块所依赖模块的绝对路劲地址
      name: [moduleName], // 该模块所属的入口文件
    };
    // 调用babel分析我们的代码
    const ast = parser.parse(this.moduleCode, { sourceType: "module" });
    // 深度优先, 遍历语法tree
    traverse(ast, {
      // 当遇到require语句时
      CallExpression: (nodePath) => {
        const node = nodePath.node;
        if (node.callee.name === "require") {
          // requirePath: ./common
          const requirePath = node.arguments[0].value;
          // 寻找模块绝对路劲, 当前模块路劲 + require()对应相对路径
          // moduleDirName: d:/project/webpack/Webpack-Theory/example/src
          const moduleDirName = toUnixPath(path.dirname(modulePath));
          // d:/project/webpack/Webpack-Theory/example/src/common
          const absolutePath = tryExtensions(
            toUnixPath(path.join(moduleDirName, requirePath)),
            this.options.resolve.extensions,
            requirePath,
            moduleDirName
          );
          // 生成moduleId, 针对根路径的模块ID, 添加进入新的依赖模块路径
          // ./example/src/common.js
          const moduleId =
            "./" + toUnixPath(path.relative(this.rootPath, absolutePath));
          // 通过babel修改源代码中的require变成__webpack_require__语句
          node.callee = t.identifier("__webpack_require__");
          // 修改源代码中require语句引入的模块 全部修改变为相对于跟路径来处理
          // { type: 'StringLiteral', value: './example/src/common.js' } t.stringLiteral(moduleId)
          node.arguments = [t.stringLiteral(moduleId)];
          const alreadyModules = Array.from(this.modules).map((i) => i.id);
          if (!alreadyModules.includes(moduleId)) {
            // 为当前模块添加require语句造成的依赖(内容相对于根路径的模块ID)
            module.dependencies.add(moduleId);
          } else {
            // 已经存在的话 虽然不进行添加进入模块编译 但是仍要更新这个模块依赖的入口
            this.module.forEach((value) => {
              if (value.id === moduleId) {
                value.name.push(moduleName);
              }
            });
          }
        }
      },
    });
    // 遍历结束根据AST生成新的代码
    const { code } = generator(ast);
    // 为当前模块挂载新生成代码
    module._source = code;
    // 递归依赖深度遍历 存在依赖模块则加入
    module.dependencies.forEach((dependency) => {
      const depModule = this.buildModule(moduleName, dependency);
      this.modules.add(depModule);
    });
    return module;
  }

  handleLoader(modulePath) {
    const matchLoaders = [];
    // 获取rules规则
    const rules = this.options.module.rules;
    rules.forEach((loader) => {
      const testRule = loader.test;
      if (testRule.test(modulePath)) {
        if (loader.loader) {
          // 仅考虑loader { test:/\.js$/g, use:['babel-loader'] }, { test:/\.js$/, loader:'babel-loader' }
          matchLoaders.push(loader.loader);
        } else {
          matchLoaders.push(...loader.use);
        }
      }
      // 倒叙处理，将处理过的sourceCode传递到下一个loader
      for (let i = matchLoaders.length - 1; i >= 0; i--) {
        // 目前我们外部仅支持传入绝对路径的loader模式
        // require引入对应loader
        const loaderFn = require(matchLoaders[i]);
        // 通过loader同步处理每一次编译的sourceCode
        this.moduleCode = loaderFn(this.moduleCode);
      }
    });
  }

  //获取入口文件路径
  getEntry() {
    let entry = Object.create(null);
    const { entry: optionsEntry } = this.options;
    if (typeof optionsEntry === "string") {
      entry["main"] = optionsEntry;
    } else {
      entry = optionsEntry;
    }
    Object.keys(entry).forEach((key) => {
      const value = entry[key];
      if (!path.isAbsolute(value)) {
        // 转化为绝对路径的同时统一路径分隔符为 /
        entry[key] = toUnixPath(path.join(this.rootPath, value));
      }
    });

    return entry;
  }
}

module.exports = Compiler;
