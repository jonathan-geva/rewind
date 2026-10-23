import {spotifyPath} from './core.js';
export const SCOPES=['streaming','user-read-email','user-read-private','user-library-read','user-library-modify','playlist-read-private','playlist-read-collaborative','user-read-playback-state','user-modify-playback-state','user-read-currently-playing'];
export async function pkceChallenge(verifier) {
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
 return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function consumeCallback(search,attempt){
 const p=new URLSearchParams(search);
 if(p.has('error'))throw new Error(p.get('error')==='access_denied'?'Spotify authorization was denied. You can connect again.':'Spotify sign-in failed: '+p.get('error'));
 if(!p.has('code'))return null;
 if(!attempt?.state||p.get('state')!==attempt.state)throw new Error('Spotify login state did not match. Please sign in again in this tab.');
 if(!attempt.created||Date.now()-attempt.created>600000||attempt.created>Date.now()+30000)throw new Error('This login attempt expired. Please connect again.');
 return {code:p.get('code'),verifier:attempt.verifier};
}
export const SESSION_KEYS=Object.freeze(Object.fromEntries(['session','pkce','clientId','source'].map(key=>[key,'rewind.public.'+key])));
const validClientId=value=>typeof value==='string'&&/^[a-fA-F0-9]{32}$/.test(value);
const read=(store,key)=>{try{return JSON.parse(store.getItem(key));}catch{return null;}};
export class SpotifyAuth {
 constructor(){
  // Retire account data from pre-public builds without adopting it into this session.
  for(const storage of [localStorage,sessionStorage])for(const key of ['session','pkce','clientId','source'])storage.removeItem('rewind.'+key);
  this.clientId=sessionStorage.getItem(SESSION_KEYS.clientId)||'';
  if(!validClientId(this.clientId)){this.clientId='';sessionStorage.removeItem(SESSION_KEYS.clientId);}
  this.data=read(sessionStorage,SESSION_KEYS.session);this.refreshing=null;this.generation=0;
  if(this.data&&(!this.clientId||this.data.clientId!==this.clientId||this.data.redirect!==this.redirect)){this.data=null;sessionStorage.removeItem(SESSION_KEYS.session);}
 }
 get connected(){return !!this.data?.access_token;}
 get redirect(){return location.origin+location.pathname;}
 async login(clientId){
  if(!validClientId(clientId))throw new Error('Enter the 32-character Client ID from your Spotify app.');
  this.clear();this.clientId=clientId;sessionStorage.setItem(SESSION_KEYS.clientId,clientId);
  const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
  const verifier=random(),state=random();
  sessionStorage.setItem(SESSION_KEYS.pkce,JSON.stringify({verifier,state,created:Date.now(),clientId,redirect:this.redirect}));
  const q=new URLSearchParams({client_id:clientId,response_type:'code',show_dialog:'true',redirect_uri:this.redirect,scope:SCOPES.join(' '),state,code_challenge_method:'S256',code_challenge:await pkceChallenge(verifier)});
  location.assign('https://accounts.spotify.com/authorize?'+q);
 }
 async callback(){
  const params=new URLSearchParams(location.search);if(!params.has('code')&&!params.has('error'))return;
  const attempt=read(sessionStorage,SESSION_KEYS.pkce);sessionStorage.removeItem(SESSION_KEYS.pkce);
  const query=location.search;history.replaceState({},'',location.pathname);
  const valid=consumeCallback(query,attempt);if(!valid)return;
  if(!validClientId(attempt.clientId)||attempt.clientId!==this.clientId||attempt.redirect!==this.redirect)throw new Error('Spotify login app or redirect changed. Please connect again.');
  this.clientId=attempt.clientId;
  await this.exchange({grant_type:'authorization_code',code:valid.code,redirect_uri:this.redirect,code_verifier:valid.verifier});
 }
 async exchange(fields){
  const generation=this.generation;
  const res=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:this.clientId,...fields})});
  const data=await res.json();if(generation!==this.generation)throw new Error('Spotify login was cancelled by disconnect.');if(!res.ok)throw new Error('Spotify sign-in expired or failed. Connect again.');
  this.data={...data,clientId:this.clientId,redirect:this.redirect,refresh_token:data.refresh_token||this.data?.refresh_token,expires_at:Date.now()+data.expires_in*1000};
  sessionStorage.setItem(SESSION_KEYS.session,JSON.stringify(this.data));return this.data.access_token;
 }
 async token(force=false){
  if(!this.data)throw new Error('Connect Spotify to continue.');
  if(!force&&Date.now()<this.data.expires_at-60000)return this.data.access_token;
  if(!this.data.refresh_token)throw new Error('Please sign in to Spotify again.');
  if(!this.refreshing){const generation=this.generation;const pending=this.exchange({grant_type:'refresh_token',refresh_token:this.data.refresh_token}).catch(e=>{if(generation===this.generation)this.clear();throw e;}).finally(()=>{if(this.refreshing===pending)this.refreshing=null;});this.refreshing=pending;}
  return this.refreshing;
 }
 clear(){this.generation++;this.refreshing=null;this.data=null;this.clientId='';for(const key of Object.values(SESSION_KEYS))sessionStorage.removeItem(key);}
}
export class SpotifyClient {
 constructor({token,fetchImpl=(...args)=>globalThis.fetch(...args)}){this.token=token;this.fetch=fetchImpl;this.blockedUntil=0;}
 async api(path,options={},retried=false){
  const url=spotifyPath(path.startsWith('/')&&!path.startsWith('/v1/')?'/v1'+path:path);
  if(Date.now()<this.blockedUntil)throw new Error(`Spotify rate limit. Please wait ${Math.ceil((this.blockedUntil-Date.now())/1000)} seconds.`);
  const token=await this.token(retried);
  const res=await this.fetch(url,{...options,headers:{'Content-Type':'application/json',...options.headers,Authorization:'Bearer '+token}});
  if(res.status===401&&!retried)return this.api(path,options,true);
  if(res.status===204)return null;
  const data=await res.json().catch(()=>null);
  if(res.status===429){const wait=Math.max(1,Number(res.headers.get('Retry-After'))||60);this.blockedUntil=Date.now()+wait*1000;throw new Error(`Spotify limit reached. Please wait ${wait} seconds before retrying.`);}
  if(res.status===401)throw new Error('Spotify session expired. Please sign in again.');
  if(res.status===403)throw new Error('Spotify denied this action. Check Premium, your app’s user allowlist, and playlist ownership.');
  if(!res.ok)throw new Error(data?.error?.message||`Spotify request failed (${res.status}). Please try again.`);
  return data;
 }
}
export class SpotifyPlayback extends EventTarget {
 constructor(client,auth){super();this.api=client;this.auth=auth;this.player=null;this.browserDevice=null;this.device=null;this.connecting=null;this.generation=0;this.controlGeneration=0;this.controls=Promise.resolve();this.pendingControls=0;this.modes=new Map();this.cancelConnect=null;}
 emit(type,detail){this.dispatchEvent(new CustomEvent(type,{detail}));}
 init(){
  if(this.browserDevice&&this.player)return Promise.resolve(this.browserDevice);
  if(this.connecting)return this.connecting;
  const pending=this.createPlayer().finally(()=>{if(this.connecting===pending)this.connecting=null;});this.connecting=pending;return pending;
 }
 async createPlayer(){
  const generation=this.generation;
  if(!window.Spotify){await new Promise((resolve,reject)=>{
   let settled=false;const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
   const timer=setTimeout(()=>finish(new Error('Spotify player could not load. Check protected content/DRM or choose another Spotify device.')),20000);
   window.onSpotifyWebPlaybackSDKReady=()=>finish();
   document.getElementById('spotify-sdk')?.remove();
   const script=document.createElement('script');script.id='spotify-sdk';script.src='https://sdk.scdn.co/spotify-player.js';script.onerror=()=>finish(new Error('Could not load Spotify. Check your connection or choose another output device.'));document.head.append(script);
  });}
  if(generation!==this.generation||!this.auth.connected)throw new Error('Spotify connection cancelled.');
  const instance=new window.Spotify.Player({name:'Rewind · iPod',volume:0.5,getOAuthToken:cb=>this.auth.token().then(cb).catch(e=>this.emit('error',e))});
  this.player=instance;
  return new Promise((resolve,reject)=>{
   let settled=false;
   const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);this.cancelConnect=null;if(error){instance.disconnect();if(this.player===instance)this.player=null;if(this.device===this.browserDevice)this.device=null;this.browserDevice=null;reject(error);}else resolve(this.browserDevice);};
   const timer=setTimeout(()=>finish(new Error('Spotify is taking too long to connect. Retry or choose another output device.')),20000);
   this.cancelConnect=()=>finish(new Error('Spotify connection cancelled.'));
   for(const event of ['initialization_error','authentication_error','account_error'])instance.addListener(event,({message})=>{if(generation!==this.generation||this.player!==instance)return;const error=new Error(event==='initialization_error'?'Browser playback could not initialize. Enable protected content/DRM, or choose a Spotify output device.':message);if(!settled)finish(error);else this.emit('error',error);});
   instance.addListener('playback_error',({message})=>{if(generation===this.generation&&this.player===instance)this.emit('error',new Error(message));});
   instance.addListener('autoplay_failed',()=>{if(generation===this.generation&&this.player===instance)this.emit('error',new Error('Press Play once more to allow browser audio.'));});
   instance.addListener('ready',({device_id})=>{if(generation!==this.generation||this.player!==instance)return;this.browserDevice=device_id;if(!this.device)this.device=device_id;finish();this.emit('ready',device_id);});
   instance.addListener('not_ready',({device_id})=>{if(generation!==this.generation||this.player!==instance)return;if(this.device===device_id)this.device=null;this.browserDevice=null;instance.disconnect();if(this.player===instance)this.player=null;this.modes.delete(device_id);if(!settled)finish(new Error('Spotify went offline. Retry playback.'));else this.emit('error',new Error('Spotify went offline. Press Play to reconnect or choose another device.'));});
   instance.addListener('player_state_changed',state=>{if(generation!==this.generation||this.player!==instance||!state||this.device!==this.browserDevice)return;const result={item:state.track_window.current_track,is_playing:!state.paused,progress_ms:state.position,duration_ms:state.duration,shuffle_state:state.shuffle,repeat_state:['off','context','track'][state.repeat_mode]};this.rememberModes(result);this.emit('state',result);});
   Promise.resolve(instance.connect()).then(connected=>{if(!connected)finish(new Error('Spotify could not connect this browser. Check protected content/DRM or choose another device.'));},finish);
  });
 }
 activate(){try{this.player?.activateElement()?.catch(()=>{});}catch{}}
 get local(){return !!this.player&&!!this.browserDevice&&this.device===this.browserDevice;}
 async ensureDevice(){if(!this.device)await this.init();if(!this.device)throw new Error('Choose an available Spotify output device.');}
 mutate(run){const generation=this.generation;this.controlGeneration++;this.pendingControls++;const result=this.controls.then(()=>{if(generation!==this.generation)throw new Error('Playback cancelled.');return run();}).finally(()=>{if(generation===this.generation){this.pendingControls--;this.controlGeneration++;}});this.controls=result.catch(()=>{});return result;}
 query(extra={}){if(!this.device)throw new Error('Choose an available Spotify output device.');return '?'+new URLSearchParams({device_id:this.device,...extra});}
 play(body){this.activate();return this.mutate(async()=>{await this.ensureDevice();if(!body&&this.local)return this.player.resume();return this.api.api('/me/player/play'+this.query(),{method:'PUT',body:JSON.stringify(body||{})});});}
 command(name,extra={}){const session=this.generation;this.activate();return this.mutate(async()=>{
  await this.ensureDevice();
  const local={pause:()=>this.player.pause(),next:()=>this.player.nextTrack(),previous:()=>this.player.previousTrack(),seek:()=>this.player.seek(Number(extra.position_ms))};
  if(this.local&&local[name])return local[name]();
  const modeKey=name+':'+this.device;
  if(['shuffle','repeat'].includes(name)&&this.modes.get(modeKey)===extra.state)return;
  const method=['next','previous','queue'].includes(name)?'POST':'PUT';await this.api.api('/me/player/'+name+this.query(extra),{method});
  if(['shuffle','repeat'].includes(name)&&this.device&&session===this.generation)this.modes.set(modeKey,extra.state);
 });}
 volume(value){return this.mutate(async()=>{await this.ensureDevice();if(this.local)return this.player.setVolume(value);return this.api.api('/me/player/volume'+this.query({volume_percent:Math.round(value*100)}),{method:'PUT'});});}
 transfer(id){const session=this.generation;return this.mutate(async()=>{await this.api.api('/me/player',{method:'PUT',body:JSON.stringify({device_ids:[id],play:false})});if(session!==this.generation)return;this.device=id;this.modes.clear();this.emit('device',id);});}
 rememberModes(state){if(!this.device)return;if(state.shuffle_state!==undefined)this.modes.set('shuffle:'+this.device,String(state.shuffle_state));if(state.repeat_state!==undefined)this.modes.set('repeat:'+this.device,state.repeat_state);}
 async poll(){if(this.pendingControls)return null;const generation=this.controlGeneration,session=this.generation;
  if(this.local){const instance=this.player,device=this.device,state=await instance.getCurrentState?.();if(generation!==this.controlGeneration||session!==this.generation||this.player!==instance||this.device!==device)return null;if(state){const result={item:state.track_window.current_track,is_playing:!state.paused,progress_ms:state.position,duration_ms:state.duration,shuffle_state:state.shuffle,repeat_state:['off','context','track'][state.repeat_mode]};this.rememberModes(result);this.emit('state',result);return result;}}
  const state=await this.api.api('/me/player');if(generation!==this.controlGeneration||session!==this.generation)return null;if(state){this.device=state.device?.id||this.device;this.rememberModes(state);this.emit('state',state);}return state;
 }
 disconnect(){this.generation++;this.controlGeneration++;this.controls=Promise.resolve();this.pendingControls=0;this.cancelConnect?.();this.player?.disconnect();this.player=null;this.device=null;this.browserDevice=null;this.connecting=null;this.modes.clear();}
}
