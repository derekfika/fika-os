// Diskless TypeScript execution for isolated tests. No tsx CLI/IPC or generated files.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
exports.typescriptLoader = function ({ typescript, appRoot, mocks = {}, fetch: testFetch }) {
  const cache = new Map();
  function load(filename) {
    filename = path.resolve(filename);
    if (Object.hasOwn(mocks, filename)) return mocks[filename];
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const source = fs.readFileSync(filename, 'utf8').replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(filename).href)).replace(/import\.meta\.dirname/g, JSON.stringify(path.dirname(filename))).replace(/import\.meta\.filename/g, JSON.stringify(filename));
    const js = typescript.transpileModule(source, { compilerOptions: { module: typescript.ModuleKind.CommonJS, target: typescript.ScriptTarget.ES2022, esModuleInterop: true, jsx: typescript.JsxEmit.ReactJSX } }).outputText;
    const nativeRequire = createRequire(filename);
    const localRequire = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('@/') || name.startsWith('.')) {
        const target = name.startsWith('@/') ? path.join(appRoot, name.slice(2)) : path.resolve(path.dirname(filename), name);
        for (const candidate of [target, target + '.ts', target + '.tsx', path.join(target, 'index.ts')]) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          if (/\.tsx?$/.test(candidate)) return load(candidate);
          return nativeRequire(candidate);
        }
      }
      // Local workspace packages export TS sources; resolve those through the
      // same loader so extensionless relative imports stay diskless as well.
      const resolved = nativeRequire.resolve(name);
      if (/\.tsx?$/.test(resolved)) return load(resolved);
      return nativeRequire(name);
    };
    const compiled = vm.runInThisContext('(function(exports,require,module,__filename,__dirname,fetch){' + js + '\n})', { filename });
    compiled(module.exports, localRequire, module, filename, path.dirname(filename), testFetch || ((...args) => globalThis.fetch(...args)));
    return module.exports;
  }
  return load;
};
