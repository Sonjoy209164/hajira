const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Allow Metro to read symlinked workspace packages (npm "file:" deps).
config.watchFolders = [path.join(workspaceRoot, "packages")];

// Ensure deps are resolved from this app's node_modules (not the workspace root).
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [path.join(projectRoot, "node_modules")];

module.exports = config;

