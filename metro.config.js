const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// The stale repository snapshot contains duplicate packages and application
// files. Keep it out of Metro, just as it is excluded from Jest.
config.resolver.blockList = [
  ...[].concat(config.resolver.blockList || []),
  /[/\\]\.git-rewrite[/\\].*/,
];

module.exports = config;
