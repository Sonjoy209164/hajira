const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const demoRoot = path.resolve(__dirname, "..");

function findRepoRoot(fromDir) {
  let dir = fromDir;
  for (let i = 0; i < 20; i++) {
    const core = path.join(dir, "packages", "tracking-core");
    const init = path.join(dir, "packages", "tracking-init");
    if (fs.existsSync(core) && fs.existsSync(init)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const repoRoot = findRepoRoot(demoRoot);
if (!repoRoot) {
  throw new Error("Could not locate repo root (expected packages/tracking-core + packages/tracking-init)");
}

const trackingCorePath = path.join(repoRoot, "packages", "tracking-core");
const trackingInitPath = path.join(repoRoot, "packages", "tracking-init");

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

function ensureSymlinkForTypes() {
  const scopeDir = path.join(trackingInitPath, "node_modules", "@hajiracm");
  fs.mkdirSync(scopeDir, { recursive: true });

  const linkPath = path.join(scopeDir, "tracking-core");
  fs.rmSync(linkPath, { recursive: true, force: true });
  fs.symlinkSync(trackingCorePath, linkPath, "dir");
}

ensureSymlinkForTypes();

run("npx", ["tsc", "-p", path.join(trackingCorePath, "tsconfig.build.json")], demoRoot);
run("npx", ["tsc", "-p", path.join(trackingInitPath, "tsconfig.build.json")], demoRoot);
