// A very short broadband transient, like the piezo clicker in a Click Wheel.
// Reuse the buffer; scheduling an oscillator on every scroll feels like a beep.
export class WheelClick {
 constructor(){this.context=null;this.buffer=null;this.view=null;this.last=0;}
 unlock(view=window){
  try{if(this.view!==view){this.context?.close().catch(()=>{});this.context=null;this.buffer=null;this.last=0;this.view=view;}
   if(!this.context){const Audio=view.AudioContext||view.webkitAudioContext;if(!Audio)return;const context=this.context=new Audio({latencyHint:'interactive'}),length=Math.ceil(context.sampleRate*.011);this.buffer=context.createBuffer(1,length,context.sampleRate);const samples=this.buffer.getChannelData(0);let seed=271828;
    for(let i=0;i<length;i++){seed=(seed*1664525+1013904223)>>>0;const t=i/context.sampleRate,envelope=Math.exp(-t*650),noise=seed/4294967296*2-1;samples[i]=(noise*.55+Math.sin(t*2*Math.PI*2600)*.45)*envelope*(1-i/length);}
   }
   if(this.context.state==='suspended')this.context.resume().catch(()=>{});
  }catch{}
 }
 play(view=window){this.unlock(view);const context=this.context;if(!context||!this.buffer)return;const now=context.currentTime;if(now-this.last<.018&&this.last)return;this.last=now;const source=context.createBufferSource(),gain=context.createGain();source.buffer=this.buffer;gain.gain.value=.15;source.connect(gain);gain.connect(context.destination);source.start(now);source.onended=()=>{source.disconnect();gain.disconnect();};}
}
