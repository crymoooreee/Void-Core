function calculateLows(frames) {
 const times=frames.map(f=>f.frameTime).filter(v=>Number.isFinite(v)&&v>0).sort((a,b)=>b-a);
 const tail=ratio=>{const n=Math.floor(times.length*ratio);if(n<10)return null;return 1000*n/times.slice(0,n).reduce((a,b)=>a+b,0);};
 return {onePercentLow:tail(.01),pointOnePercentLow:tail(.001),lowSampleCount:times.length};
}
module.exports={calculateLows};
