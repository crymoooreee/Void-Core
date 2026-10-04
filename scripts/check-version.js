const fs = require("node:fs");
const path = require("node:path");
function checkVersion(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const core = "(?:0|[1-9]\\d*)";
  const identifier = "(?:0|[1-9]\\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)";
  const semver = new RegExp(`^${core}\\.${core}\\.${core}(?:-${identifier}(?:\\.${identifier})*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`);
  if (typeof pkg.version !== "string" || !semver.test(pkg.version)) {
    throw new Error("package.json version must be valid SemVer (e.g. 0.4.6)");
  }
  if (lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version) {
    throw new Error("Version mismatch: use npm version <number> --no-git-tag-version to synchronize package files");
  }
  const html = fs.readFileSync(path.join(root, "renderer/index.html"), "utf8");
  if (!html.includes('data-app-version') || !html.includes('js/version.js')) {
    throw new Error("Dynamic application version is not connected in the interface");
  }
  if (/VOIDCORE\s+\d+\.\d+\.\d+/i.test(html)) {
    throw new Error("Hard-coded sidebar version found; use data-app-version");
  }
  return pkg.version;
}
if (require.main === module) {
  try {
    console.log(`Version check passed: ${checkVersion(path.resolve(__dirname, ".."))}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { checkVersion };
