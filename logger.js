// logger.js
// Minimal: central app logger + optional HTTP access logging (no env vars).

const morgan = require('morgan');

// --- Internal state (change via setters below) ---
let level = 'info';                 // 'silent' | 'error' | 'warn' | 'info' | 'debug'

// --- App logger ---
const rank = { silent: -1, error: 0, warn: 1, info: 2, debug: 3 };
const allow = (lvl) => rank[lvl] <= rank[level];

const logger = {
  error: (...a) => allow('error') && console.error(...a),
  warn:  (...a) => allow('warn')  && console.warn(...a),
  info:  (...a) => allow('info')  && console.info(...a),
  debug: (...a) => allow('debug') && console.debug(...a),
};

// --- HTTP access logs (morgan), off by default ---
const httpLogger = morgan('combined', {
  skip: (req, res) => {   
    return true;
  },
});

// --- Simple controls (call these anywhere in your code) ---
function setLogLevel(newLevel) {
  if (rank[newLevel] === undefined) throw new Error(`Invalid level: ${newLevel}`);
  level = newLevel;
}

module.exports = {
  logger,
  httpLogger,
  setLogLevel,
};
