import {buildLibrary,normalizeTrack,pageAll,parsePlaylistInput,QueuePlanner,time,artistNames,esc,safeImage,safeSpotifyLink,menuWindow,PlaybackIntent} from './core.js';
import {SpotifyAuth,SpotifyClient,SpotifyPlayback,SESSION_KEYS} from './spotify.js';
import {WheelClick} from './sound.js';
import {PlayerWindow} from './popout.js';
const appRoot=document.querySelector('#app-root');
let viewDocument=document,viewWindow=window;
const $=s=>appRoot.querySelector(s);
const clicker=new WheelClick(),playIntent=new PlaybackIntent();
const icon=name=>`<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const demoRows=[
 ['Dreams','Fleetwood Mac','Rumours',257800],['Everywhere','Fleetwood Mac','Tango in the Night',226000],['The Chain','Fleetwood Mac','Rumours',269000],
 ['Everybody Wants to Rule the World','Tears for Fears','Songs from the Big Chair',251000],['Head Over Heels','Tears for Fears','Songs from the Big Chair',256000],
 ['This Must Be the Place','Talking Heads','Speaking in Tongues',296000],['Once in a Lifetime','Talking Heads','Remain in Light',259000],
 ['Space Oddity','David Bowie','David Bowie',319000],['Heroes','David Bowie','Heroes',370000],
 ['Pink + White','Frank Ocean','Blonde',184000],['Ivy','Frank Ocean','Blonde',249000],
 ['Breathe (In the Air)','Pink Floyd','The Dark Side of the Moon',163000],['Wish You Were Here','Pink Floyd','Wish You Were Here',334000],
 ['Let It Happen','Tame Impala','Currents',467000],['The Less I Know the Better','Tame Impala','Currents',216000],['Friday I’m in Love','The Cure','Wish',215000]
];
const sample=()=>buildLibrary(demoRows.map((r,i)=>({id:'sample'+i,uri:'spotify:track:sample'+i,type:'track',name:r[0],artists:[{id:r[1],name:r[1]}],album:{id:r[2],name:r[2],images:[]},duration_ms:r[3]})));
const preference=(key,fallback)=>localStorage.getItem('rewind.'+key)??fallback;
const auth=new SpotifyAuth(),api=new SpotifyClient({token:force=>auth.token(force)}),player=new SpotifyPlayback(api,auth);
const state={library:auth.connected?buildLibrary([]):sample(),source:{id:auth.connected?'liked':'preview',name:auth.connected?'Liked Songs':'Sample collection'},current:null,playing:false,progress:0,duration:0,updated:Date.now(),shuffle:false,repeat:'off',volume:50,held:false,sound:preference('sound','on')==='on',backlight:preference('backlight','on')==='on',finish:preference('finish','ivory'),menu:null,history:[],pending:null,playlists:null,sourceGeneration:0,searchGeneration:0,mode:'volume',liked:false};
let toastTimer,searchTimer,volumeDisplayUntil=0,polling=false,lastError='',menuLongTimer,menuWasLong=false,sequence=null,refilling=false,playGeneration=0;
$('#device').dataset.finish='ivory';
$('#screen').classList.toggle('backlight-off',!state.backlight);
function toast(message,error=false){const el=$('#toast');el.textContent=message;el.classList.toggle('error',error);el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,error?9000:4500);}
function report(error){const message=error?.message||String(error);if(message===lastError)return;lastError=message;setTimeout(()=>lastError='',5000);toast(message,true);}
async function act(fn){try{return await fn();}catch(e){report(e);}}
function clickSound(){if(state.sound)clicker.play(viewWindow);}
function unlocked(){if(state.held){toast('HOLD is on. Slide the switch at the top to unlock.');return false;}return true;}
function live(){if(auth.connected)return true;act(connectSpotify);return false;}
async function connectSpotify(){if(auth.connected){openSettings();return;}openSetup();}
function openDialog(id){appRoot.querySelectorAll('dialog[open]').forEach(d=>d.close());$(id).showModal();}
function openSetup(){ $('#client-id').value=auth.clientId;$('#redirect-uri').textContent=auth.redirect;$('#setup-error').textContent='';$('#setup-instructions').open=!auth.clientId;openDialog('#setup-dialog');}
function entry(label,run,meta='',arrow=true){return{label,run,meta,arrow};}
function root(){state.history=[];state.menu={type:'list',title:'iPod',selected:0,rows:[entry('Music',musicMenu),entry('Settings',openSettings),entry('Shuffle Songs',shuffleSongs),entry('Backlight',toggleBacklight),entry('Search Spotify',openSearch),...(state.current?[entry('Now Playing',openNow)]:[])]};renderScreen();}
function musicMenu(){push({title:'Music',rows:[entry('Playlists',openPlaylists),entry('Artists',()=>libraryMenu('artists')),entry('Albums',()=>libraryMenu('albums')),entry('Songs',()=>libraryMenu('tracks'))]});}
async function shuffleSongs(){if(!state.library.tracks.length)return;state.shuffle=true;await playTrack(state.library.tracks[Math.floor(Math.random()*state.library.tracks.length)],state.library.tracks);}
function toggleBacklight(){state.backlight=!state.backlight;localStorage.setItem('rewind.backlight',state.backlight?'on':'off');$('#screen').classList.toggle('backlight-off',!state.backlight);clickSound();}
function push(menu){if(state.menu)state.history.push(state.menu);state.menu={selected:0,type:'list',...menu};renderScreen();}
function back(){if(!unlocked())return;state.searchGeneration++;if(state.history.length){state.menu=state.history.pop();renderScreen();}else root();clickSound();}
function menuFooter(){if(state.pending)return state.pending;if(!auth.connected)return 'SAMPLE LIBRARY · NO AUDIO';if(state.menu.type==='now')return state.playing?'PLAYING · SPOTIFY':'PAUSED · SPOTIFY';if(state.menu.type==='search')return state.menu.loading?'SEARCHING…':'SPOTIFY / '+(state.menu.total??0)+' RESULTS';return `${state.menu.rows?.length||0} ITEMS · ${state.source.name}`;}
function renderScreen(){
 const m=state.menu;if(!m)return;
 const focused=viewDocument.activeElement?.id==='lcd-query',caret=focused?viewDocument.activeElement.selectionStart:null;
 $('#screen').dataset.view=m.type;$('#lcd-title').textContent=m.title;$('#lcd-playing').textContent=state.current?(state.playing?'▶':'Ⅱ'):'';$('#lcd-lock').textContent=state.held?'▣':'';$('#lcd-footer').textContent=menuFooter();
 if(state.pending){$('#lcd-body').innerHTML=`<div class="lcd-empty">${esc(state.pending)}<small>Your collection is on its way.</small></div>`;return;}
 if(m.type==='now'){renderNowLCD();return;}
 if(m.type==='search'){
  $('#lcd-body').innerHTML=`<form class="lcd-search" id="lcd-search-form"><input id="lcd-query" aria-label="Search Spotify" placeholder="Song, artist, album…" value="${esc(m.query||'')}" autocomplete="off"><button aria-label="Run search">Go</button></form><div class="lcd-search-tabs">${['track','artist','album'].map(t=>`<button data-search-type="${t}" class="${m.searchType===t?'active':''}">${t==='track'?'Songs':t==='artist'?'Artists':'Albums'}</button>`).join('')}</div><div class="search-results">${rowsHTML(m)}</div>`;
  if(focused){$('#lcd-query').focus();$('#lcd-query').setSelectionRange(caret,caret);}
 }else $('#lcd-body').innerHTML=rowsHTML(m);
 const selected=$('#lcd-body .lcd-row.active');selected?.scrollIntoView({block:'nearest'});
}
function rowsHTML(m){
 if(!m.rows?.length)return `<div class="lcd-empty"><small>${esc(m.empty||'Nothing here yet.')}</small></div>`;
 const capacity=m.type==='search'?3:5,range=menuWindow(m.rows.length,m.selected,m.start||0,capacity);m.start=range.start;
 return `<div class="menu-list" role="listbox" aria-label="${esc(m.title)}">${m.rows.slice(range.start,range.end).map((r,n)=>{const i=n+range.start;return `<button type="button" role="option" aria-selected="${i===m.selected}" aria-posinset="${i+1}" aria-setsize="${m.rows.length}" class="lcd-row ${i===m.selected?'active':''}" data-row="${i}" aria-label="${esc(r.label+(r.meta?' · '+r.meta:''))}"><span class="row-title">${esc(r.label)}</span>${m.title==='Settings'&&r.meta?`<span class="row-meta">${esc(r.meta)}</span>`:''}${r.arrow?'<span class="arrow">›</span>':''}</button>`;}).join('')}</div>${m.rows.length>capacity?`<span class="lcd-scrollbar" aria-hidden="true"><i style="height:${Math.max(8,capacity/m.rows.length*100)}%;top:${range.start/Math.max(1,m.rows.length-capacity)*(100-Math.max(8,capacity/m.rows.length*100))}%"></i></span>`:''}`;
}
function move(delta){
 if(!unlocked()||state.pending)return;clickSound();const m=state.menu;
 if(m.type==='now'){if(state.mode==='seek'){if(auth.connected){const target=Math.min(state.duration,Math.max(0,currentPosition()+delta*3000)),uri=state.current?.uri,session=auth.generation;state.progress=target;state.updated=Date.now();clearTimeout(seekTimer);seekTimer=setTimeout(()=>{if(auth.connected&&auth.generation===session&&state.current?.uri===uri)act(()=>seek(target));},120);renderNowLCD();}else toast('Connect Spotify to seek through music.');}else{volumeDisplayUntil=Date.now()+1500;state.volume=Math.max(0,Math.min(100,state.volume+delta*3));$('#volume').value=state.volume;if(auth.connected)debouncedVolume();renderScreen();}return;}
 if(!m.rows?.length)return;m.selected=Math.max(0,Math.min(m.rows.length-1,m.selected+delta));renderScreen();
}
function select(){if(!unlocked()||state.pending)return;clickSound();$('#select').classList.add('pressed');setTimeout(()=>$('#select').classList.remove('pressed'),130);if(state.menu.type==='now'){state.mode=state.mode==='volume'?'seek':'volume';renderScreen();return;}const r=state.menu.rows?.[state.menu.selected];if(r)act(r.run);}
function libraryMenu(type){const list=state.library[type];const title={tracks:'Songs',artists:'Artists',albums:'Albums'}[type];push({title,empty:auth.connected?'Your collection is empty. Choose another playlist.':'Connect Spotify to load your music.',rows:type==='tracks'?trackRows(list,state.source.id!=='liked'&&state.source.id!=='preview'?'spotify:playlist:'+state.source.id:null):list.map(x=>entry(x.name,()=>type==='artists'?artistLibrary(x):openTrackList(x.name,x.tracks),String(x.tracks.length)))});}
function artistLibrary(artist){const albums=buildLibrary(artist.tracks).albums;push({title:artist.name,rows:[entry('All Songs',()=>openTrackList(artist.name,artist.tracks),String(artist.tracks.length)),...albums.map(a=>entry(a.name,()=>openTrackList(a.name,a.tracks)))]});}
function openTrackList(title,tracks){push({title,rows:trackRows(tracks),empty:'No playable songs in this collection.'});}
function trackRows(tracks,context=null){return tracks.map((t,i)=>entry(t.name,()=>playTrack(t,tracks,i,{context}),time(t.duration_ms),false));}
async function openPlaylists(){
 if(!auth.connected){push({title:'Playlists',rows:[entry('Sample collection',()=>openTrackList('Sample collection',state.library.tracks),String(state.library.tracks.length)),entry('Connect Spotify',connectSpotify)]});return;}
 push({title:'Playlists',rows:[],empty:'Loading playlists…'});const menu=state.menu;
 const playlists=await getPlaylists();menu.rows=[entry('Liked Songs',()=>chooseLibrary({id:'liked',name:'Liked Songs'}),'♥'),...playlists.map(p=>entry(p.name,()=>chooseLibrary({id:p.id,name:p.name,uri:p.uri}),String(p.items?.total??p.tracks?.total??'')))];if(state.menu===menu)renderScreen();
}
async function getPlaylists(force=false){if(state.playlists&&!force)return state.playlists;const generation=auth.generation;const rows=await pageAll(api,'/me/playlists?limit=50');if(generation!==auth.generation||!auth.connected)throw new Error('Spotify request cancelled by disconnect.');state.playlists=rows.filter(Boolean);return state.playlists;}
async function chooseLibrary(source){await loadLibrary(source);if(state.source.id===source.id){appRoot.querySelectorAll('dialog[open]').forEach(d=>d.close());root();libraryMenu('tracks');}}
async function loadLibrary(source){
 if(!live())return;const generation=++state.sourceGeneration;
 state.pending='Loading your collection…';renderScreen();
 try{
  const path=source.id==='liked'?'/me/tracks?limit=50':`/playlists/${encodeURIComponent(source.id)}/items?limit=50`;
  const rows=await pageAll(api,path,n=>{if(generation===state.sourceGeneration){state.pending=`Loading ${n.toLocaleString()} songs…`;renderScreen();}});
  if(generation!==state.sourceGeneration)return;
  state.library=buildLibrary(rows);state.source=source;sessionStorage.setItem(SESSION_KEYS.source,JSON.stringify({id:source.id,name:source.name}));
  state.pending=null;root();updateCollection();toast(`Loaded ${state.library.tracks.length.toLocaleString()} playable songs from ${source.name}.`);
 }catch(e){if(generation===state.sourceGeneration){state.pending=null;renderScreen();throw e;}}
}
async function openSources(){
 if(!auth.connected){await connectSpotify();return;}
 openDialog('#source-dialog');$('#source-list').innerHTML='<p class="fine-print">Loading your playlists…</p>';$('#source-error').textContent='';
 try{const playlists=await getPlaylists(true);const sources=[{id:'liked',name:'Liked Songs'},...playlists];$('#source-list').innerHTML=sources.map((p,i)=>`<button class="source-option ${state.source.id===p.id?'active':''}" data-source-index="${i}"><span class="source-icon">${icon(p.id==='liked'?'heart':'spotify')}</span><span><strong>${esc(p.name)}</strong><small>${p.id==='liked'?'Every song you’ve saved':`${p.items?.total??p.tracks?.total??'Your'} songs`}</small></span><span>${state.source.id===p.id?'✓':'↗'}</span></button>`).join('');$('#source-list').onclick=e=>{const b=e.target.closest('[data-source-index]');if(b)act(async()=>{try{await chooseLibrary(sources[Number(b.dataset.sourceIndex)]);}catch(error){$('#source-error').textContent=error.message;}});};}catch(e){$('#source-list').innerHTML='';$('#source-error').textContent=e.message;}
}
function updateCollection(){
 $('#source-name').textContent=state.source.name;$('#source-details').textContent=`${state.library.tracks.length.toLocaleString()} songs · ${state.library.artists.length.toLocaleString()} artists`;
 for(const [el,key]of[['songs','tracks'],['artists','artists'],['albums','albums']])$('#count-'+el).textContent=state.library[key].length.toLocaleString();
 const connected=auth.connected;$('#library-badge').textContent=connected?'CONNECTED':'PREVIEW';$('#connection-state').classList.toggle('connected',connected);$('#connection-state').innerHTML=`<span></span>${connected?'Spotify connected':'Preview mode'}`;
 $('.connect-button span').textContent=connected?'Account & settings':'Connect Spotify';
 $('#connection-note').innerHTML=connected?`<span class="note-dot"></span><p>Connected to your Spotify account.<br><button class="inline-button" data-action="refresh">Refresh collection</button> · <button class="inline-button" data-action="devices">Output device</button></p>`:'<span class="note-dot"></span><p>You’re exploring a sample library.<br><button class="inline-button" data-action="connect">Connect Spotify</button> to make it yours.</p>';
 $('#device-caption').textContent=connected?'YOUR MUSIC. BACK IN YOUR HANDS.':'THE ORIGINAL FEELING. RECONNECTED.';
 updateNow();
}
function openSearch(){push({type:'search',title:auth.connected?'Search Spotify':'Search Preview',query:'',searchType:'track',rows:[],empty:auth.connected?'Search all of Spotify.':'Sample library only. Connect for Spotify search.',selected:0,total:0,offset:0});$('#lcd-query')?.focus();}
async function search(reset=true){
 const m=state.menu;if(m.type!=='search')return;const q=m.query.trim();if(!q){m.rows=[];m.total=0;m.empty=auth.connected?'Search all of Spotify.':'Sample library only.';renderScreen();return;}
 const generation=++state.searchGeneration;const kind=m.searchType;
 if(reset){m.offset=0;m.results=[];m.selected=0;}m.loading=true;$('#lcd-footer').textContent='SEARCHING…';
 try{
  let result;
  if(!auth.connected){const list=kind==='track'?state.library.tracks:kind==='artist'?state.library.artists:state.library.albums;const found=list.filter(x=>(x.name+' '+artistNames(x)).toLowerCase().includes(q.toLowerCase()));result={items:found,total:found.length,next:null};}
  else{const data=await api.api('/search?'+new URLSearchParams({q,type:kind,limit:'10',offset:String(m.offset||0)}));result=data[kind+'s'];}
  if(generation!==state.searchGeneration||state.menu!==m)return;
  m.results=[...(reset?[]:m.results||[]),...(result?.items||[])];m.total=result?.total??m.results.length;m.loading=false;
  m.rows=m.results.map(x=>entry(x.name,()=>kind==='track'?playTrack(x,m.results,m.results.indexOf(x)):kind==='artist'?openCatalogArtist(x):openCatalogAlbum(x),kind==='track'?time(x.duration_ms):'',kind!=='track'));
  if(result?.next)m.rows.push(entry('Load more…',()=>{m.offset=(m.offset||0)+10;return search(false);}));
  m.empty='No matches. Try another search.';renderScreen();
 }catch(e){if(state.menu===m&&generation===state.searchGeneration){m.loading=false;m.empty=e.message;renderScreen();}throw e;}
}
async function openCatalogArtist(artist){
 if(!auth.connected){artistLibrary(artist);return;}
 push({title:artist.name,rows:[],empty:'Loading releases…'});const menu=state.menu;
 const data=await pageAll(api,`/artists/${encodeURIComponent(artist.id)}/albums?include_groups=album,single&limit=50`);
 const seen=new Set();menu.rows=data.filter(a=>{if(seen.has(a.id))return false;seen.add(a.id);return true;}).map(a=>entry(a.name,()=>openCatalogAlbum(a),a.release_date?.slice(0,4)||''));menu.empty='No available releases.';if(state.menu===menu)renderScreen();
}
async function openCatalogAlbum(album){
 if(!auth.connected){openTrackList(album.name,album.tracks);return;}
 push({title:album.name,rows:[],empty:'Loading album…'});const menu=state.menu;
 const rows=await pageAll(api,`/albums/${encodeURIComponent(album.id)}/tracks?limit=50`);
 const tracks=rows.map(t=>normalizeTrack({...t,album})).filter(Boolean);menu.rows=trackRows(tracks,album.uri);menu.empty='No playable songs in this album.';if(state.menu===menu)renderScreen();
}
async function playTrack(track,tracks=[track],index=0,options={}){
 clearTimeout(seekTimer);playIntent.reset();
 if(!auth.connected){state.current=track;state.playing=false;state.duration=track.duration_ms||0;state.progress=0;updateNow();push({title:'Now Playing',type:'now'});toast('Preview selected. Connect Spotify to hear your music.');return;}
 player.activate();
 if(!player.device){toast('Connecting the player…');await player.init();}
 const normalized=tracks.map(normalizeTrack).filter(Boolean),currentIndex=normalized.findIndex(t=>t.uri===track.uri);
 if(currentIndex<0)throw new Error('This song is unavailable.');
 toast('Starting playback…');
 const generation=++playGeneration,desiredShuffle=state.shuffle,desiredRepeat=state.repeat;
 const context=options.context||null,planned=context?null:new QueuePlanner(normalized,currentIndex,desiredShuffle);
 const body=context?{context_uri:context,offset:{uri:track.uri}}:planned.initial();
 if(options.position)body.position_ms=Math.round(options.position);
 await player.command('shuffle',{state:context?String(desiredShuffle):'false'});
 if(generation!==playGeneration||!auth.connected)return;
 await player.command('repeat',{state:context?desiredRepeat:desiredRepeat==='track'?'track':'off'});
 if(generation!==playGeneration||!auth.connected)return;
 await player.play(body);
 if(generation!==playGeneration||!auth.connected)return;
 $('#toast').hidden=true;sequence=planned;if(sequence)sequence.device=player.device;
 state.current=track;state.playing=true;state.progress=options.position||0;state.duration=track.duration_ms||0;state.updated=Date.now();state.mode='volume';state.shuffle=desiredShuffle;state.repeat=desiredRepeat;
 if(options.navigate!==false)push({title:'Now Playing',type:'now'});
 updateNow();act(()=>refreshLike());act(refillQueue);setTimeout(()=>{if(auth.connected)act(()=>player.poll());},700);
}
async function refillQueue(){
 if(refilling||!sequence||!auth.connected||sequence.device!==player.device||!state.current)return;
 const plan=sequence,generation=playGeneration;refilling=true;
 try{for(const t of plan.nextBatch(state.current.uri,state.repeat==='context')){if(sequence!==plan||generation!==playGeneration||!auth.connected)break;await player.command('queue',{uri:t.uri});if(sequence!==plan)break;plan.commit();}}finally{refilling=false;}
}
function openNow(){push({title:'Now Playing',type:'now'});}
function currentPosition(){return Math.min(state.duration,state.progress+(state.playing?Date.now()-state.updated:0));}
function renderNowLCD(){
 const track=state.current;if(!track){$('#lcd-body').innerHTML='<div class="lcd-empty">Not playing<small>Choose a song from Music.</small></div>';return;}
 const index=state.library.tracks.findIndex(t=>t.uri===track.uri),volume=Date.now()<volumeDisplayUntil&&state.mode==='volume';
 $('#lcd-body').innerHTML=`<div class="now-lcd"><div class="lcd-track-number">${index>=0?`${index+1} of ${state.library.tracks.length}`:'Spotify'}<span>${state.shuffle?'⤨':''}${state.repeat==='track'?'↻1':state.repeat==='context'?'↻':''}</span></div><div class="now-lcd-title">${esc(track.name)}</div><div class="now-lcd-artist">${esc(artistNames(track))}</div><div class="now-lcd-album">${esc(track.album?.name||'')}</div><div class="lcd-meter ${volume?'volume-meter':''} ${state.mode==='seek'?'scrubbing':''}">${volume?'<span class="lcd-volume-icon">◀</span>':''}<div class="lcd-progress"><span id="lcd-progress-fill" style="width:${volume?state.volume:state.duration?currentPosition()/state.duration*100:0}%"></span></div></div><div class="lcd-times"><span id="elapsed">${volume?'Volume':time(currentPosition())}</span><span id="remaining">${volume?state.volume+'%':'−'+time(state.duration-currentPosition())}</span></div></div>`;
}
function tickProgress(){if(state.menu?.type!=='now'||state.pending)return;if(volumeDisplayUntil&&Date.now()>volumeDisplayUntil){volumeDisplayUntil=0;renderNowLCD();}if(!state.current||volumeDisplayUntil)return;const elapsed=$('#elapsed'),remaining=$('#remaining'),fill=$('#lcd-progress-fill');if(elapsed)elapsed.textContent=time(currentPosition());if(remaining)remaining.textContent='−'+time(state.duration-currentPosition());if(fill)fill.style.width=(state.duration?currentPosition()/state.duration*100:0)+'%';}
function updateNow(){
 const t=state.current;const link=safeSpotifyLink(t?.external_urls?.spotify),image=safeImage(t?.album?.images?.[0]?.url);
 $('#now-detail').innerHTML=`<div class="sleeve">${image?`<img src="${esc(image)}" alt="${esc(t.album?.name||'Album artwork')}">`:''}</div><div class="now-copy"><strong>${esc(t?.name||'Nothing spinning. Yet.')}</strong><small>${esc(t?artistNames(t):'A good song is a click away.')}</small>${link?`<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open in Spotify ↗</a>`:''}</div>`;
 $('#transport').hidden=!t;$('#transport-track').innerHTML=t?`${esc(t.name)}<small>${esc(artistNames(t))}</small>`:'';$('#transport-play-icon use').setAttribute('href',state.playing?'#i-pause':'#i-play');
 $('#shuffle').classList.toggle('active',state.shuffle);$('#shuffle').setAttribute('aria-pressed',String(state.shuffle));$('#repeat').classList.toggle('active',state.repeat!=='off');$('#repeat').setAttribute('aria-label','Repeat '+state.repeat);$('#repeat-one').textContent=state.repeat==='track'?'1':'';
 if(state.menu?.type==='now')renderScreen();else{$('#lcd-playing').textContent=state.current?(state.playing?'▶':'Ⅱ'):'';}
}
async function togglePlay(){
 if(!unlocked()||!live())return;player.activate();clickSound();
 if(!state.current){const track=state.library.tracks[0];if(track)return playTrack(track,state.library.tracks,0);throw new Error('Choose a song first.');}
 const position=currentPosition(),intent=playIntent.toggle(state.playing);
 state.progress=position;state.playing=intent.playing;state.updated=Date.now();updateNow();
 try{if(intent.playing)await player.play();else await player.command('pause');playIntent.settle(intent.version);setTimeout(()=>{if(auth.connected)act(()=>player.poll());},400);}catch(error){if(playIntent.cancel(intent.version)){state.playing=playIntent.confirmed;state.updated=Date.now();updateNow();act(()=>player.poll());}throw error;}
}
async function skip(direction){if(!unlocked()||!live())return;clearTimeout(seekTimer);playIntent.reset();clickSound();if(sequence&&direction==='previous'&&currentPosition()<3000){const previous=sequence.previous(state.current?.uri);if(previous)return playTrack(previous,sequence.order,sequence.order.indexOf(previous),{navigate:false});}await player.command(direction);act(refillQueue);setTimeout(()=>{if(auth.connected)act(()=>player.poll());},500);}
async function seek(ms){if(!live())return;await player.command('seek',{position_ms:Math.round(ms)});state.progress=ms;state.updated=Date.now();renderScreen();}
let volumeTimer,seekTimer;function debouncedVolume(){clearTimeout(volumeTimer);volumeTimer=setTimeout(()=>act(()=>player.volume(state.volume/100)),180);}
async function setShuffle(){if(!unlocked()||!live())return;const next=!state.shuffle;if(sequence&&state.current){const plan=sequence;state.shuffle=next;try{await playTrack(state.current,plan.source,0,{navigate:false,position:currentPosition()});}catch(e){state.shuffle=!next;throw e;}}else{await player.command('shuffle',{state:String(next)});state.shuffle=next;}updateNow();toast(next?'Shuffle is on.':'Shuffle is off.');}
async function setRepeat(){if(!unlocked()||!live())return;const modes=['off','context','track'],next=modes[(modes.indexOf(state.repeat)+1)%3];await player.command('repeat',{state:sequence&&next==='context'?'off':next});state.repeat=next;await refillQueue();updateNow();toast('Repeat: '+(next==='context'?'collection':next));}
async function refreshLike(){if(!auth.connected||!state.current?.uri)return;const uri=state.current.uri;const res=await api.api('/me/library/contains?'+new URLSearchParams({uris:uri}));if(state.current?.uri===uri)state.liked=!!res?.[0];}
async function toggleLike(){
 if(!live()||!state.current)return;const current=state.current;await refreshLike();const remove=state.liked;
 await api.api('/me/library?'+new URLSearchParams({uris:current.uri}),{method:remove?'DELETE':'PUT'});state.liked=!remove;toast(remove?'Removed from Liked Songs.':'Added to Liked Songs.');
 if(state.source.id==='liked'){state.library=buildLibrary(remove?state.library.tracks.filter(t=>t.uri!==current.uri):[current,...state.library.tracks]);updateCollection();}openSettings(true);
}
async function openQueue(){
 if(!live())return;push({title:'Up Next',rows:[],empty:'Loading queue…'});const menu=state.menu;const result=await api.api('/me/player/queue');const tracks=(result?.queue||[]).map(normalizeTrack).filter(Boolean);menu.rows=tracks.map(t=>entry(t.name,()=>playTrack(t),time(t.duration_ms),false));menu.empty='Your Spotify queue is empty.';if(state.menu===menu)renderScreen();
}
function openSettings(replace=false){
 const rows=[entry('Music Source',openSources,state.source.id==='liked'?'Liked Songs':'Playlist'),entry('Shuffle',async()=>{await setShuffle();openSettings(true);},state.shuffle?'Songs':'Off'),entry('Repeat',async()=>{await setRepeat();openSettings(true);},state.repeat==='context'?'All':state.repeat==='track'?'One':'Off'),entry('Clicker',()=>{state.sound=!state.sound;localStorage.setItem('rewind.sound',state.sound?'on':'off');clickSound();updateSoundButton();openSettings(true);},state.sound?'On':'Off'),entry('Backlight',()=>{toggleBacklight();openSettings(true);},state.backlight?'On':'Off'),entry('Output Device',openDevices),entry('Up Next',openQueue),entry(popout.popup?'Return to Website':'Pop Out iPod',()=>popout.popup?popout.restore():popout.open())];
 if(state.current)rows.push(entry(state.liked?'Unsave Current Song':'Save Current Song',toggleLike,state.liked?'♥':''),entry('Queue Current Song',async()=>{if(live()){await player.command('queue',{uri:state.current.uri});toast('Added to your Spotify queue.');}}));
 rows.push(entry('Quick Guide',()=>openDialog('#help-dialog')));
 if(auth.connected)rows.push(entry('Disconnect',disconnect));else rows.push(entry('Connect Spotify',connectSpotify));
 if(replace&&state.menu?.title==='Settings'){state.menu.rows=rows;renderScreen();}else push({title:'Settings',rows});
}
async function openDevices(){
 if(!live())return;openDialog('#devices-dialog');$('#device-error').textContent='';await refreshDevices();
}
async function refreshDevices(){
 $('#device-list').innerHTML='<p class="fine-print">Looking for devices…</p>';$('#device-error').textContent='';
 try{const result=await api.api('/me/player/devices');const devices=result?.devices||[];$('#device-list').innerHTML=devices.length?devices.map((d,i)=>`<button class="source-option ${d.id===player.device?'active':''}" data-device="${i}" ${d.is_restricted?'disabled':''}><span class="source-icon">${icon('device')}</span><span><strong>${esc(d.name)}</strong><small>${esc(d.type)}${d.is_restricted?' · controls restricted':''}${d.is_active?' · active':''}</small></span><span>${d.id===player.device?'✓':'↗'}</span></button>`).join(''):'<p class="fine-print">No devices found. Start the browser player above or open the Spotify app on another device.</p>';$('#device-list').onclick=e=>{const b=e.target.closest('[data-device]');if(b)act(async()=>{const d=devices[Number(b.dataset.device)];try{await player.transfer(d.id);$('#devices-dialog').close();toast('Output: '+d.name);await player.poll();}catch(error){$('#device-error').textContent=error.message;}});};}catch(e){$('#device-list').innerHTML='';$('#device-error').textContent=e.message;}
}
async function disconnect(){
 state.sourceGeneration++;state.searchGeneration++;playGeneration++;clearTimeout(seekTimer);clearTimeout(volumeTimer);playIntent.reset();sequence=null;player.disconnect();auth.clear();state.playlists=null;state.current=null;state.playing=false;state.progress=0;state.pending=null;state.library=sample();state.source={id:'preview',name:'Sample collection'};root();updateCollection();toast('Disconnected. Spotify session cleared from this tab.');
}
player.addEventListener('state',({detail:s})=>{
 const trackChanged=!!s.item&&s.item.uri!==state.current?.uri;if(trackChanged)clearTimeout(seekTimer);
 if(sequence&&s.item&&!sequence.order.some(t=>t.uri===s.item.uri))sequence=null;
 if(s.item){state.current={...s.item,album:s.item.album||state.current?.album};state.duration=s.item.duration_ms||s.duration_ms||state.duration;}
 state.progress=s.progress_ms??0;state.playing=playIntent.resolve(!!s.is_playing);state.updated=Date.now();if(!sequence&&s.shuffle_state!==undefined)state.shuffle=s.shuffle_state;if(!sequence&&s.repeat_state)state.repeat=s.repeat_state;if(s.device?.volume_percent!=null){state.volume=s.device.volume_percent;$('#volume').value=state.volume;}
 updateNow();if(trackChanged&&s.item)act(()=>refreshLike());act(refillQueue);
});
player.addEventListener('error',({detail:e})=>report(e));
player.addEventListener('ready',()=>{toast('Browser player ready. Select a song to listen.');if($('#devices-dialog').open)act(refreshDevices);});
async function connectSession(){
 const generation=auth.generation;
 act(()=>player.init());act(()=>player.poll());
 state.library=buildLibrary([]);state.source={id:'liked',name:'Liked Songs'};updateCollection();
 let source;try{source=JSON.parse(sessionStorage.getItem(SESSION_KEYS.source));}catch{};
 if(!source?.id||!/^([a-zA-Z0-9]{22}|liked)$/.test(source.id))source={id:'liked',name:'Liked Songs'};
 await loadLibrary(source).catch(async e=>{if(source.id!=='liked'){toast('Previous playlist unavailable. Loading Liked Songs.');await loadLibrary({id:'liked',name:'Liked Songs'});}else throw e;});
 if(generation!==auth.generation||!auth.connected)return;
}
const actions={popout:()=>popout.open(),sound:()=>{state.sound=!state.sound;localStorage.setItem('rewind.sound',state.sound?'on':'off');clickSound();updateSoundButton();},connect:connectSpotify,source:openSources,songs:()=>libraryMenu('tracks'),artists:()=>libraryMenu('artists'),albums:()=>libraryMenu('albums'),search:openSearch,now:openNow,help:()=>openDialog('#help-dialog'),refresh:()=>loadLibrary(state.source),devices:openDevices,queue:openQueue,play:togglePlay,next:()=>skip('next'),previous:()=>skip('previous')};
appRoot.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b){if(!unlocked())return;act(actions[b.dataset.action]);}});
$('#lcd-body').addEventListener('click',e=>{
 if(!unlocked())return;const row=e.target.closest('[data-row]');if(row){state.menu.selected=Number(row.dataset.row);select();return;}
 const tab=e.target.closest('[data-search-type]');if(tab){state.menu.searchType=tab.dataset.searchType;act(()=>search());}
});
$('#lcd-body').addEventListener('input',e=>{if(e.target.id==='lcd-query'){state.menu.query=e.target.value;state.searchGeneration++;clearTimeout(searchTimer);searchTimer=setTimeout(()=>act(()=>search()),350);}});
$('#lcd-body').addEventListener('submit',e=>{if(e.target.id==='lcd-search-form'){e.preventDefault();clearTimeout(searchTimer);act(()=>search());}});
$('#select').onclick=select;$('#play').onclick=()=>act(togglePlay);$('#previous').onclick=()=>act(()=>skip('previous'));$('#next').onclick=()=>act(()=>skip('next'));$('#shuffle').onclick=()=>act(setShuffle);$('#repeat').onclick=()=>act(setRepeat);
$('#menu').addEventListener('pointerdown',()=>{menuWasLong=false;menuLongTimer=setTimeout(()=>{if(unlocked()){menuWasLong=true;root();clickSound();}},650);});
for(const type of ['pointerup','pointercancel','pointerleave'])$('#menu').addEventListener(type,()=>clearTimeout(menuLongTimer));
$('#menu').onclick=()=>{if(!menuWasLong)back();};
$('#hold').onclick=()=>{state.held=!state.held;$('#hold').setAttribute('aria-pressed',String(state.held));$('#device').classList.toggle('held',state.held);if(state.held)viewDocument.activeElement?.blur();renderScreen();toast(state.held?'HOLD on. Player controls locked.':'HOLD off. Ready to spin.');};
$('#volume').addEventListener('input',()=>{if(!unlocked()){$('#volume').value=state.volume;return;}state.volume=Number($('#volume').value);if(live())debouncedVolume();if(state.menu.type==='now')renderScreen();});
let wheelAngle=null,rotation=0,lastWheel=0,wheelDragged=false;
$('#wheel').addEventListener('wheel',e=>{e.preventDefault();if(Date.now()-lastWheel<65)return;lastWheel=Date.now();move(Math.sign(e.deltaY));},{passive:false});
$('#wheel').addEventListener('pointerdown',e=>{if(e.target.closest('#select')||!unlocked())return;wheelDragged=false;const r=$('#wheel').getBoundingClientRect();wheelAngle=Math.atan2(e.clientY-r.top-r.height/2,e.clientX-r.left-r.width/2);rotation=0;(e.target.closest('.wheel-button')||$('#wheel')).setPointerCapture(e.pointerId);});
$('#wheel').addEventListener('pointermove',e=>{if(wheelAngle===null)return;const r=$('#wheel').getBoundingClientRect(),a=Math.atan2(e.clientY-r.top-r.height/2,e.clientX-r.left-r.width/2);let d=a-wheelAngle;if(d>Math.PI)d-=2*Math.PI;if(d<-Math.PI)d+=2*Math.PI;rotation+=d;wheelAngle=a;const steps=Math.trunc(rotation/.25);if(steps){wheelDragged=true;clearTimeout(menuLongTimer);rotation-=steps*.25;move(steps);}});
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('#wheel').addEventListener(event,()=>{wheelAngle=null;setTimeout(()=>wheelDragged=false,50);});
$('#wheel').addEventListener('click',event=>{if(wheelDragged){event.preventDefault();event.stopImmediatePropagation();wheelDragged=false;}},true);
function handleKeys(e){
 if(appRoot.querySelector('dialog[open]'))return;
 if(e.target.matches('input,textarea,select')){if(e.key==='Escape'){e.preventDefault();e.target.blur();}return;}
 if((e.key==='Enter'||e.key===' ')&&e.target.closest('button,a,[role=button]'))return;
 if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape',' ','/'].includes(e.key))return;e.preventDefault();
 if(!unlocked())return;
 const fn={ArrowUp:()=>move(-1),ArrowDown:()=>move(1),ArrowLeft:back,ArrowRight:select,Enter:select,Escape:back,' ':()=>act(togglePlay),'/':openSearch}[e.key];fn?.();
}
viewDocument.addEventListener('keydown',handleKeys);
for(const dialog of appRoot.querySelectorAll('dialog')){
 dialog.addEventListener('click',e=>{if(e.target.closest('[data-close]')){dialog.close();return;}if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
}
$('#connect-form').addEventListener('submit',async e=>{e.preventDefault();$('#setup-error').textContent='';const b=e.submitter;b.disabled=true;try{await auth.login($('#client-id').value.trim());}catch(err){$('#setup-error').textContent=err.message;b.disabled=false;}});
$('#copy-redirect').onclick=()=>act(async()=>{await navigator.clipboard.writeText(auth.redirect);$('#copy-redirect').textContent='Copied';setTimeout(()=>$('#copy-redirect').textContent='Copy',2000);});
$('#playlist-form').addEventListener('submit',async e=>{e.preventDefault();$('#source-error').textContent='';const b=e.submitter;b.disabled=true;try{const id=parsePlaylistInput($('#playlist-url').value);const playlist=await api.api('/playlists/'+id);await chooseLibrary({id,name:playlist.name,uri:playlist.uri});}catch(err){$('#source-error').textContent=err.message;}finally{b.disabled=false;}});
$('#refresh-devices').onclick=()=>act(refreshDevices);
$('#activate-browser').onclick=async()=>{const b=$('#activate-browser');b.disabled=true;$('#device-error').textContent='';try{player.activate();await player.init();player.activate();if(!player.browserDevice){$('#device-error').textContent='Browser player is connecting. Wait for the ready message, then press this button again.';return;}await player.transfer(player.browserDevice);$('#devices-dialog').close();toast('Output: this browser. Press Play to start audio.');}catch(e){$('#device-error').textContent=e.message;}finally{b.disabled=false;}};
setInterval(tickProgress,250);
setInterval(async()=>{if(!auth.connected||(viewDocument.hidden&&!sequence)||polling)return;polling=true;try{await player.poll();}catch(e){report(e);}finally{polling=false;}},10000);
function onVisibility(){if(!viewDocument.hidden&&auth.connected)act(()=>player.poll());}
viewDocument.addEventListener('visibilitychange',onVisibility);
function updateSoundButton(){const button=$('#sound-toggle');button.setAttribute('aria-pressed',String(state.sound));button.setAttribute('aria-label',state.sound?'Mute wheel clicks':'Enable wheel clicks');button.textContent=state.sound?'Clicks on':'Clicks off';}
const popout=new PlayerWindow(appRoot,{beforeOpen:()=>{player.activate();if(state.sound)clicker.unlock(window);},onBlocked:()=>toast('Allow pop-up windows for Rewind, then press Pop out again.',true),onMove:(doc,view)=>{viewDocument.removeEventListener('keydown',handleKeys);viewDocument.removeEventListener('visibilitychange',onVisibility);viewDocument=doc;viewWindow=view;doc.addEventListener('keydown',handleKeys);doc.addEventListener('visibilitychange',onVisibility);if(state.menu?.title==='Settings')openSettings(true);}});
appRoot.addEventListener('pointerdown',()=>{if(state.sound)clicker.unlock(viewWindow);},{passive:true});
updateSoundButton();root();updateCollection();
act(async()=>{try{await auth.callback();}catch(e){openSetup();$('#setup-error').textContent=e.message;}if(auth.connected)await connectSession();});
