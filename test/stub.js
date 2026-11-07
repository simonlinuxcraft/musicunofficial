'use strict';

// Stands in for electron or a module under src/, so main-process code loads in
// plain node. Must run before the module under test is required.
const path = require('path');

module.exports = function stub(request, exports) {
  const file = require.resolve(request.startsWith('.') ? path.join(__dirname, '..', 'src', request) : request);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
