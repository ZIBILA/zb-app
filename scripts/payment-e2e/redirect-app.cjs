// Test-only preload: run the apps' useRazorpay hooks in Node with fakes for React,
// React Native and the native Razorpay bridge.
const Module = require('module');
const path = require('path');
const f = (n) => path.join(__dirname, 'app-fakes', n);
const MAP = [
  [/^react$/, f('react.ts')],
  [/^react-native$/, f('react-native.ts')],
  [/utils\/razorpayBridge(\.tsx?)?$/, f('razorpayBridge.ts')],
  [/constants\/config(\.tsx?)?$/, f('misc.ts')],
  [/store\/authStore(\.tsx?)?$/, f('misc.ts')],
  [/api\/payment(\.tsx?)?$/, f('misc.ts')],
  [/services\/snapDeviceContext(\.tsx?)?$/, f('misc.ts')],
];
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  for (const [re, target] of MAP) if (re.test(request)) return target;
  return orig.call(this, request, parent, ...rest);
};
