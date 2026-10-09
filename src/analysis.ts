export type Candle={time:number;open:number;high:number;low:number;close:number;volume:number;closed:boolean};
export type Level={price:number;touches:number;kind:'support'|'resistance'};
export type Pivot={index:number;price:number;kind:'high'|'low'};
export type FairValueGap={startIndex:number;endIndex:number;low:number;high:number;direction:'bullish'|'bearish';mitigated:boolean};
export type OrderBlock={index:number;endIndex:number;confirmedIndex:number;low:number;high:number;direction:'bullish'|'bearish';mitigated:boolean};
export type StructureEvent={index:number;price:number;kind:'BOS'|'CHOCH';direction:'bullish'|'bearish'};
export type FibonacciLevel={ratio:number;price:number};
export type Fibonacci={startIndex:number;endIndex:number;low:number;high:number;direction:'bullish'|'bearish';levels:FibonacciLevel[]};
export type Analysis={last:number;atr:number;trend:'Bullish'|'Bearish'|'Mixed';levels:Level[];pivots:Pivot[];recentStructure:string;bullishTrigger:number|null;bearishTrigger:number|null;indicators:{ema20:number;ema50:number;sma200:number;vwap50:number;rsi14:number;macd:number;macdSignal:number};fibonacci:Fibonacci|null;smartMoney:{fairValueGaps:FairValueGap[];orderBlocks:OrderBlock[];structureEvents:StructureEvent[]}};
const mean=(x:number[])=>x.length?x.reduce((a,b)=>a+b,0)/x.length:0;
const ema=(values:number[],period:number)=>{const k=2/(period+1);let value=values[0];for(const next of values.slice(1))value=next*k+value*(1-k);return value};
const emaValues=(values:number[],period:number)=>{const k=2/(period+1);let current=values[0];return values.map((value,index)=>current=index?value*k+current*(1-k):current)};
const rsi=(values:number[],period=14)=>{const changes=values.slice(-period-1).slice(1).map((value,index)=>value-values.slice(-period-1)[index]);const gains=mean(changes.map(x=>Math.max(x,0))),losses=mean(changes.map(x=>Math.max(-x,0)));return losses===0?100:100-(100/(1+gains/losses))};
export function analyze(all:Candle[]):Analysis{
  // Do not confirm patterns on the still-open candle.
  const cs=all.filter(c=>c.closed);
  if(cs.length<30)throw new Error('Need at least 30 completed candles');
  const last=cs[cs.length-1].close;
  const tr=cs.slice(1).map((c,i)=>Math.max(c.high-c.low,Math.abs(c.high-cs[i].close),Math.abs(c.low-cs[i].close)));
  const atr=mean(tr.slice(-14));
  const pivots:Pivot[]=[];
  const width=3;
  for(let i=width;i<cs.length-width;i++){
    const neighbors=[...cs.slice(i-width,i),...cs.slice(i+1,i+1+width)];
    if(neighbors.every(c=>cs[i].high>c.high))pivots.push({index:i,price:cs[i].high,kind:'high'});
    if(neighbors.every(c=>cs[i].low<c.low))pivots.push({index:i,price:cs[i].low,kind:'low'});
  }
  // ATR-banded clustering avoids pretending an exact level is known.
  const tolerance=Math.max(atr*0.7,last*0.002);
  const recent=pivots.filter(p=>p.index>=cs.length-180);
  const clusters:{prices:number[];indices:number[]}[]=[];
  for(const p of recent){
    let found=clusters.find(c=>Math.abs(mean(c.prices)-p.price)<=tolerance);
    if(!found){found={prices:[],indices:[]};clusters.push(found)}
    found.prices.push(p.price);found.indices.push(p.index);
  }
  const levels=clusters.filter(c=>c.prices.length>=2).map(c=>({price:mean(c.prices),touches:c.prices.length,kind:(mean(c.prices)<last?'support':'resistance') as Level['kind']}))
    .sort((a,b)=>Math.abs(a.price-last)-Math.abs(b.price-last)).slice(0,16).sort((a,b)=>a.price-b.price);
  const highs=pivots.filter(p=>p.kind==='high').slice(-2),lows=pivots.filter(p=>p.kind==='low').slice(-2);
  let trend:Analysis['trend']='Mixed';let recentStructure='Insufficient confirmed pivots for trend classification';
  if(highs.length===2&&lows.length===2){
    const hh=highs[1].price>highs[0].price,hl=lows[1].price>lows[0].price;
    trend=hh&&hl?'Bullish':!hh&&!hl?'Bearish':'Mixed';
    recentStructure=`${hh?'Higher':'Lower'} high and ${hl?'higher':'lower'} low confirmed by 3 candles on each side`;
  }
  const resistance=levels.filter(l=>l.price>last).sort((a,b)=>a.price-b.price)[0];
  const support=levels.filter(l=>l.price<last).sort((a,b)=>b.price-a.price)[0];
  const closes=cs.map(c=>c.close);
  const recentVwap=cs.slice(-50),vwapVolume=recentVwap.reduce((sum,c)=>sum+c.volume,0),vwap50=recentVwap.reduce((sum,c)=>sum+((c.high+c.low+c.close)/3)*c.volume,0)/Math.max(vwapVolume,Number.EPSILON);
  const fast=emaValues(closes,12),slow=emaValues(closes,26),macdValues=fast.map((value,index)=>value-slow[index]),macd=macdValues[macdValues.length-1],macdSignal=ema(macdValues.slice(-80),9);

  // Latest significant swing becomes the Fibonacci anchor. The later extreme is the impulse target.
  const fibWindowStart=Math.max(0,cs.length-140),fibWindow=cs.slice(fibWindowStart);
  const swingHigh=Math.max(...fibWindow.map(c=>c.high)),swingLow=Math.min(...fibWindow.map(c=>c.low));
  const highIndex=fibWindowStart+fibWindow.findIndex(c=>c.high===swingHigh),lowIndex=fibWindowStart+fibWindow.findIndex(c=>c.low===swingLow);
  const fibDirection:Fibonacci['direction']=lowIndex<highIndex?'bullish':'bearish',fibRange=swingHigh-swingLow;
  const ratios=[0,.236,.382,.5,.618,.786,1];
  const fibonacci:Fibonacci|null=fibRange>0?{startIndex:fibDirection==='bullish'?lowIndex:highIndex,endIndex:fibDirection==='bullish'?highIndex:lowIndex,low:swingLow,high:swingHigh,direction:fibDirection,levels:ratios.map(ratio=>({ratio,price:fibDirection==='bullish'?swingHigh-fibRange*ratio:swingLow+fibRange*ratio}))}:null;

  // Three-candle price imbalances. A gap stays active until price fully trades through it.
  const fairValueGaps:FairValueGap[]=[];const minimumGap=Math.max(atr*.08,last*.00015);
  for(let i=Math.max(2,cs.length-220);i<cs.length;i++){
    const bullishLow=cs[i-2].high,bullishHigh=cs[i].low,bearishLow=cs[i].high,bearishHigh=cs[i-2].low;
    if(bullishHigh-bullishLow>=minimumGap){
      const mitigation=cs.findIndex((c,index)=>index>i&&c.low<=bullishLow),endIndex=mitigation>i?mitigation:cs.length-1;
      fairValueGaps.push({startIndex:i-2,endIndex,low:bullishLow,high:bullishHigh,direction:'bullish',mitigated:mitigation>i});
    }
    if(bearishHigh-bearishLow>=minimumGap){
      const mitigation=cs.findIndex((c,index)=>index>i&&c.high>=bearishHigh),endIndex=mitigation>i?mitigation:cs.length-1;
      fairValueGaps.push({startIndex:i-2,endIndex,low:bearishLow,high:bearishHigh,direction:'bearish',mitigated:mitigation>i});
    }
  }

  // Displacement through a recent range identifies BOS/CHOCH and the last opposing candle as an order block.
  const orderBlocks:OrderBlock[]=[];const structureEvents:StructureEvent[]=[];let previousBreak:'bullish'|'bearish'|null=null;
  for(let i=13;i<cs.length;i++){
    const range=cs.slice(i-12,i),previous=cs[i-1],candle=cs[i],rangeHigh=Math.max(...range.map(c=>c.high)),rangeLow=Math.min(...range.map(c=>c.low));
    const body=Math.abs(candle.close-candle.open),bullishBreak=candle.close>rangeHigh&&previous.close<=rangeHigh&&candle.close>candle.open, bearishBreak=candle.close<rangeLow&&previous.close>=rangeLow&&candle.close<candle.open;
    const direction=bullishBreak?'bullish':bearishBreak?'bearish':null;if(!direction||body<atr*.55)continue;
    const kind:StructureEvent['kind']=previousBreak&&previousBreak!==direction?'CHOCH':'BOS';
    structureEvents.push({index:i,price:direction==='bullish'?rangeHigh:rangeLow,kind,direction});previousBreak=direction;
    const search=cs.slice(Math.max(0,i-7),i);let relative=-1;
    for(let j=search.length-1;j>=0;j--){if(direction==='bullish'?search[j].close<search[j].open:search[j].close>search[j].open){relative=j;break}}
    if(relative<0)continue;
    const blockIndex=Math.max(0,i-7)+relative,block=cs[blockIndex],blockLow=block.low,blockHigh=block.high;
    const later=cs.slice(i+1),invalidIndex=later.findIndex(c=>direction==='bullish'?c.close<blockLow:c.close>blockHigh),touchIndex=later.findIndex(c=>c.low<=blockHigh&&c.high>=blockLow);
    orderBlocks.push({index:blockIndex,confirmedIndex:i,endIndex:invalidIndex>=0?i+1+invalidIndex:cs.length-1,low:blockLow,high:blockHigh,direction,mitigated:touchIndex>=0});
  }
  const uniqueBlocks=orderBlocks.filter((block,index,list)=>list.findIndex(candidate=>candidate.index===block.index&&candidate.direction===block.direction)===index).slice(-12);
  return {last,atr,trend,levels,pivots:pivots.slice(-28),recentStructure,bullishTrigger:resistance?.price??null,bearishTrigger:support?.price??null,indicators:{ema20:ema(closes.slice(-80),20),ema50:ema(closes.slice(-150),50),sma200:mean(closes.slice(-200)),vwap50,rsi14:rsi(closes),macd,macdSignal},fibonacci,smartMoney:{fairValueGaps:fairValueGaps.slice(-20),orderBlocks:uniqueBlocks,structureEvents:structureEvents.slice(-16)}};
}
