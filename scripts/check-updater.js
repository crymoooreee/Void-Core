const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
try {
  const pkg = require(path.join(root, "package.json"));
  const lock = require(path.join(root, "package-lock.json"));
  if (!pkg.dependencies?.["electron-updater"]) throw new Error("electron-updater is not a production dependency");
  if (lock.packages?.[""]?.dependencies?.["electron-updater"] !== pkg.dependencies["electron-updater"]) {
    throw new Error("Updater dependency is not synchronized in package-lock.json");
  }
  require.resolve("electron-updater", { paths: [root] });
  console.log("Updater dependency is ready for build");
} catch (error) {
  console.error("Run npm run setup:updates before building. " + error.message);
  process.exitCode = 1;
}
