const { execFile } = require('node:child_process');
const HIGH_PERFORMANCE = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DVR_KEYS = [
  {path:'Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR',name:'AppCaptureEnabled'},
  {path:'System\\GameConfigStore',name:'GameDVR_Enabled'}
];
function run(file,args) {
  return new Promise((resolve,reject)=>execFile(file,args,{windowsHide:true,timeout:8000,maxBuffer:1024*1024},(error,stdout)=>error?reject(error):resolve(String(stdout).trim())));
}
function ps(script) {
  return run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from("$ErrorActionPreference='Stop';\n"+script,'utf16le').toString('base64')]);
}
function validateValue(value) {
  return value && typeof value.exists==='boolean' && (!value.exists || (value.kind==='DWord' && Number.isInteger(value.value) && value.value>=0 && value.value<=0xffffffff));
}
function readKey(index) {
  if(!Number.isInteger(index)||!DVR_KEYS[index])throw Error('Invalid registry index');
  const key=DVR_KEYS[index];
  return ps(`$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${key.path}');
try {
 $exists=$null -ne $k -and $k.GetValueNames() -contains '${key.name}';
 if($exists){$kind=$k.GetValueKind('${key.name}').ToString(); $value=$k.GetValue('${key.name}'); @{exists=$true;kind=$kind;value=$value}|ConvertTo-Json -Compress}
 else{@{exists=$false;kind=$null;value=$null}|ConvertTo-Json -Compress}
} finally {if($k){$k.Dispose()}}`).then(text=>{const value=JSON.parse(text);if(!validateValue(value))throw Error('Unexpected registry value type');return value;});
}
async function writeKey(index,value) {
  if(!Number.isInteger(index)||!DVR_KEYS[index]||!validateValue(value))throw Error('Invalid registry value');
  const key=DVR_KEYS[index];
  if(value.exists){
    const signed=value.value>0x7fffffff?value.value-0x100000000:value.value;
    await ps(`$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('${key.path}');try{$k.SetValue('${key.name}',[int]${signed},[Microsoft.Win32.RegistryValueKind]::DWord)}finally{$k.Dispose()}`);
  }else{
    await ps(`$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('${key.path}',$true);if($k){try{$k.DeleteValue('${key.name}',$false)}finally{$k.Dispose()}}`);
  }
}
function createWindowsProfile() {
 return {
  async power(){const output=await run('powercfg.exe',['/getactivescheme']);const match=output.match(/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i);if(!match)throw Error('Active scheme unavailable');return match[0].toLowerCase();},
  async highAvailable(){return (await run('powercfg.exe',['/list'])).toLowerCase().includes(HIGH_PERFORMANCE);},
  async setPower(guid){if(!GUID.test(guid))throw Error('Invalid power scheme');await run('powercfg.exe',['/setactive',guid]);},
  async onAC(){try{const battery=await require('systeminformation').battery();return battery.hasBattery===false || battery.acConnected===true;}catch(error){return false;}},
  readKey,writeKey
 };
}
module.exports={createWindowsProfile,HIGH_PERFORMANCE,GUID,validateValue};
