const si = require("systeminformation");
let snapshot = null;
let completedAt = 0;
let inFlight = null;
async function getProcessSnapshot() {
    if (snapshot && Date.now() - completedAt < 5000) return snapshot;
    if (!inFlight) {
        inFlight = si.processes().then(result => {
            snapshot = result.list || [];
            completedAt = Date.now();
            return snapshot;
        }).finally(() => { inFlight = null; });
    }
    return inFlight;
}
module.exports = { getProcessSnapshot };
