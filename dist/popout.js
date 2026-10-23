// Adopt the actual live UI; the opener keeps the one SDK/audio connection alive.
export class PlayerWindow {
 constructor(root,{onMove=()=>{},beforeOpen=()=>{},onBlocked=()=>{}}={}){this.root=root;this.onMove=onMove;this.beforeOpen=beforeOpen;this.onBlocked=onBlocked;this.popup=null;this.placeholder=null;this.check=null;window.addEventListener('pagehide',()=>{if(this.popup&&!this.popup.closed)this.popup.close();});}
 open(){
  if(this.popup&&!this.popup.closed){this.popup.focus();return;}
  this.beforeOpen();
  const popup=window.open('','rewind-ipod','popup=yes,width=390,height=640,resizable=yes,scrollbars=no');
  if(!popup){this.onBlocked();return;}
  this.popup=popup;const doc=popup.document;doc.title='iPod · Rewind';doc.documentElement.lang='en';
  doc.head.replaceChildren();doc.title='iPod · Rewind';const viewport=doc.createElement('meta');viewport.name='viewport';viewport.content='width=device-width,initial-scale=1';const style=doc.createElement('link');style.rel='stylesheet';style.href=new URL('styles.css',location.href).href;doc.head.append(viewport,style);
  doc.body.className='player-only';
  this.placeholder=document.createElement('section');this.placeholder.className='popout-placeholder';this.placeholder.innerHTML='<span class="mini-ipod" aria-hidden="true">◉</span><h2>Your iPod is popped out.</h2><p>Keep this tab open. Close the player to bring it back.</p><button class="chrome-button">Bring it back</button>';
  this.placeholder.querySelector('button').onclick=()=>this.restore();this.root.replaceWith(this.placeholder);doc.body.replaceChildren(this.root);
  this.onMove(doc,popup);popup.addEventListener('pagehide',()=>this.restore(false),{once:true});this.check=setInterval(()=>{if(popup.closed)this.restore(false);},500);popup.focus();
 }
 restore(close=true){
  if(!this.popup)return;const popup=this.popup;this.popup=null;clearInterval(this.check);this.placeholder?.replaceWith(this.root);this.placeholder=null;this.onMove(document,window);if(close&&!popup.closed)popup.close();
 }
}
