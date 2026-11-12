"""Verify and index private companions; optionally render native Office outputs for QA."""
from __future__ import annotations
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import html
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import unicodedata
import zipfile
from urllib.parse import quote

from build_archive_companions import ARCHIVE, PRIVATE, ROOT, WORK, build_fingerprint, digest, output_paths, read, safe_source, source_pdf, source_cache_key
import pymupdf as fitz
from PIL import Image, ImageDraw, ImageOps

OFFICE=Path('/root/.codex/skills/pptx/scripts/office')


def native_content_digest(path):
    checksum=hashlib.sha256()
    with zipfile.ZipFile(path) as package:
        for name in sorted(package.namelist()):
            if name=='docProps/core.xml':continue  # Creation/modification dates do not alter rendering.
            checksum.update(name.encode());checksum.update(package.read(name))
    return checksum.hexdigest()


def save(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')


def sources():
    return [s for name in ['course1-content.json','course23-content.json'] for s in read(PRIVATE/name)['sources']]


def contact_sheets(pdf,folder):
    folder.mkdir(parents=True,exist_ok=True)
    doc=fitz.open(pdf);paths=[]
    for start in range(0,len(doc),6):
        canvas=Image.new('RGB',(1600,1420),'#dde3df');draw=ImageDraw.Draw(canvas)
        for k,page in enumerate(doc.pages(start,min(start+6,len(doc)))):
            pix=page.get_pixmap(matrix=fitz.Matrix(.84,.84),alpha=False)
            im=Image.frombytes('RGB',[pix.width,pix.height],pix.samples)
            im=ImageOps.contain(im,(790,440))
            x=(k%2)*800+(800-im.width)//2;y=(k//2)*470+26
            canvas.paste(im,(x,y));draw.text(((k%2)*800+12,(k//2)*470+8),f'Slide {start+k+1}',fill='#18332c')
        path=folder/f'grid-{start//6+1:03}.jpg';canvas.save(path,quality=92);paths.append(str(path.relative_to(ROOT)))
    doc.close();return paths


def native_qa(source,result,resume):
    native=result['outputs'].get('native')
    if not native or Path(native['path']).suffix.lower() not in ['.pptx','.docx']:return None
    cache=WORK/'renders'/source_cache_key(source);qa=cache/'qa';qa.mkdir(exist_ok=True)
    report_path=qa/'native-qa.json'
    prior=None
    if resume and report_path.exists():
        prior=read(report_path)
        if prior.get('native_sha256')==native['sha256'] and prior.get('qa_version')==2 and prior.get('passed'):return prior
    original=ROOT/native['path'];ext=original.suffix.lower();package_digest=native_content_digest(original)
    rendered=qa/(original.stem+'.pdf')
    render_current=bool(prior and (prior.get('native_sha256')==native['sha256'] or prior.get('native_content_sha256')==package_digest) and prior.get('passed') and rendered.exists())
    if ext=='.pptx' and not render_current:
        check=subprocess.run([sys.executable,str(OFFICE/'validate.py'),str(original)],capture_output=True,text=True,timeout=120)
        (qa/'schema-validation.log').write_text(check.stdout+check.stderr)
        if check.returncode:raise ValueError('Office validation failed: '+native['path'])
    if not render_current:
        proc=subprocess.run([sys.executable,str(OFFICE/'soffice.py'),'--headless','--convert-to','pdf','--outdir',str(qa),str(original)],capture_output=True,text=True,timeout=600)
        (qa/'render.log').write_text(proc.stdout+proc.stderr)
        if proc.returncode or not rendered.exists():raise ValueError('Office render failed: '+native['path'])
    doc=fitz.open(rendered);pages=len(doc)
    if ext=='.pptx':
        from pptx import Presentation
        layout=read(cache/'deck-layout.json')
        if len(doc)!=layout['slides']:raise ValueError('Native slide render count differs')
        if any(max(r.get('lines',[0]))>16 for r in layout['records']):raise ValueError('Deck line budget exceeded')
        # Check visible text stays on the page. Source raster content has no new text spans.
        overflow=[]
        for number,page in enumerate(doc,1):
            for block in page.get_text('dict')['blocks']:
                for line in block.get('lines',[]):
                    for span in line['spans']:
                        x0,y0,x1,y1=span['bbox']
                        if x0<0 or y0<0 or x1>page.rect.width+1 or y1>page.rect.height+1:overflow.append(number)
        if overflow:raise ValueError('Rendered text outside native slide: '+str(overflow))
        # Independent render check: every generated text shape must survive export.
        # This catches text clipped inside a shape even when its box stays on-slide.
        key=lambda text:re.sub(r'[^\w]','',unicodedata.normalize('NFKC',text).casefold())
        missing=[]
        deck=Presentation(original)
        for number,(slide,page) in enumerate(zip(deck.slides,doc),1):
            rendered_text=key(page.get_text())
            for shape in slide.shapes:
                if not shape.has_text_frame:continue
                expected=key(shape.text)
                if expected and expected not in rendered_text:missing.append({'slide':number,'text':shape.text[:160]})
        if missing:
            save(qa/'missing-rendered-text.json',missing)
            raise ValueError('Generated text missing from native render: '+str(missing[:3]))
    doc.close()
    grids=contact_sheets(rendered,qa/'contact-sheets') if ext=='.pptx' else []
    visual=prior.get('visual_review','pending') if render_current else 'pending'
    report={'source':source['path'],'native_sha256':native['sha256'],'native_content_sha256':package_digest,'qa_version':2,'passed':True,'schema':'passed' if ext=='.pptx' else 'opened and rendered','rendered_text_completeness':'all generated text shapes found' if ext=='.pptx' else 'not compared','rendered_pages':pages,'rendered_pdf':str(rendered.relative_to(ROOT)),'contact_sheets':grids,'visual_review':visual if ext=='.pptx' else 'PDF companion layout checked separately'}
    save(report_path,report);return report


def verify(source):
    safe_source(source)
    cache=WORK/'renders'/source_cache_key(source);result=read(cache/'build-result.json')
    if result.get('build_fingerprint')!=build_fingerprint(source,True):raise ValueError('Stale companion: '+source['path'])
    expected={k for k,v in output_paths(source).items() if v}
    if set(result['outputs'])!=expected:raise ValueError('Missing format: '+source['path'])
    for item in result['outputs'].values():
        path=ROOT/item['path']
        if not path.is_file() or digest(path)!=item['sha256']:raise ValueError('Companion changed or missing: '+str(path))
    teaching=not source.get('administrative') and not source['path'].endswith('.xlsx')
    if teaching:
        pages=source['pages']
        if [p['number'] for p in pages]!=list(range(1,source['source_pages']+1)):raise ValueError('Incomplete page index')
        for page in pages:
            for ex in page.get('exercises',[]):
                for field in ['prompt','parallel_example','reason']:
                    if not all(ex.get(field,{}).get(lang) for lang in ['en','it']):raise ValueError('Missing exercise language: '+source['path'])
                if not ex.get('method') or not ex.get('self_check'):raise ValueError('Missing exercise method or check')
    pdf=fitz.open(ROOT/result['outputs']['pdf']['path']);originals={p['original_at'] for p in result['page_map'] if p['original_at']}
    overflow=[]
    for number,page in enumerate(pdf,1):
        if number in originals:continue
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines',[]):
                for span in line['spans']:
                    x0,y0,x1,y1=span['bbox']
                    if x0<0 or y0<0 or x1>page.rect.width+1 or y1>page.rect.height+1:overflow.append(number)
    if overflow:raise ValueError('PDF notes extend beyond page: '+source['path']+' '+str(overflow))
    original=source_pdf(source)
    if original is not None:
        for link in result['page_map']:
            if original[link['source_page']-1].get_text()!=pdf[link['original_at']-1].get_text():raise ValueError('Interleaved original text differs: '+source['path'])
        original.close()
    pdf.close();return result


def index(all_sources,results):
    folder=ROOT/'Organised';records=[];cards=[]
    esc=lambda s:html.escape(str(s),quote=True)
    link=lambda p:quote(os.path.relpath(p,folder))
    for source,result in zip(all_sources,results):
        links=[f'<a href="{link(ARCHIVE/source["path"])}">Original / Originale</a>']
        for kind,item in result['outputs'].items():links.append(f'<a href="{link(ROOT/item["path"])}">{esc({"pdf":"PDF guide / Guida PDF","html":"Read EN + IT / Leggi EN + IT","native":"Editable companion / Guida modificabile"}[kind])}</a>')
        count=len(source.get('pages',[]));exercises=sum(len(p.get('exercises',[])) for p in source.get('pages',[]))
        label='Administrative file / File amministrativo' if source.get('administrative') else 'Glossary workbook / Cartella di lavoro del glossario' if source['path'].endswith('.xlsx') else f'{count} source pages/slides · {exercises} explained task groups / {count} pagine/diapositive · {exercises} gruppi di attività spiegati'
        cards.append(f'<article data-search="{esc(source["path"]+" "+source["title"]["en"]+" "+source["title"]["it"])}"><h2>{esc(Path(source["path"]).name)}</h2><p>{esc(source["path"])}</p><p>{esc(label)}</p><nav>'+''.join(links)+'</nav></article>')
        records.append({'source':source['path'],'administrative':bool(source.get('administrative')),'source_pages':source['source_pages'],'exercise_groups':exercises,'outputs':result['outputs']})
    legacy=[p for p in ARCHIVE.rglob('*.html') if '__Companion_EN-IT' not in p.name and not p.name.startswith('Companion_Index')]
    legacy_html=''.join(f'<li><a href="{link(p)}">{esc(str(p.relative_to(ARCHIVE)))}</a></li>' for p in sorted(legacy))
    document='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Italian study companions · EN / IT</title><style>body{font:17px/1.6 system-ui,sans-serif;color:#18332c;max-width:1100px;margin:auto;padding:2rem}h1,h2{color:#164b3b}h1{font-size:2rem;line-height:1.2}h2{font-size:1.15rem;overflow-wrap:anywhere}article{border:1px solid #bfd5c7;border-radius:12px;padding:1.3rem;margin:1rem 0}article p{font-size:.92rem;overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;gap:.6rem}a{color:#164b3b}nav a{background:#eff6f1;border-radius:8px;padding:.6rem}input{box-sizing:border-box;width:100%;font:inherit;padding:.8rem;border:1px solid #7c9e8b;border-radius:8px}summary{cursor:pointer}label{display:block;margin:2rem 0 .5rem}[hidden]{display:none}li{overflow-wrap:anywhere}@media(max-width:600px){body{padding:1rem}}</style><h1>Italian study guides<br>Guide di italiano</h1><p>Choose a file for bilingual explanations, exercise methods, grammar and vocabulary.<br>Scegli un file per spiegazioni bilingui, metodi degli esercizi, grammatica e lessico.</p><p>Original files are preserved. Some listening tasks need the separate class audio.<br>Gli originali sono conservati. Alcuni ascolti richiedono l’audio separato del corso.</p><nav><a href="vocab.csv" download>Simple vocabulary CSV / Lessico semplice CSV</a><a href="vocab-readme.txt">Vocabulary guide / Guida al lessico</a></nav><label for="search">Find a course, week or file / Cerca corso, settimana o file</label><input id="search" type="search" placeholder="Week 5, grammar, Course 2…"><p id="count" aria-live="polite"></p>'''+''.join(cards)+f'<details><summary>{len(legacy)} older generated HTML notes / note HTML precedenti</summary><p>These older generated notes are retained separately and are not verified class sources.<br>Queste note precedenti sono conservate separatamente e non sono fonti verificate del corso.</p><ul>{legacy_html}</ul></details>'+'''<script>const input=document.querySelector('#search'),cards=[...document.querySelectorAll('article')];function filter(){const normalize=s=>s.toLocaleLowerCase().replace(/[_—–/]+/g,' ').replace(/(^| )0+([0-9])/g,'$1$2');const q=normalize(input.value);for(const c of cards)c.hidden=!normalize(c.dataset.search).includes(q);document.querySelector('#count').textContent=cards.filter(c=>!c.hidden).length+' / '+cards.length+' files · file'}input.addEventListener('input',filter);filter()</script></html>'''
    (folder/'Companion_Index_EN-IT.html').write_text(document)
    save(folder/'companion-index.json',{'created_at':datetime.now(timezone.utc).isoformat(),'native_sources':len(records),'companion_files':sum(len(r['outputs']) for r in records),'originals_preserved':True,'legacy_html_notes':len(legacy),'sources':records})


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--course',choices=['1','23']);parser.add_argument('--only');parser.add_argument('--native',action='store_true');parser.add_argument('--resume',action='store_true');parser.add_argument('--index',action='store_true');args=parser.parse_args()
    all_sources=sources();selected=[s for s in all_sources if (not args.course or (s['path'].startswith('Course 1') if args.course=='1' else not s['path'].startswith('Course 1'))) and (not args.only or args.only in s['path'])]
    results=[];native=[]
    for source in selected:
        result=verify(source);results.append(result)
        if args.native:
            qa=native_qa(source,result,args.resume)
            if qa:native.append(qa)
        print(json.dumps({'verified':source['path'],'native_rendered':bool(args.native and result['outputs'].get('native'))},ensure_ascii=False),flush=True)
    report={'checked_at':datetime.now(timezone.utc).isoformat(),'passed':True,'sources':len(results),'source_pages':sum(len(s.get('pages',[])) for s in selected if not s.get('administrative')),'exercise_groups':sum(len(p.get('exercises',[])) for s in selected for p in s.get('pages',[])),'companion_files':sum(len(r['outputs']) for r in results),'native_qa':native}
    save(WORK/f'qa-{args.course or "all"}.json',report)
    if args.index:
        if args.course or args.only:parser.error('--index requires the complete archive')
        expected=read(PRIVATE/'original-inventory.json')['sources']
        if {s['path']:s['sha256'] for s in expected}!={s['path']:s['sha256'] for s in all_sources}:raise ValueError('Original inventory coverage differs')
        index(all_sources,results)
    print(json.dumps({k:v for k,v in report.items() if k!='native_qa'},indent=2))


if __name__=='__main__':main()
