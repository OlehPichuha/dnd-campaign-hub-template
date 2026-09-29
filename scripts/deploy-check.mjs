import { readFileSync } from 'node:fs';
const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const errors=[];
if(!/^[a-z0-9][a-z0-9-]*$/.test(config.name)||config.name.startsWith('replace-'))errors.push('Choose your own unique Worker name in wrangler.jsonc.');
if(config.routes?.length)errors.push('Do not attach the new portal to an existing website route.');
if(config.vars?.DEV_AUTH)errors.push('DEV_AUTH must never be deployed.');
if(!config.vars?.FIREBASE_PROJECT_ID||config.vars.FIREBASE_PROJECT_ID.startsWith('replace-'))errors.push('Configure your own Firebase project ID before deployment.');
let clientEnv='';
try{clientEnv=readFileSync(new URL('../.env.production.local',import.meta.url),'utf8');}catch{errors.push('Create .env.production.local with the Firebase web configuration.');}
for(const key of ['VITE_FIREBASE_API_KEY','VITE_FIREBASE_AUTH_DOMAIN','VITE_FIREBASE_PROJECT_ID','VITE_FIREBASE_APP_ID'])if(!new RegExp(`^${key}=.+$`,'m').test(clientEnv))errors.push(`Missing ${key} in .env.production.local.`);
if(clientEnv.match(/^VITE_FIREBASE_PROJECT_ID=(.+)$/m)?.[1]!==config.vars?.FIREBASE_PROJECT_ID)errors.push('Firebase project IDs differ between browser and Worker.');
if(!config.d1_databases?.[0]?.database_id||config.d1_databases[0].database_id==='00000000-0000-0000-0000-000000000000')errors.push('Create your own D1 database and set its ID.');
if(config.assets?.run_worker_first!==true)errors.push('Authentication checks must run before serving protected assets.');
if(config.preview_urls!==false)errors.push('Unprotected preview URLs must stay disabled.');
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log('Deployment configuration passed. Ensure OWNER_EMAIL is set as a Cloudflare secret and Firebase web config is present for the build.');
