// Manually invoked, read-only provider contract check. Never writes to Mendocean.
// Supply BHC_CONTRACT_TOKEN through a process environment, not a command-line argument.
const token=process.env.BHC_CONTRACT_TOKEN;
if(!token)throw new Error('BHC_CONTRACT_TOKEN is required; do not paste it into logs or command arguments');
let requests=0;
async function read(path,args={}){if(++requests>5)throw new Error('Read budget exceeded');const url=new URL('https://api.boathouseconnect.com/'+path);url.searchParams.set('token',token);for(const [k,v]of Object.entries(args))url.searchParams.set(k,String(v));try{const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error();return await r.json();}catch{throw new Error('BHC contract request failed (credential and payload withheld)');}}
function list(x){if(Array.isArray(x))return x;if(Array.isArray(x?.data))return x.data;throw new Error('BHC list shape changed');}
try {
 const auth=await read('authenticate/checkApiKey');if(!Number(auth.custid))throw new Error('Authentication response shape changed');
 const clubs=list(await read('users/getAllWhitelabels'));const club=Number(process.env.BHC_CONTRACT_CLUB_ID||(clubs.length===1?clubs[0].whitelabel_id:0));if(!club||!clubs.some(c=>Number(c.whitelabel_id)===club))throw new Error('Specify BHC_CONTRACT_CLUB_ID for one of this account’s clubs');
 const practices=list(await read('practices/getAthletePractices',{whitelabel_id:club,custid:auth.custid,upcoming:true}));
 for(const p of practices)if(!Number(p.practice_id)||!(Number(p.end_time)>Number(p.start_time)))throw new Error('Practice identifiers/times have unexpected shape');
 const boats=list(await read('equipment/getAllBoats',{whitelabel_id:club}));if(boats.some(b=>!Number(b.boat_id)))throw new Error('Boat identifiers have unexpected shape');
 if(practices.length){let d=await read('practices/getPractices',{whitelabel_id:club,custid:auth.custid,practice_id:practices[0].practice_id,meta_only:'No',upcoming:true});if(Array.isArray(d))d=d[0];if(!d||!Array.isArray(d.attendance))throw new Error('Practice detail shape changed');}
 console.log('BHC contract passed: authenticated lists and available practice details match expected structure. No records written. '+(practices.length?'':'No upcoming practice available to check details.'));
}catch(error){console.error(error.message);process.exitCode=1;}
