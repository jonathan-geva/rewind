export function normalizeTrack(value) {
 const t=value?.item??value?.track??value;
 if(!t?.id||!t.uri||t.type==='episode'||t.is_local||t.is_playable===false)return null;
 return {...t,name:t.name||'Untitled',artists:t.artists||[],album:t.album||{id:'unknown',name:'Unknown album',images:[]}};
}
export function buildLibrary(items) {
 const seen=new Set(), tracks=[];
 for(const value of items){const t=normalizeTrack(value);if(t&&!seen.has(t.uri)){seen.add(t.uri);tracks.push(t);}}
 const artists=new Map(),albums=new Map();
 for(const t of tracks){
  for(const a of t.artists){const key=a.id||a.name;if(!artists.has(key))artists.set(key,{...a,tracks:[]});artists.get(key).tracks.push(t);}
  const key=t.album.id||`${t.album.name}:${t.artists[0]?.id}`;
  if(!albums.has(key))albums.set(key,{...t.album,artists:t.artists,tracks:[]});albums.get(key).tracks.push(t);
 }
 const sort=(a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'});
 return {tracks,artists:[...artists.values()].sort(sort),albums:[...albums.values()].sort(sort)};
}
export function spotifyPath(input) {
 const u=new URL(input,'https://api.spotify.com/v1/');
 if(u.origin!=='https://api.spotify.com'||!u.pathname.startsWith('/v1/')||u.username||u.password)throw new Error('Only Spotify API URLs are allowed.');
 return u.href;
}
export async function pageAll(client,path,onProgress=()=>{}) {
 const items=[],seen=new Set();let next=path;
 while(next){
  let url;try{url=spotifyPath(next.startsWith('/')&&!next.startsWith('/v1/')?'/v1'+next:next);}catch{throw new Error('Invalid Spotify pagination link.');}
  if(seen.has(url))throw new Error('Spotify returned a repeated pagination page.');seen.add(url);
  const page=await client.api(url);items.push(...(page?.items||[]));onProgress(items.length,page?.total);
  next=page?.next||null;
 }
 return items;
}
export function parsePlaylistInput(value) {
 const s=value.trim();let id=s;
 if(s.startsWith('spotify:playlist:'))id=s.slice(17);
 else if(s.startsWith('https://')){const u=new URL(s);if(u.hostname!=='open.spotify.com'||!/^\/playlist\/[a-zA-Z0-9]{22}\/?$/.test(u.pathname))throw new Error('Paste a Spotify playlist link or URI.');id=u.pathname.split('/')[2];}
 if(!/^[a-zA-Z0-9]{22}$/.test(id))throw new Error('Paste a Spotify playlist link or URI.');return id;
}
export function playbackWindow(tracks,index) {
 const start=Math.max(0,Math.min(index-20,tracks.length-100));
 return {uris:tracks.slice(start,start+100).map(t=>t.uri),offset:{position:index-start}};
}
export const time=ms=>`${Math.floor(Math.max(0,ms)/60000)}:${String(Math.floor(Math.max(0,ms)/1000)%60).padStart(2,'0')}`;
export const artistNames=t=>(t?.artists||[]).map(a=>a.name).join(', ');
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeImage(url){try{const u=new URL(url);return u.protocol==='https:'&&(/(^|\.)(scdn\.co|spotifycdn\.com|spotifycdn\.net)$/.test(u.hostname))?u.href:'';}catch{return '';}}
export function safeSpotifyLink(url){try{const u=new URL(url);return u.origin==='https://open.spotify.com'?u.href:'';}catch{return '';}}

// Spotify accepts bounded URI batches. Keep the complete order and replenish
// the native queue near each boundary instead of silently truncating the library.
export class QueuePlanner {
 constructor(tracks,index=0,shuffle=false,random=Math.random){
  this.source=tracks;this.order=[...tracks];this.cursor=index;
  if(shuffle){const selected=this.order.splice(index,1)[0];for(let i=this.order.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[this.order[i],this.order[j]]=[this.order[j],this.order[i]];}this.order.unshift(selected);this.cursor=0;}
  this.until=Math.min(this.order.length,this.cursor+100);
 }
 initial(){return{uris:this.order.slice(this.cursor,this.until).map(t=>t.uri)};}
 nextBatch(uri,repeat=false){
  const n=this.order.length,index=this.order.findIndex(t=>t.uri===uri);if(index<0||!n)return[];
  let cursor=Math.floor(this.cursor/n)*n+index;if(cursor<this.cursor)cursor+=n;this.cursor=cursor;
  if(this.until-cursor>4)return[];
  const end=repeat?this.until+10:Math.min(n,this.until+10);
  return Array.from({length:Math.max(0,end-this.until)},(_,i)=>this.order[(this.until+i)%n]);
 }
 commit(){this.until++;}
 previous(uri){const i=this.order.findIndex(t=>t.uri===uri);return i>0?this.order[i-1]:null;}
}

export function menuWindow(length,selected,start=0,capacity=5){
 const size=Math.min(length,capacity),last=Math.max(0,length-size);
 start=Math.max(0,Math.min(start,last));
 if(selected<start)start=selected;
 if(selected>=start+size)start=selected-size+1;
 start=Math.max(0,Math.min(start,last));return{start,end:start+size};
}

// User intent remains authoritative while asynchronous SDK confirmations catch up.
export class PlaybackIntent {
 constructor(clock=Date.now){this.clock=clock;this.version=0;this.confirmed=false;this.target=null;this.deadline=Infinity;}
 get pending(){return this.target!==null;}
 toggle(observed){if(this.target===null)this.confirmed=observed;this.target=!(this.target??observed);this.deadline=Infinity;return{version:++this.version,playing:this.target};}
 settle(version){if(version===this.version)this.deadline=this.clock()+2000;}
 cancel(version){if(version!==this.version)return false;this.target=null;return true;}
 reset(){this.version++;this.target=null;}
 resolve(observed){this.confirmed=observed;if(this.target===null)return observed;if(this.deadline!==Infinity&&(observed===this.target||this.clock()>this.deadline)){this.target=null;return observed;}return this.target;}
}
