import test from 'node:test';
import assert from 'node:assert/strict';
import {SpotifyClient, consumeCallback, pkceChallenge} from '../dist/spotify.js';
test('PKCE uses SHA256 base64url',async()=>{
 assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('OAuth rejects state mismatch before exchanging a code',()=>{
 assert.throws(()=>consumeCallback('?code=secret&state=bad',{state:'good',verifier:'v',created:Date.now()}),/state/i);
});
test('OAuth rejects expired attempts and denied authorization',()=>{
 assert.throws(()=>consumeCallback('?code=c&state=s',{state:'s',verifier:'v',created:0}),/expired/i);
 assert.throws(()=>consumeCallback('?error=access_denied',null),/denied/i);
});
test('OAuth returns validated code and verifier',()=>{
 assert.deepEqual(consumeCallback('?code=c&state=s',{state:'s',verifier:'v',created:Date.now()}),{code:'c',verifier:'v'});
});
test('API rejects off-origin URLs without making a request',async()=>{
 let called=false;const client=new SpotifyClient({token:async()=> 't',fetchImpl:async()=>{called=true;}});
 await assert.rejects(client.api('https://evil.test'),/Spotify/);assert.equal(called,false);
});
test('API refreshes once after 401 and returns actual data',async()=>{
 let calls=0,refreshes=0;const client=new SpotifyClient({token:async(force)=>{if(force)refreshes++;return 't';},fetchImpl:async()=>++calls===1?new Response('',{status:401}):Response.json({name:'Listener'})});
 assert.equal((await client.api('/me')).name,'Listener');assert.equal(refreshes,1);assert.equal(calls,2);
});
test('API handles empty 204 and does not endlessly retry 401',async()=>{
 const ok=new SpotifyClient({token:async()=> 't',fetchImpl:async()=>new Response(null,{status:204})});assert.equal(await ok.api('/me/player'),null);
 let n=0;const bad=new SpotifyClient({token:async()=> 't',fetchImpl:async()=>{n++;return new Response('',{status:401});}});
 await assert.rejects(bad.api('/me'),/sign in/i);assert.equal(n,2);
});
test('API enforces Retry-After without immediately replaying',async()=>{
 let n=0;const client=new SpotifyClient({token:async()=> 't',fetchImpl:async()=>{n++;return new Response('{}',{status:429,headers:{'Retry-After':'60'}});}});
 await assert.rejects(client.api('/me'),/60/);await assert.rejects(client.api('/me'),/wait/i);assert.equal(n,1);
});

test('disconnect invalidates a pending token refresh instead of restoring login',async()=>{
 const store=()=>{const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
 globalThis.sessionStorage=store();globalThis.localStorage=store();
 const {SpotifyAuth}=await import('../dist/spotify.js');const auth=new SpotifyAuth();auth.clientId='c';auth.data={access_token:'expired',refresh_token:'r',expires_at:0};
 const original=globalThis.fetch;let finish;
 globalThis.fetch=()=>new Promise(resolve=>finish=resolve);
 try{const pending=auth.token();auth.clear();finish(Response.json({access_token:'late',refresh_token:'r',expires_in:3600}));await assert.rejects(pending,/cancelled|disconnect/i);assert.equal(auth.connected,false);assert.equal(sessionStorage.getItem('rewind.session'),null);}finally{globalThis.fetch=original;}
});

test('a stale playback poll cannot reverse an explicit device transfer',async()=>{
 const {SpotifyPlayback}=await import('../dist/spotify.js');let finish;
 const api={api:(path,options)=>!options?new Promise(resolve=>finish=resolve):Promise.resolve(null)};
 const p=new SpotifyPlayback(api,{});p.device='old';const pending=p.poll();await p.transfer('new');finish({device:{id:'old'},item:null});await pending;assert.equal(p.device,'new');
});

const memoryStore=()=>{const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}};
function authEnvironment(){
 const saved={sessionStorage:globalThis.sessionStorage,localStorage:globalThis.localStorage,location:globalThis.location,history:globalThis.history,fetch:globalThis.fetch};
 globalThis.sessionStorage=memoryStore();globalThis.localStorage=memoryStore();
 let destination='';globalThis.location={origin:'https://player.example.com',pathname:'/',search:'',assign:url=>destination=url};
 globalThis.history={replaceState:()=>{location.search='';}};
 return {destination:()=>destination,restore:()=>Object.assign(globalThis,saved)};
}
test('fresh public visitors have no shared app or legacy account data',async()=>{
 const env=authEnvironment();try{
  for(const store of [localStorage,sessionStorage])for(const key of ['rewind.session','rewind.pkce','rewind.clientId','rewind.source'])store.setItem(key,'legacy');
  const {SpotifyAuth}=await import('../dist/spotify.js');const auth=new SpotifyAuth();
  assert.equal(auth.clientId,'');assert.equal(auth.connected,false);
  for(const store of [localStorage,sessionStorage])for(const key of ['rewind.session','rewind.pkce','rewind.clientId','rewind.source'])assert.equal(store.getItem(key),null);
 }finally{env.restore();}
});
test('login uses only the visitors app with PKCE and explicit account consent',async()=>{
 const env=authEnvironment();try{
  const {SpotifyAuth}=await import('../dist/spotify.js');const auth=new SpotifyAuth(),clientId='a'.repeat(32);
  await auth.login(clientId);const url=new URL(env.destination()),attempt=JSON.parse(sessionStorage.getItem('rewind.public.pkce'));
  assert.equal(url.origin,'https://accounts.spotify.com');assert.equal(url.searchParams.get('redirect_uri'),auth.redirect);
  assert.equal(url.searchParams.get('client_id'),clientId);assert.equal(url.searchParams.get('state'),attempt.state);
  assert.equal(url.searchParams.get('code_challenge'),await pkceChallenge(attempt.verifier));assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('show_dialog'),'true');assert.equal(attempt.redirect,auth.redirect);
  assert.equal(sessionStorage.getItem('rewind.public.clientId'),clientId);assert.equal(localStorage.getItem('rewind.public.clientId'),null);
 }finally{env.restore();}
});
test('stored tokens restore only for the same app and redirect',async()=>{
 const env=authEnvironment();try{
  const {SpotifyAuth}=await import('../dist/spotify.js');sessionStorage.setItem('rewind.public.clientId','a'.repeat(32));
  sessionStorage.setItem('rewind.public.session',JSON.stringify({access_token:'private',clientId:'b'.repeat(32),redirect:location.origin+'/'}));
  assert.equal(new SpotifyAuth().connected,false);assert.equal(sessionStorage.getItem('rewind.public.session'),null);
  sessionStorage.setItem('rewind.public.session',JSON.stringify({access_token:'own',clientId:'a'.repeat(32),redirect:location.origin+'/'}));
  assert.equal(new SpotifyAuth().connected,true);
 }finally{env.restore();}
});
test('callback rejects a changed redirect before token exchange and removes the code',async()=>{
 const env=authEnvironment();try{
  const {SpotifyAuth}=await import('../dist/spotify.js');const auth=new SpotifyAuth();await auth.login('a'.repeat(32));
  const attempt=JSON.parse(sessionStorage.getItem('rewind.public.pkce'));attempt.redirect='https://other.example/';sessionStorage.setItem('rewind.public.pkce',JSON.stringify(attempt));
  location.search='?code=private&state='+attempt.state;let requests=0;globalThis.fetch=async()=>{requests++;};
  await assert.rejects(auth.callback(),/redirect|login/i);assert.equal(requests,0);assert.equal(location.search,'');
 }finally{env.restore();}
});
test('a valid callback stores tokens only in the tab and binds them to its app',async()=>{
 const env=authEnvironment();try{
  const {SpotifyAuth}=await import('../dist/spotify.js');const auth=new SpotifyAuth();await auth.login('a'.repeat(32));
  const attempt=JSON.parse(sessionStorage.getItem('rewind.public.pkce'));location.search='?code=one-use&state='+attempt.state;
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://accounts.spotify.com/api/token');assert.equal(options.body.get('client_id'),auth.clientId);assert.equal(options.body.get('code_verifier'),attempt.verifier);return Response.json({access_token:'access',refresh_token:'refresh',expires_in:3600});};
  await auth.callback();const stored=JSON.parse(sessionStorage.getItem('rewind.public.session'));
  assert.equal(auth.connected,true);assert.equal(stored.clientId,auth.clientId);assert.equal(stored.redirect,auth.redirect);
  assert.equal(stored.access_token,'access');assert.equal(localStorage.getItem('rewind.public.session'),null);assert.equal(location.search,'');assert.equal(sessionStorage.getItem('rewind.public.pkce'),null);
 }finally{env.restore();}
});

test('disconnect clears the app identifier, tokens, attempt and selected library',async()=>{
 const env=authEnvironment();try{
  const {SpotifyAuth}=await import('../dist/spotify.js');const auth=new SpotifyAuth();await auth.login('a'.repeat(32));
  auth.data={access_token:'private'};sessionStorage.setItem('rewind.public.session','private');sessionStorage.setItem('rewind.public.source','private playlist');auth.clear();
  assert.equal(auth.connected,false);assert.equal(auth.clientId,'');
  for(const key of ['session','pkce','clientId','source'])assert.equal(sessionStorage.getItem('rewind.public.'+key),null);
 }finally{env.restore();}
});

test('the default transport calls browser fetch with Window as its receiver',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=function(url,options){
  if(this!==globalThis)throw new TypeError("'fetch' called on an object that does not implement interface Window.");
  assert.equal(options.headers.Authorization,'Bearer regression-test');
  return Promise.resolve(Response.json({display_name:'Connected user'}));
 };
 try{const client=new SpotifyClient({token:async()=> 'regression-test'});assert.equal((await client.api('/me')).display_name,'Connected user');}finally{globalThis.fetch=original;}
});

function fakeSDK(){
 const instances=[];
 class Player{
  constructor(){this.listeners=new Map();this.calls=[];instances.push(this);}
  addListener(n,fn){this.listeners.set(n,fn);}
  emit(n,data){this.listeners.get(n)?.(data);}
  async connect(){return true;}
  disconnect(){this.disconnected=true;}
  async pause(){this.calls.push('pause');}
  async resume(){this.calls.push('resume');}
  async nextTrack(){this.calls.push('next');}
  async previousTrack(){this.calls.push('previous');}
  async seek(ms){this.calls.push(['seek',ms]);}
  activateElement(){return Promise.resolve();}
 }
 return {Player,instances};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('SDK initialization waits for ready rather than connect resolution',async()=>{
 const {SpotifyPlayback}=await import('../dist/spotify.js');const sdk=fakeSDK(),oldWindow=globalThis.window,oldSDK=globalThis.Spotify;
 globalThis.window={Spotify:sdk};globalThis.Spotify=sdk;
 try{const p=new SpotifyPlayback({api:async()=>null},{connected:true});let ready=false;const pending=p.init().then(()=>ready=true);await tick();assert.equal(ready,false);sdk.instances[0].emit('ready',{device_id:'browser'});await pending;assert.equal(p.browserDevice,'browser');p.disconnect();}finally{globalThis.window=oldWindow;globalThis.Spotify=oldSDK;}
});
test('local transport uses the SDK without round trips through the Web API',async()=>{
 const {SpotifyPlayback}=await import('../dist/spotify.js');const sdk=fakeSDK();let requests=0;const p=new SpotifyPlayback({api:async()=>requests++},{});p.player=new sdk.Player();p.device=p.browserDevice='browser';
 await p.command('pause');await p.play();await p.command('next');await p.command('previous');await p.command('seek',{position_ms:12345});
 assert.deepEqual(p.player.calls,['pause','resume','next','previous',['seek',12345]]);assert.equal(requests,0);
});
test('a playback command invalidates an older in-flight poll',async()=>{
 const {SpotifyPlayback}=await import('../dist/spotify.js');let finish;const p=new SpotifyPlayback({api:(path,options)=>options?Promise.resolve():new Promise(resolve=>finish=resolve)},{});p.device='remote';let states=0;p.addEventListener('state',()=>states++);
 const polling=p.poll();await p.command('pause');finish({is_playing:true,device:{id:'remote'}});await polling;assert.equal(states,0);
});
test('SDK initialization failure clears the failed player and permits retry',async()=>{
 const {SpotifyPlayback}=await import('../dist/spotify.js');const sdk=fakeSDK(),oldWindow=globalThis.window,oldSDK=globalThis.Spotify;globalThis.window={Spotify:sdk};globalThis.Spotify=sdk;
 try{const p=new SpotifyPlayback({api:async()=>null},{connected:true});const pending=p.init();const rejected=assert.rejects(pending,/protected content|DRM|initialize/i);await tick();sdk.instances[0].emit('initialization_error',{message:'Failed to initialize player'});await rejected;assert.equal(p.player,null);assert.equal(sdk.instances[0].disconnected,true);const retry=p.init();await tick();assert.equal(sdk.instances.length,2);sdk.instances[1].emit('ready',{device_id:'retry'});await retry;p.disconnect();}finally{globalThis.window=oldWindow;globalThis.Spotify=oldSDK;}
});

test('polling during a pending transfer cannot restore the previous device',async()=>{
 const {SpotifyPlayback}=await import('../dist/spotify.js');let finishTransfer,finishPoll,pollRequests=0;
 const p=new SpotifyPlayback({api:(path,options)=>options?new Promise(resolve=>finishTransfer=resolve):(pollRequests++,new Promise(resolve=>finishPoll=resolve))},{});p.device='old';
 const transfer=p.transfer('new');await tick();const polling=p.poll();finishTransfer();await transfer;finishPoll?.({device:{id:'old'}});await polling;assert.equal(p.device,'new');assert.equal(pollRequests,0);
});
test('late events from a failed SDK instance cannot damage a successful retry',async()=>{
 const {SpotifyPlayback}=await import('../dist/spotify.js');const sdk=fakeSDK(),oldWindow=globalThis.window;globalThis.window={Spotify:sdk};
 try{const p=new SpotifyPlayback({api:async()=>null},{connected:true});const first=p.init(),rejected=assert.rejects(first);await tick();sdk.instances[0].emit('initialization_error',{message:'failed'});await rejected;const second=p.init();await tick();sdk.instances[1].emit('ready',{device_id:'new'});await second;sdk.instances[0].emit('not_ready',{device_id:'old'});assert.equal(p.browserDevice,'new');assert.equal(p.player,sdk.instances[1]);p.disconnect();}finally{globalThis.window=oldWindow;}
});
test('a transfer response after disconnect cannot restore a playback device',async()=>{
 const {SpotifyPlayback}=await import('../dist/spotify.js');let finish;const p=new SpotifyPlayback({api:()=>new Promise(resolve=>finish=resolve)},{});p.device='old';const pending=p.transfer('remote');await tick();p.disconnect();finish();await pending;assert.equal(p.device,null);
});
test('observed Spotify mode changes invalidate cached mode writes',async()=>{
 const {SpotifyPlayback}=await import('../dist/spotify.js');let writes=0;const p=new SpotifyPlayback({api:async(path,options)=>{if(options)writes++;else return{device:{id:'remote'},shuffle_state:true};}},{});p.device='remote';await p.command('shuffle',{state:'false'});await p.poll();await p.command('shuffle',{state:'false'});assert.equal(writes,2);
});
test('an inactive local SDK falls back to the active Spotify device',async()=>{
 const {SpotifyPlayback}=await import('../dist/spotify.js');let requests=0;const p=new SpotifyPlayback({api:async()=>{requests++;return {device:{id:'phone'},is_playing:true};}},{});p.player={getCurrentState:async()=>null};p.browserDevice=p.device='browser';await p.poll();assert.equal(p.device,'phone');assert.equal(requests,1);
});
test('disconnect releases the control queue for a new session',async()=>{
 const {SpotifyPlayback}=await import('../dist/spotify.js');let finishOld;const calls=[];const p=new SpotifyPlayback({api:(path)=>{calls.push(path);return calls.length===1?new Promise(resolve=>finishOld=resolve):Promise.resolve();}},{});p.device='old';const old=p.transfer('old');await tick();p.disconnect();p.device='new';const fresh=p.command('pause');await tick();try{assert.ok(calls.some(path=>path.includes('/pause')));}finally{finishOld();await Promise.allSettled([old,fresh]);}
});
