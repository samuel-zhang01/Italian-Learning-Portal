/** Private source-linked PPTX companion renderer; originals remain unchanged. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(root,'work/archive-companions/node-runtime/package.json'));
const PptxGenJS=require('pptxgenjs');
const input=path.resolve(process.argv[2]||'');
if(!input.startsWith(path.join(root,'work/archive-companions/renders')+path.sep))throw new Error('A private renderer payload is required');
const data=JSON.parse(await fs.readFile(input,'utf8'));
const pres=new PptxGenJS();
pres.defineLayout({name:'PARLIAMO_WIDE',width:13.333,height:7.5});pres.layout='PARLIAMO_WIDE';
pres.author='Parliamo companion';pres.subject='Private English / Italian class study guide';pres.title=data.source.title.en+' · EN / IT';pres.company='Private study';pres.lang='it-IT';
const S=pres.ShapeType,C={green:'164B3B',ink:'18332C',light:'EFF6F1',sage:'D8E8DD',orange:'A85120',white:'FFFFFF'};
const filename=path.basename(data.source.path),record=[];
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
function wordsToLines(text,width=52){
 const lines=[];let current='';
 for(const paragraph of String(text||'').split('\n')){
  for(const word of paragraph.split(/\s+/).filter(Boolean)){
   if(current && current.length+word.length+1>width){lines.push(current);current=word}else current+=(current?' ':'')+word;
  }
  if(current){lines.push(current);current=''}
 }
 return lines;
}
function footer(slide,label){
 slide.addText(filename,{x:.5,y:7.12,w:10.9,h:.18,fontFace:'Arial',fontSize:8,color:C.ink,margin:0,breakLine:false});
 slide.addText(label,{x:11.45,y:7.12,w:1.35,h:.18,fontFace:'Arial',fontSize:8,color:C.ink,align:'right',margin:0});
}
function header(slide,en,it){
 slide.background={color:C.white};
 slide.addText(en,{x:.5,y:.38,w:12.33,h:.43,fontFace:'Cambria',fontSize:en.length>80?19:en.length>65?22:25,bold:true,color:C.green,margin:0});
 slide.addText(it,{x:.5,y:.87,w:12.33,h:.27,fontFace:'Arial',fontSize:it.length>115?11:14,color:C.orange,margin:0});
}
function textSlide(label,left,right,part=1){
 const slide=pres.addSlide();header(slide,label.en,label.it);
 for(const [index,lines] of [left,right].entries()){
  const x=index?6.84:.5;
  slide.addShape(S.roundRect,{x,y:1.28,w:5.99,h:5.55,rectRadius:.14,fill:{color:C.light},line:{color:C.sage,width:.7},radius:.14});
  slide.addShape(S.ellipse,{x:x+.25,y:1.5,w:.48,h:.48,fill:{color:C.green},line:{color:C.green,width:0}});
  slide.addText(index?'IT':'EN',{x:x+.25,y:1.61,w:.48,h:.18,fontFace:'Arial',fontSize:12,bold:true,color:C.white,align:'center',margin:0});
  slide.addText(lines.join('\n'),{x:x+.25,y:2.13,w:5.45,h:4.35,fontFace:'Arial',fontSize:16,color:C.ink,margin:0,paraSpaceAfter:0,lineSpacingMultiple:1.0,lang:index?'it-IT':'en-GB',valign:'top'});
 }
 footer(slide,String(part));record.push({kind:'notes',source_page:label.number??null,lines:[left.length,right.length]});
}
function vocabularySlides(label,words){
 const short=words.filter(w=>w.it&&w.en&&clean(w.it).length<85&&clean(w.en).length<101);
 for(let i=0;i<short.length;i+=6){
  const slide=pres.addSlide();header(slide,'Vocabulary','Lessico');
  const group=short.slice(i,i+6);
  group.forEach((word,index)=>{
   const x=.5+(index%2)*6.33,y=1.36+Math.floor(index/2)*1.79;
   slide.addShape(S.roundRect,{x,y,w:6,h:1.57,rectRadius:.12,fill:{color:index%3===1?C.sage:C.light},line:{color:C.sage,width:.7}});
   const italian=wordsToLines(word.it,44),english=wordsToLines(word.en,55);
   slide.addText(italian.join('\n'),{x:x+.22,y:y+.17,w:5.56,h:.64,fontFace:'Cambria',fontSize:18,bold:true,color:C.green,margin:0,paraSpaceAfter:0,lineSpacingMultiple:1});
   slide.addText(english.join('\n'),{x:x+.22,y:y+.87,w:5.56,h:.5,fontFace:'Arial',fontSize:14,color:C.ink,margin:0,paraSpaceAfter:0,lineSpacingMultiple:1});
  });footer(slide,'EN / IT');record.push({kind:'vocabulary',source_page:label.number??null,words:group.length});
 }
 return words.filter(w=>w.it&&w.en&&!short.includes(w));
}
function notesForGroup(label,blocks){
 let left=[],right=[],part=0;
 const flush=()=>{if(left.length||right.length){textSlide(label,left,right,++part);left=[];right=[]}};
 for(const block of blocks){
  if(block.kind==='source-excerpt')continue; // It is preserved in the source image and searchable notes.
  if(block.kind==='vocabulary'){
   flush();const long=vocabularySlides(label,block.words);for(const w of long){
    const en=wordsToLines(w.en),it=wordsToLines(w.it);
    for(let offset=0;offset<Math.max(en.length,it.length);offset+=16)textSlide(label,en.slice(offset,offset+16),it.slice(offset,offset+16),++part);
   }continue;
  }
  const p=block.pair;if(!p?.en||!p?.it)continue;
  const head=block.heading;
  const en=wordsToLines((head?head.en+'\n':'')+p.en),it=wordsToLines((head?head.it+'\n':'')+p.it);
  let a=0,b=0;
  while(a<en.length||b<it.length){
   if(left.length>=15||right.length>=15)flush();
   if(left.length>0||right.length>0){left.push('');right.push('')}
   const cap=Math.min(16-left.length,16-right.length);
   if(cap<1){flush();continue}
   left.push(...en.slice(a,a+cap));right.push(...it.slice(b,b+cap));a+=cap;b+=cap;
   if(a<en.length||b<it.length)flush();
  }
 }
 flush();
}
function imageBounds(buffer,box){
 const w=buffer.readUInt32BE(16),h=buffer.readUInt32BE(20),scale=Math.min(box.w/w,box.h/h);
 return{x:box.x+(box.w-w*scale)/2,y:box.y+(box.h-h*scale)/2,w:w*scale,h:h*scale};
}
const cover=pres.addSlide();cover.background={color:C.green};
cover.addText('ITALIANO\nENGLISH',{x:.65,y:.65,w:6.2,h:1.65,fontFace:'Cambria',fontSize:42,bold:true,color:C.white,margin:0});
cover.addText('A source-linked bilingual study guide\nUna guida bilingue collegata alla fonte',{x:.65,y:2.8,w:11.8,h:.9,fontFace:'Arial',fontSize:24,color:C.white,margin:0});
cover.addShape(S.roundRect,{x:.65,y:4.35,w:11.8,h:1.45,rectRadius:.12,fill:{color:C.white},line:{color:C.white,width:0}});
cover.addText(filename,{x:.9,y:4.65,w:11.3,h:.95,fontFace:'Arial',fontSize:20,color:C.ink,margin:0});
cover.addText('Originals preserved · New parallel practice · Source page references\nOriginali conservati · Pratica parallela nuova · Riferimenti alle pagine',{x:.65,y:6.2,w:12,h:.7,fontFace:'Arial',fontSize:15,color:C.white,margin:0});
record.push({kind:'cover'});
for(const group of data.groups){
 const label=group.label;
 if(label.number){
  const image=path.join(data.cache,`source-${String(label.number).padStart(3,'0')}.png`),bytes=await fs.readFile(image);
  const slide=pres.addSlide();slide.background={color:C.white};
  slide.addImage({path:image,...imageBounds(bytes,{x:.35,y:.32,w:12.63,h:6.52})});footer(slide,`SOURCE ${label.number}`);
  const excerpts=group.blocks.filter(b=>b.kind==='source-excerpt').map(b=>b.text).join('\n\n');
  slide.addNotes(`Original source slide ${label.number}.\n${data.source.path}\n\n${excerpts}`);
  record.push({kind:'source',source_page:label.number});
  for(const media of data.source.media||[]){
   if(media.slide!==label.number||!media.path)continue;
   const mediaPath=path.resolve(root,media.path);
   if(!mediaPath.startsWith(path.join(root,'data/incoming/archive-companions')+path.sep))throw new Error('Media must remain in the private archive workspace');
   const clip=pres.addSlide();header(clip,'Class video · original embedded clip','Video del corso · filmato originale incorporato');
   clip.addMedia({type:media.type==='audio'?'audio':'video',path:mediaPath,x:1.1,y:1.5,w:11.1,h:4.95});
   footer(clip,`SOURCE ${label.number}`);clip.addNotes(JSON.stringify(media.note||{}));
   record.push({kind:'media',source_page:label.number,type:media.type});
  }
 }
 notesForGroup(label,group.blocks);
}
await pres.writeFile({fileName:data.output});
await fs.writeFile(path.join(data.cache,'deck-layout.json'),JSON.stringify({slides:record.length,records:record},null,2)+'\n');
console.log(JSON.stringify({nativeDeck:data.output,slides:record.length}));
