import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTrack, buildLibrary, pageAll, parsePlaylistInput, playbackWindow} from '../dist/core.js';
const track=(id,name='Song',artists=[{id:'a',name:'Artist'}])=>({id,type:'track',name,uri:`spotify:track:${id}`,duration_ms:123000,artists,album:{id:'album',name:'Album',images:[]}});
test('handles current playlist item and saved-track wrappers',()=>{
 assert.equal(normalizeTrack({item:track('1')}).id,'1');
 assert.equal(normalizeTrack({track:track('2')}).id,'2');
 assert.equal(normalizeTrack(null),null);
 assert.equal(normalizeTrack({item:null}),null);
});
test('excludes local, episodes and explicitly unavailable tracks',()=>{
 assert.equal(normalizeTrack({...track('1'),is_local:true}),null);
 assert.equal(normalizeTrack({...track('1'),is_playable:false}),null);
 assert.equal(normalizeTrack({...track('1'),type:'episode'}),null);
});
test('groups collaborations under each artist without duplicates',()=>{
 const library=buildLibrary([track('1','One',[{id:'a',name:'Same'},{id:'b',name:'Same'}]),track('2','Two'),track('2','Two')]);
 assert.equal(library.tracks.length,2);
 assert.equal(library.artists.length,2);
 assert.equal(library.artists.find(x=>x.id==='a').tracks.length,2);
 assert.equal(library.artists.find(x=>x.id==='b').tracks.length,1);
});
test('does not combine distinct albums that share a name',()=>{
 const second=track('2'); second.album.id='other';
 assert.equal(buildLibrary([track('1'),second]).albums.length,2);
});
test('fetches all pages rather than just the first 50',async()=>{
 let n=0;const client={api:async()=>({items:Array.from({length:50},(_,i)=>i+n++),next:n<150?'https://api.spotify.com/v1/me/tracks?offset='+n:null})};
 const result=await pageAll(client,'/me/tracks');assert.equal(result.length,150);
});
test('rejects malicious pagination links before exposing credentials',async()=>{
 const client={api:async()=>({items:[],next:'https://attacker.example/steal'})};
 await assert.rejects(pageAll(client,'/me/tracks'),/pagination/i);
});
test('playlist parser accepts Spotify links, URIs and IDs only',()=>{
 const id='37i9dQZF1DXcBWIGoYBM5M';
 assert.equal(parsePlaylistInput('https://open.spotify.com/playlist/'+id+'?si=abc'),id);
 assert.equal(parsePlaylistInput('spotify:playlist:'+id),id);
 assert.throws(()=>parsePlaylistInput('https://evil.test/playlist/'+id));
});
test('playback window keeps selected position in large libraries',()=>{
 const rows=Array.from({length:480},(_,i)=>track(String(i)));
 const w=playbackWindow(rows,370);
 assert.ok(w.uris.length<=100);assert.equal(w.uris[w.offset.position],'spotify:track:370');
});

test('rolling queue continues beyond the first 100 songs and wraps only with repeat',async()=>{
 const {QueuePlanner}=await import('../dist/core.js');
 assert.equal(typeof QueuePlanner,'function');
 const rows=Array.from({length:240},(_,i)=>track(String(i)));
 const q=new QueuePlanner(rows,0);
 assert.equal(q.initial().uris.length,100);
 assert.equal(q.nextBatch('spotify:track:96',false)[0].uri,'spotify:track:100');
 for(let i=0;i<10;i++)q.commit();
 assert.equal(q.nextBatch('spotify:track:106',false)[0].uri,'spotify:track:110');
 const end=new QueuePlanner(rows,239);
 assert.deepEqual(end.nextBatch('spotify:track:239',false),[]);
 assert.equal(end.nextBatch('spotify:track:239',true)[0].uri,'spotify:track:0');
});
test('large-library shuffle includes songs outside the first window',async()=>{
 const {QueuePlanner}=await import('../dist/core.js');
 const rows=Array.from({length:300},(_,i)=>track(String(i)));
 const q=new QueuePlanner(rows,200,true,()=>0);
 assert.equal(q.initial().uris[0],'spotify:track:200');
 assert.equal(new Set(q.order.map(t=>t.uri)).size,300);
 assert.ok(q.order.some(t=>t.uri==='spotify:track:299'));
});

test('large iPod menus keep a bounded window containing the selection',async()=>{
 const {menuWindow}=await import('../dist/core.js');assert.equal(typeof menuWindow,'function');
 assert.deepEqual(menuWindow(681,0),{start:0,end:5});assert.deepEqual(menuWindow(681,680,0),{start:676,end:681});assert.deepEqual(menuWindow(681,6,0),{start:2,end:7});assert.deepEqual(menuWindow(4,3,100),{start:0,end:4});
});

test('rapid playback presses preserve the latest intent through intermediate SDK states',async()=>{
 const {PlaybackIntent}=await import('../dist/core.js');assert.equal(typeof PlaybackIntent,'function');let now=0;const intent=new PlaybackIntent(()=>now);
 const first=intent.toggle(true);assert.equal(first.playing,false);const second=intent.toggle(false);assert.equal(second.playing,true);
 intent.settle(first.version);assert.equal(intent.resolve(false),true);const third=intent.toggle(intent.resolve(false));assert.equal(third.playing,false);intent.settle(third.version);assert.equal(intent.resolve(false),false);assert.equal(intent.pending,false);
 const fourth=intent.toggle(false);intent.settle(fourth.version);now=3000;assert.equal(intent.resolve(false),false);
});
test('failed rapid playback commands roll back to confirmed state rather than optimistic state',async()=>{
 const {PlaybackIntent}=await import('../dist/core.js');const intent=new PlaybackIntent();const pause=intent.toggle(true),resume=intent.toggle(false);assert.equal(intent.cancel(pause.version),false);assert.equal(intent.cancel(resume.version),true);assert.equal(intent.confirmed,true);
});
