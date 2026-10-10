// Test-only preload: route every import of lib/db (alias or relative) to the in-memory Prisma.
const Module = require('module');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const realDb = [path.join(root, 'lib/db'), path.join(root, 'lib/db.ts')];
const memory = path.join(__dirname, 'memory-prisma.ts');
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  const resolved = orig.call(this, request, parent, ...rest);
  if (realDb.includes(resolved)) return memory;
  return resolved;
};
