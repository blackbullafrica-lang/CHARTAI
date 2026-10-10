export type Candle={time:number;open:number;high:number;low:number;close:number;volume:number;closed:boolean};
export type Level={price:number;touches:number;kind:'support'|'resistance'};
export type Pivot={index:number;price:number;kind:'high'|'low'};
export type FairValueGap={startIndex:number;endIndex:number;low:number;high:number;direction:'bullish'|'bearish';mitigated:boolean};
export type OrderBlock={index:number;endIndex:number;confirmedIndex:number;low:number;high:number;direction:'bullish'|'bearish';mitigated:boolean};
export type StructureEvent={index:number;price:number;kind:'BOS'|'CHOCH';direction:'bullish'|'bearish'};
export type FibonacciLevel={ratio:number;price:number};
export type Fibonacci={startIndex:number;endIndex:number;low:number;high:number;direction:'bullish'|'bearish';levels:FibonacciLevel[]};
export type PatternPoint={index:number;price:number;label:string};
export type PatternSegment={from:PatternPoint;to:PatternPoint};
export type ChartPattern={name:string;direction:'bullish'|'bearish'|'neutral';confidence:number;description:string;startIndex:number;endIndex:number;points:PatternPoint[];segments:PatternSegment[]};
export type Analysis={last:number;atr:number;trend:'Bullish'|'Bearish'|'Mixed';levels:Level[];pivots:Pivot[];patterns:ChartPattern[];recentStructure:string;bullishTrigger:number|null;bearishTrigger:number|null;indicators:{ema20:number;ema50:number;sma200:number;vwap50:number;rsi14:number;macd:number;macdSignal:number};fibonacci:Fibonacci|null;smartMoney:{fairValueGaps:FairValueGap[];orderBlocks:OrderBlock[];structureEvents:StructureEvent[]}};
const mean=(x:number[])=>x.length?x.reduce((a,b)=>a+b,0)/x.length:0;
const ema=(values:number[],period:number)=>{const k=2/(period+1);let value=values[0];for(const next of values.slice(1))value=next*k+value*(1-k);return value};
const emaValues=(values:number[],period:number)=>{const k=2/(period+1);let current=values[0];return values.map((value,index)=>current=index?value*k+current*(1-k):current)};
const rsi=(values:number[],period=14)=>{const changes=values.slice(-period-1).slice(1).map((value,index)=>value-values.slice(-period-1)[index]);const gains=mean(changes.map(x=>Math.max(x,0))),losses=mean(changes.map(x=>Math.max(-x,0)));return losses===0?100:100-(100/(1+gains/losses))};
function detectChartPatterns(candles:Candle[],pivots:Pivot[],atr:number):ChartPattern[]{
  const patterns:ChartPattern[]=[];
  const highs=pivots.filter(pivot=>pivot.kind==='high').slice(-6);
  const lows=pivots.filter(pivot=>pivot.kind==='low').slice(-6);
  const geometryFor=(pattern:Omit<ChartPattern,'points'|'segments'>):Pick<ChartPattern,'points'|'segments'>=>{
    const patternHighs=pivots.filter(pivot=>pivot.kind==='high'&&pivot.index>=pattern.startIndex&&pivot.index<=pattern.endIndex).sort((a,b)=>a.index-b.index);
    const patternLows=pivots.filter(pivot=>pivot.kind==='low'&&pivot.index>=pattern.startIndex&&pivot.index<=pattern.endIndex).sort((a,b)=>a.index-b.index);
    const point=(pivot:Pivot,label:string):PatternPoint=>({index:pivot.index,price:pivot.price,label});
    const segment=(from:PatternPoint,to:PatternPoint):PatternSegment=>({from,to});
    if(pattern.name==='Double top'&&patternHighs.length>=2&&patternLows.length){
      const [first,second]=[patternHighs[0],patternHighs[patternHighs.length-1]], valley=patternLows.filter(pivot=>pivot.index>first.index&&pivot.index<second.index).sort((a,b)=>a.price-b.price)[0];
      if(valley){const necklineStart={index:first.index,price:valley.price,label:'Neckline'},necklineEnd={index:second.index,price:valley.price,label:'Neckline'};return{points:[point(first,'Peak 1'),point(valley,'Reaction low'),point(second,'Peak 2')],segments:[segment(point(first,'Peak 1'),point(second,'Peak 2')),segment(necklineStart,necklineEnd)]};}
    }
    if(pattern.name==='Double bottom'&&patternLows.length>=2&&patternHighs.length){
      const [first,second]=[patternLows[0],patternLows[patternLows.length-1]], peak=patternHighs.filter(pivot=>pivot.index>first.index&&pivot.index<second.index).sort((a,b)=>b.price-a.price)[0];
      if(peak){const necklineStart={index:first.index,price:peak.price,label:'Neckline'},necklineEnd={index:second.index,price:peak.price,label:'Neckline'};return{points:[point(first,'Low 1'),point(peak,'Reaction high'),point(second,'Low 2')],segments:[segment(point(first,'Low 1'),point(second,'Low 2')),segment(necklineStart,necklineEnd)]};}
    }
    if(pattern.name==='Head and shoulders'&&patternHighs.length>=3&&patternLows.length>=2){
      const [left,head,right]=patternHighs.slice(-3),neckLeft=patternLows.find(pivot=>pivot.index>left.index&&pivot.index<head.index),neckRight=patternLows.find(pivot=>pivot.index>head.index&&pivot.index<right.index);
      if(neckLeft&&neckRight){const shoulder=point(left,'Shoulder'),crown=point(head,'Head'),otherShoulder=point(right,'Shoulder');return{points:[shoulder,crown,otherShoulder,point(neckLeft,'Neckline'),point(neckRight,'Neckline')],segments:[segment(shoulder,crown),segment(crown,otherShoulder),segment(point(neckLeft,'Neckline'),point(neckRight,'Neckline'))]};}
    }
    if(pattern.name==='Inverse head and shoulders'&&patternLows.length>=3&&patternHighs.length>=2){
      const [left,head,right]=patternLows.slice(-3),neckLeft=patternHighs.find(pivot=>pivot.index>left.index&&pivot.index<head.index),neckRight=patternHighs.find(pivot=>pivot.index>head.index&&pivot.index<right.index);
      if(neckLeft&&neckRight){const shoulder=point(left,'Shoulder'),trough=point(head,'Head'),otherShoulder=point(right,'Shoulder');return{points:[shoulder,trough,otherShoulder,point(neckLeft,'Neckline'),point(neckRight,'Neckline')],segments:[segment(shoulder,trough),segment(trough,otherShoulder),segment(point(neckLeft,'Neckline'),point(neckRight,'Neckline'))]};}
    }
    if(patternHighs.length>=2&&patternLows.length>=2){
      const upperStart=point(patternHighs[0],'Upper boundary'),upperEnd=point(patternHighs[patternHighs.length-1],'Upper boundary'),lowerStart=point(patternLows[0],'Lower boundary'),lowerEnd=point(patternLows[patternLows.length-1],'Lower boundary');
      return{points:[upperStart,upperEnd,lowerStart,lowerEnd],segments:[segment(upperStart,upperEnd),segment(lowerStart,lowerEnd)]};
    }
    return{points:[],segments:[]};
  };
  const add=(pattern:Omit<ChartPattern,'points'|'segments'>,geometry?:Pick<ChartPattern,'points'|'segments'>)=>{
    if(patterns.some(existing=>existing.name===pattern.name))return;
    const shape=geometry??geometryFor(pattern);
    if(shape.segments.length){patterns.push({...pattern,...shape});return;}
    const window=candles.slice(pattern.startIndex,pattern.endIndex+1);
    if(!window.length)return;
    const high=Math.max(...window.map(candle=>candle.high)),low=Math.min(...window.map(candle=>candle.low));
    const topLeft={index:pattern.startIndex,price:high,label:'Pattern high'},topRight={index:pattern.endIndex,price:high,label:'Pattern high'};
    const bottomLeft={index:pattern.startIndex,price:low,label:'Pattern low'},bottomRight={index:pattern.endIndex,price:low,label:'Pattern low'};
    patterns.push({...pattern,points:[topLeft,topRight,bottomLeft,bottomRight],segments:[{from:topLeft,to:topRight},{from:topLeft,to:bottomLeft},{from:bottomLeft,to:bottomRight},{from:topRight,to:bottomRight}]});
  };
  const similar=(a:number,b:number,multiplier=1.25)=>Math.abs(a-b)<=Math.max(atr*multiplier,((a+b)/2)*.006);
  const confidenceFor=(a:number,b:number)=>Math.round(Math.max(58,Math.min(94,94-(Math.abs(a-b)/Math.max(atr,Number.EPSILON))*9)));

  if(highs.length>=2){
    const [first,second]=highs.slice(-2),between=lows.filter(low=>low.index>first.index&&low.index<second.index);
    const valley=between.length?Math.min(...between.map(low=>low.price)):Infinity;
    if(similar(first.price,second.price)&&Number.isFinite(valley)&&Math.min(first.price,second.price)-valley>=atr*1.25){
      add({name:'Double top',direction:'bearish',confidence:confidenceFor(first.price,second.price),description:'Two similar swing highs with a confirmed reaction low between them.',startIndex:first.index,endIndex:second.index});
    }
  }
  if(lows.length>=2){
    const [first,second]=lows.slice(-2),between=highs.filter(high=>high.index>first.index&&high.index<second.index);
    const peak=between.length?Math.max(...between.map(high=>high.price)):-Infinity;
    if(similar(first.price,second.price)&&Number.isFinite(peak)&&peak-Math.max(first.price,second.price)>=atr*1.25){
      add({name:'Double bottom',direction:'bullish',confidence:confidenceFor(first.price,second.price),description:'Two similar swing lows with a confirmed reaction high between them.',startIndex:first.index,endIndex:second.index});
    }
  }
  if(highs.length>=3){
    const [left,head,right]=highs.slice(-3);
    const neck=lows.filter(low=>low.index>left.index&&low.index<right.index);
    if(head.price>Math.max(left.price,right.price)+atr*.65&&similar(left.price,right.price,1.6)&&neck.length>=2){
      add({name:'Head and shoulders',direction:'bearish',confidence:confidenceFor(left.price,right.price),description:'A higher central peak is flanked by two comparable shoulders above a neckline.',startIndex:left.index,endIndex:right.index});
    }
  }
  if(lows.length>=3){
    const [left,head,right]=lows.slice(-3);
    const neck=highs.filter(high=>high.index>left.index&&high.index<right.index);
    if(head.price<Math.min(left.price,right.price)-atr*.65&&similar(left.price,right.price,1.6)&&neck.length>=2){
      add({name:'Inverse head and shoulders',direction:'bullish',confidence:confidenceFor(left.price,right.price),description:'A lower central trough is flanked by two comparable shoulders below a neckline.',startIndex:left.index,endIndex:right.index});
    }
  }

  if(highs.length>=3&&lows.length>=3){
    const recentHighs=highs.slice(-3),recentLows=lows.slice(-3);
    const highSpan=Math.max(1,recentHighs[2].index-recentHighs[0].index);
    const lowSpan=Math.max(1,recentLows[2].index-recentLows[0].index);
    const highSlope=(recentHighs[2].price-recentHighs[0].price)/highSpan;
    const lowSlope=(recentLows[2].price-recentLows[0].price)/lowSpan;
    const flat=Math.max(atr*.025,candles[candles.length-1].close*.00008);
    const startIndex=Math.min(recentHighs[0].index,recentLows[0].index);
    const endIndex=Math.max(recentHighs[2].index,recentLows[2].index);
    if(Math.abs(highSlope)<=flat&&lowSlope>flat){
      add({name:'Ascending triangle',direction:'bullish',confidence:76,description:'Rising swing lows are compressing beneath a relatively flat resistance line.',startIndex,endIndex});
    }else if(highSlope<-flat&&Math.abs(lowSlope)<=flat){
      add({name:'Descending triangle',direction:'bearish',confidence:76,description:'Falling swing highs are compressing above a relatively flat support line.',startIndex,endIndex});
    }else if(highSlope<-flat&&lowSlope>flat){
      add({name:'Symmetrical triangle',direction:'neutral',confidence:72,description:'Lower highs and higher lows are converging into a balanced compression.',startIndex,endIndex});
    }else if(highSlope>flat&&lowSlope>highSlope+flat*.25){
      add({name:'Rising wedge',direction:'bearish',confidence:69,description:'Both boundaries rise while the lower boundary converges faster, showing weakening upside structure.',startIndex,endIndex});
    }else if(lowSlope<-flat&&highSlope<lowSlope-flat*.25){
      add({name:'Falling wedge',direction:'bullish',confidence:69,description:'Both boundaries fall while the upper boundary converges faster, showing weakening downside structure.',startIndex,endIndex});
    }
  }

  if(candles.length>=36){
    const poleStartPrice=candles[candles.length-36].close;
    const poleEndPrice=candles[candles.length-13].close;
    const poleMove=poleEndPrice-poleStartPrice;
    const flag=candles.slice(-12);
    const flagMove=flag[flag.length-1].close-flag[0].close;
    const flagRange=Math.max(...flag.map(c=>c.high))-Math.min(...flag.map(c=>c.low));
    if(Math.abs(poleMove)>=atr*4&&flagRange<=Math.abs(poleMove)*.55){
      const poleEndIndex=candles.length-13,flagStartIndex=candles.length-12,flagMiddleIndex=candles.length-6,flagEndIndex=candles.length-1;
      const firstHalf= candles.slice(flagStartIndex,flagMiddleIndex),secondHalf=candles.slice(flagMiddleIndex);
      const poleStart={index:candles.length-36,price:poleStartPrice,label:'Pole start'};
      const poleEnd={index:poleEndIndex,price:poleEndPrice,label:'Pole end'};
      const upperStart={index:firstHalf.reduce((best,candle,index)=>candle.high>firstHalf[best].high?index:best,0)+flagStartIndex,price:Math.max(...firstHalf.map(candle=>candle.high)),label:'Flag high'};
      const upperEnd={index:secondHalf.reduce((best,candle,index)=>candle.high>secondHalf[best].high?index:best,0)+flagMiddleIndex,price:Math.max(...secondHalf.map(candle=>candle.high)),label:'Flag high'};
      const lowerStart={index:firstHalf.reduce((best,candle,index)=>candle.low<firstHalf[best].low?index:best,0)+flagStartIndex,price:Math.min(...firstHalf.map(candle=>candle.low)),label:'Flag low'};
      const lowerEnd={index:secondHalf.reduce((best,candle,index)=>candle.low<secondHalf[best].low?index:best,0)+flagMiddleIndex,price:Math.min(...secondHalf.map(candle=>candle.low)),label:'Flag low'};
      const flagGeometry={points:[poleStart,poleEnd,upperStart,upperEnd,lowerStart,lowerEnd],segments:[{from:poleStart,to:poleEnd},{from:upperStart,to:upperEnd},{from:lowerStart,to:lowerEnd}]};
      if(poleMove>0&&flagMove<=atr*.8)add({name:'Bull flag',direction:'bullish',confidence:67,description:'A strong upward impulse is followed by a compact pause or pullback.',startIndex:candles.length-36,endIndex:candles.length-1},flagGeometry);
      if(poleMove<0&&flagMove>=-atr*.8)add({name:'Bear flag',direction:'bearish',confidence:67,description:'A strong downward impulse is followed by a compact pause or rebound.',startIndex:candles.length-36,endIndex:candles.length-1},flagGeometry);
    }
  }
  return patterns.slice(0,6);
}
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
  // Cluster pivot lows and highs separately so a resistance always comes from
  // confirmed swing highs and a support always comes from confirmed swing lows.
  const tolerance=Math.max(atr*0.7,last*0.002);
  const recent=pivots.filter(p=>p.index>=cs.length-180);
  const clusterLevels=(source:Pivot[],kind:Level['kind'])=>{
    const clusters:{prices:number[];indices:number[]}[]=[];
    for(const p of source){
      let found=clusters.find(c=>Math.abs(mean(c.prices)-p.price)<=tolerance);
      if(!found){found={prices:[],indices:[]};clusters.push(found)}
      found.prices.push(p.price);found.indices.push(p.index);
    }
    return clusters
      .filter(c=>c.prices.length>=2)
      .map(c=>({price:mean(c.prices),touches:c.prices.length,kind}))
      .filter(level=>kind==='support'?level.price<last:level.price>last)
      .sort((a,b)=>a.price-b.price);
  };
  // Keep both the extreme and nearest levels on each side. This preserves the
  // lowest supports and highest resistances without losing nearby triggers.
  const keepEdges=(candidates:Level[],limit=8)=>{
    if(candidates.length<=limit)return candidates;
    const edgeCount=Math.floor(limit/2);
    return [...candidates.slice(0,edgeCount),...candidates.slice(-edgeCount)];
  };
  const supports=keepEdges(clusterLevels(recent.filter(p=>p.kind==='low'),'support'));
  const resistances=keepEdges(clusterLevels(recent.filter(p=>p.kind==='high'),'resistance'));
  const levels=[...supports,...resistances].sort((a,b)=>a.price-b.price);
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
  const patterns=detectChartPatterns(cs,pivots,atr);
  return {last,atr,trend,levels,pivots:pivots.slice(-48),patterns,recentStructure,bullishTrigger:resistance?.price??null,bearishTrigger:support?.price??null,indicators:{ema20:ema(closes.slice(-80),20),ema50:ema(closes.slice(-150),50),sma200:mean(closes.slice(-200)),vwap50,rsi14:rsi(closes),macd,macdSignal},fibonacci,smartMoney:{fairValueGaps:fairValueGaps.slice(-20),orderBlocks:uniqueBlocks,structureEvents:structureEvents.slice(-16)}};
}
