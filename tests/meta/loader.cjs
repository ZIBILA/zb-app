const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');

// Execute the actual TypeScript modules with explicit boundary doubles. No live DB/network.
function loader(stubs = {}, globals = {}) {
  const cache = new Map();
  const environment = { ...process.env, NODE_ENV: 'test', META_CAPI_ACCESS_TOKEN: `EAA${'x'.repeat(80)}` };
  delete environment.META_TEST_EVENT_CODE;
  const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, Buffer, URL, Headers, Request, Response,
    AbortSignal, Date, Math, Map, Set, Promise, Uint8Array, process: { env: environment }, setTimeout, clearTimeout,
    fetch: () => { throw new Error('Unmocked network forbidden'); }, ...globals });
  function load(spec, parent = root) {
    if (Object.hasOwn(stubs, spec)) return stubs[spec];
    if (!spec.startsWith('.') && !spec.startsWith('@/') && !path.isAbsolute(spec)) return require(spec);
    let file = spec.startsWith('@/') ? path.join(root, spec.slice(2)) : path.resolve(parent, spec);
    if (!path.extname(file)) file += '.ts';
    const relative = path.relative(root, file).replaceAll(path.sep, '/');
    if (Object.hasOwn(stubs, relative)) return stubs[relative];
    if (cache.has(file)) return cache.get(file).exports;
    const source = fs.readFileSync(file, 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    const module = { exports: {} };
    cache.set(file, module);
    vm.runInContext(`(function(require,module,exports){${js}\n})`, context, { filename: file })(s => load(s, path.dirname(file)), module, module.exports);
    return module.exports;
  }
  return { load: spec => load(path.join(root, spec)), context };
}
module.exports = { loader, root };
