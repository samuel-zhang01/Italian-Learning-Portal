"""Build private, page-linked EN/IT companions beside the supplied class files.

Originals are checksum-checked and never renamed or modified. The output stays
under ignored Organised/. This tool is separate from the public website build.
"""
from __future__ import annotations
import argparse
import hashlib
import html
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / 'Organised' / 'Organised'
PRIVATE = ROOT / 'data' / 'incoming' / 'archive-companions'
WORK = ROOT / 'work' / 'archive-companions'
sys.path.insert(0, str(WORK / 'python-runtime'))
import pymupdf as fitz
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether

FONT_ROOT = Path('/usr/share/fonts/truetype/dejavu')
for name,file in [('Study','DejaVuSans.ttf'),('Study-Bold','DejaVuSans-Bold.ttf'),('Study-Italic','DejaVuSans-Oblique.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(FONT_ROOT/file)))
pdfmetrics.registerFontFamily('Study',normal='Study',bold='Study-Bold',italic='Study-Italic',boldItalic='Study-Bold')
GREEN=colors.HexColor('#164B3B'); INK=colors.HexColor('#18332C'); LIGHT=colors.HexColor('#EFF6F1'); ORANGE=colors.HexColor('#A85120')
STYLES=getSampleStyleSheet()
for key,size,leading in [('BodyText',9.5,14),('Normal',9.5,14),('Heading1',21,27),('Heading2',14,20),('Heading3',11,16)]:
    STYLES[key].fontName='Study-Bold' if key.startswith('Heading') else 'Study'
    STYLES[key].fontSize=size;STYLES[key].leading=leading;STYLES[key].textColor=INK;STYLES[key].spaceAfter=8
STYLES.add(ParagraphStyle('SmallStudy',fontName='Study',fontSize=8,leading=11,textColor=INK,spaceAfter=6))
STYLES.add(ParagraphStyle('CaptionStudy',fontName='Study',fontSize=8,leading=11,textColor=ORANGE,spaceAfter=6))


def read(path:Path):return json.loads(path.read_text())
def digest(path:Path):return hashlib.sha256(path.read_bytes()).hexdigest()
def source_cache_key(source):
    # Identical files can occur in different course folders (for example campus maps).
    return source['sha256'][:12]+'-'+hashlib.sha256(source['path'].encode()).hexdigest()[:8]
def build_fingerprint(source,native):
    code=digest(Path(__file__))+digest(ROOT/'scripts/build_archive_companion_deck.mjs')
    code+=digest(ROOT/'app/learning/grammar.json')
    content=json.dumps(source,ensure_ascii=False,sort_keys=True,separators=(',',':'))
    return hashlib.sha256((code+content+str(native)).encode()).hexdigest()
def pair(en:str,it:str):return {'en':en,'it':it}
def esc(value:Any):return html.escape(str(value or ''),quote=False).replace('\n','<br/>')
def para(value:Any,style='BodyText'):return Paragraph(esc(value),STYLES[style])
def normal(value:Any):return re.sub(r'\s+',' ',str(value or '')).strip()
def is_pair(value):return isinstance(value,dict) and isinstance(value.get('en'),str) and isinstance(value.get('it'),str)
def paragraph_pair(value:dict[str,str],label:str|None=None):
    if not is_pair(value):raise ValueError('Missing bilingual pair')
    cells=[]
    for lang in ['en','it']:
        title=f'<b>{lang.upper()}</b><br/>' if label is None else f'<b>{esc(label)} · {lang.upper()}</b><br/>'
        cells.append(Paragraph(title+esc(value[lang]),STYLES['BodyText']))
    table=Table([cells],colWidths=[250,250],hAlign='LEFT',splitByRow=1,splitInRow=1)
    table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,-1),LIGHT),('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
    return [table,Spacer(1,8)]


def grammar_units():return {u['id']:u for u in read(ROOT/'app/learning/grammar.json')['units']}
UNITS=grammar_units()

def page_label(source,page):
    basis=source.get('page_basis','').lower()
    if source['path'].lower().endswith('.pptx'):return pair(f'Source slide {page}',f'Diapositiva originale {page}')
    if source['path'].lower().endswith('.xlsx'):return pair(f'Source sheet {page}',f'Foglio originale {page}')
    if source['path'].lower().endswith('.docx'):return pair(f'Reviewed document render · page {page}',f'Documento renderizzato e verificato · pagina {page}')
    return pair(f'Source physical page {page}',f'Pagina fisica della fonte {page}')


def page_blocks(source,page):
    """One complete content stream also used by editable native companions."""
    blocks=[]
    title=page.get('title',pair('Study notes','Note di studio'))
    blocks.append({'kind':'title','pair':title})
    # Full teaching paragraphs live once in a file-level grammar reference.
    reference_text={normal(x[lang]) for uid in page.get('grammar_unit_ids',[]) for x in UNITS.get(uid,{}).get('teaching',[]) for lang in ['en','it']}
    explanations=[p for p in page.get('explanations',[]) if is_pair(p) and not all(normal(p[lang]) in reference_text for lang in ['en','it'])]
    for p in explanations:blocks.append({'kind':'explanation','pair':p})
    for uid in page.get('grammar_unit_ids',[]):
        if uid in UNITS:blocks.append({'kind':'rule','pair':UNITS[uid]['summary'],'heading':UNITS[uid]['title']})
    for index,exercise in enumerate(page.get('exercises',[]),1):
        locator=str(exercise.get('locator') or index)
        blocks.append({'kind':'exercise','heading':pair(f'Exercise {locator}',f'Esercizio {locator}'),'pair':exercise['prompt']})
        # The source item is retained verbatim in the interleaved original page.
        # Its excerpt gives a searchable item-level locator in the notes as well.
        if exercise.get('source_item_text'):blocks.append({'kind':'source-excerpt','text':exercise['source_item_text']})
        methods=exercise.get('method',[])
        if is_pair(methods):methods=[methods]
        for i,p in enumerate(methods,1):blocks.append({'kind':'method','heading':pair(f'Step {i}',f'Passo {i}'),'pair':p})
        if is_pair(exercise.get('parallel_example')):blocks.append({'kind':'example','heading':pair('New parallel example','Nuovo esempio parallelo'),'pair':exercise['parallel_example']})
        if is_pair(exercise.get('reason')):blocks.append({'kind':'reason','heading':pair('Why it works','Perché funziona'),'pair':exercise['reason']})
        for p in exercise.get('self_check',[]):blocks.append({'kind':'check','pair':p})
        blocks.append({'kind':'status','pair':pair('The source includes an answer or model; compare its language with the explanation.','La fonte contiene una risposta o un modello; confrontane la lingua con la spiegazione.') if exercise.get('source_answer_provided') else pair('Try the source task yourself. The parallel model uses changed details.','Svolgi tu l’attività originale. Il modello parallelo usa dettagli diversi.')})
    vocab=page.get('vocabulary',[])
    if vocab:
        blocks.append({'kind':'vocabulary','words':vocab[:12]})
        if len(vocab)>12:blocks.append({'kind':'note','pair':pair('The complete vocabulary for this file, with source-page references, is in the final glossary.','Il lessico completo di questo file, con i riferimenti alle pagine, si trova nel glossario finale.')})
    for key in ['coverage_note','uncertainty']:
        value=page.get(key)
        if is_pair(value):blocks.append({'kind':'note','pair':value})
    return blocks


def grammar_blocks(uid):
    unit=UNITS[uid];blocks=[{'kind':'title','pair':unit['title']},{'kind':'rule','pair':unit['summary']}]
    blocks.extend({'kind':'explanation','pair':p} for p in unit['teaching'])
    blocks.extend({'kind':'example','heading':pair('Worked language example','Esempio linguistico spiegato'),'pair':p} for p in unit['examples'])
    blocks.append({'kind':'vocabulary','words':[{'it':w['it'],'en':w['en']} for w in unit['words']]})
    return blocks


def blocks_story(blocks):
    story=[]
    for block in blocks:
        kind=block['kind']
        if kind=='title':
            story.extend([para(block['pair']['en'],'Heading1'),para(block['pair']['it'],'Heading2')]);continue
        heading=block.get('heading')
        if heading:story.append(para(heading['en']+' / '+heading['it'],'Heading3'))
        if kind=='source-excerpt':
            story.append(para('SOURCE / FONTE · '+block['text'],'SmallStudy'));continue
        if kind=='vocabulary':
            rows=[[para('Italiano','SmallStudy'),para('English','SmallStudy')]]
            for word in block['words']:
                if not word.get('it') or not word.get('en'):continue
                rows.append([para(word['it']),para(word['en'])])
            table=Table(rows,colWidths=[250,250],repeatRows=1,hAlign='LEFT',splitByRow=1,splitInRow=1)
            table.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#DCEAE1')),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5)]))
            story.extend([table,Spacer(1,10)]);continue
        if is_pair(block.get('pair')):story.extend(paragraph_pair(block['pair']))
    return story


def make_notes_pdf(source,blocks,label):
    buffer=io.BytesIO()
    doc=SimpleDocTemplate(buffer,pagesize=A4,rightMargin=47,leftMargin=47,topMargin=44,bottomMargin=47,title='EN–IT companion · '+source['title']['en'],author='Parliamo companion')
    story=[para(label['en']+' / '+label['it'],'CaptionStudy')]+blocks_story(blocks)
    def footer(canvas,document):
        canvas.saveState();canvas.setFont('Study',7);canvas.setFillColor(INK)
        canvas.drawString(47,25,'EN / IT · '+normal(label['en'])[:95]);canvas.drawRightString(A4[0]-47,25,str(document.page));canvas.restoreState()
    doc.build(story,onFirstPage=footer,onLaterPages=footer)
    return fitz.open(stream=buffer.getvalue(),filetype='pdf')


def safe_source(source):
    path=(ARCHIVE/source['path']).resolve()
    if not path.is_relative_to(ARCHIVE.resolve()) or path.is_symlink() or not path.is_file():raise ValueError('Source must be inside the supplied archive')
    if digest(path)!=source['sha256']:raise ValueError('Original source changed: '+source['path'])
    return path


def source_pdf(source):
    original=safe_source(source)
    if source.get('administrative'):return None
    if original.suffix.lower()=='.pdf':return fitz.open(original)
    rendered=source.get('rendered_pdf')
    if isinstance(rendered,dict):rendered=rendered.get('path')
    if rendered:
        path=Path(rendered);path=path if path.is_absolute() else ROOT/path
        if not path.resolve().is_relative_to(ROOT.resolve()):raise ValueError('Private render outside project')
        return fitz.open(path)
    return None


def output_paths(source):
    original=safe_source(source);stem=original.stem+'__Companion_EN-IT'
    # A file-format suffix prevents collisions between PDF/PPTX with equal stems.
    pdf_name=stem+('' if original.suffix.lower()=='.pdf' else '_'+original.suffix[1:].lower())+'.pdf'
    return {'pdf':original.with_name(pdf_name),'html':original.with_name(stem+'_'+original.suffix[1:].lower()+'.html'),'native':original.with_name(stem+original.suffix) if original.suffix.lower()!='.pdf' else None}


def cover_blocks(source):
    blocks=[{'kind':'title','pair':pair('Your bilingual study guide','La tua guida di studio bilingue')},{'kind':'explanation','pair':source['title']},{'kind':'note','pair':pair('Read each original page, then its English and Italian explanation. Exercise locators point back to that page. Grammar references at the end provide full rules, examples and vocabulary.','Leggi ogni pagina originale, poi la spiegazione in inglese e italiano. I riferimenti degli esercizi rimandano a quella pagina. I riferimenti grammaticali finali offrono regole complete, esempi e lessico.')},{'kind':'note','pair':pair('Original class files remain unchanged. Independent homework stays yours to attempt; worked companion models change the details. Supplied answer keys are identified as such. Listening tasks may require the original class audio.','I file originali restano invariati. I compiti autonomi restano da svolgere da te; i modelli spiegati cambiano i dettagli. I correttori forniti sono indicati come tali. Le attività d’ascolto possono richiedere l’audio originale.')},{'kind':'source-excerpt','text':source['path']+' · SHA-256 '+source['sha256']}]
    if source.get('administrative'):
        blocks=[{'kind':'title','pair':pair('Administrative reference','Riferimento amministrativo')},{'kind':'explanation','pair':pair('This file is not a language lesson. Personal certificate contents are not copied or analysed here. Keep the original document for its administrative purpose.','Questo file non è una lezione di lingua. Qui i contenuti personali dei certificati non vengono copiati né analizzati. Conserva il documento originale per il suo uso amministrativo.')},{'kind':'source-excerpt','text':source['path']+' · SHA-256 '+source['sha256']}]
    if source['path'].lower().endswith('.xlsx'):
        if is_pair(source.get('overview')):blocks.append({'kind':'explanation','pair':source['overview']})
        blocks.extend({'kind':'explanation','pair':p} for p in source.get('workbook_guide',[]) if is_pair(p))
    return blocks


def write_html(path,source,groups):
    chunks=[]
    for label,blocks in groups:
        chunks.append('<section><h2>'+esc(label['en'])+' / '+esc(label['it'])+'</h2>')
        for block in blocks:
            if block.get('heading'):chunks.append('<h3>'+esc(block['heading']['en'])+' / '+esc(block['heading']['it'])+'</h3>')
            if block['kind']=='vocabulary':chunks.append('<table><tr><th>Italiano</th><th>English</th></tr>'+''.join('<tr><td>'+esc(w.get('it'))+'</td><td>'+esc(w.get('en'))+'</td></tr>' for w in block['words'] if w.get('it') and w.get('en'))+'</table>')
            elif is_pair(block.get('pair')):chunks.append('<div class="pair"><p lang="en"><b>EN</b> '+esc(block['pair']['en'])+'</p><p lang="it"><b>IT</b> '+esc(block['pair']['it'])+'</p></div>')
            elif block.get('text'):chunks.append('<blockquote>'+esc(block['text'])+'</blockquote>')
        chunks.append('</section>')
    from urllib.parse import quote
    original_link=quote(safe_source(source).name)
    index_link=quote(os.path.relpath(ROOT/'Organised/Companion_Index_EN-IT.html',path.parent))
    navigation=f'<nav><a href="{index_link}">All companions / Tutte le guide</a> · <a href="{original_link}">Original file / File originale</a></nav>'
    document='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(source['title']['en'])+' · EN / IT</title><style>body{font:17px/1.65 system-ui,sans-serif;color:#18332c;max-width:1100px;margin:auto;padding:2rem;background:white;overflow-wrap:anywhere}h1,h2,h3{color:#164b3b}section{margin:2rem 0;padding:1.2rem;border:1px solid #cadbce;border-radius:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:2rem}.pair p{margin:.4rem 0}blockquote{background:#f3f6f4;padding:1rem;white-space:pre-wrap}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:.5rem;border-bottom:1px solid #cadbce}@media(max-width:650px){.pair{grid-template-columns:1fr;gap:.4rem}body{padding:1rem}}@media print{section{break-before:page;border:0}.pair{display:block}nav{display:none}}</style>'+navigation+'<h1>EN / IT · '+esc(source['title']['en'])+'</h1>'+''.join(chunks)+'</html>'
    path.write_text(document)


def write_docx(path,source,groups,source_document,cache):
    from docx import Document
    from docx.shared import Inches,Pt,RGBColor
    doc=Document();section=doc.sections[0];section.left_margin=Inches(.65);section.right_margin=Inches(.65)
    normal_style=doc.styles['Normal'];normal_style.font.name='Arial';normal_style.font.size=Pt(10)
    for label,blocks in groups:
        if len(doc.paragraphs)>1:doc.add_page_break()
        doc.add_heading(label['en']+' / '+label['it'],level=1)
        if label.get('number') and source_document is not None:
            i=int(label['number'])-1
            image=cache/f'source-{i+1:03}.png'
            if not image.exists():source_document[i].get_pixmap(matrix=fitz.Matrix(1.4,1.4),alpha=False).save(image)
            rect=source_document[i].rect
            width=min(6.7,8.0*rect.width/rect.height)
            doc.add_picture(str(image),width=Inches(width));doc.add_page_break()
        for block in blocks:
            if block.get('heading'):doc.add_heading(block['heading']['en']+' / '+block['heading']['it'],level=2)
            if block['kind']=='vocabulary':
                table=doc.add_table(rows=1, cols=2);table.style='Light Shading Accent 1';table.rows[0].cells[0].text='Italiano';table.rows[0].cells[1].text='English'
                for word in block['words']:
                    if word.get('it') and word.get('en'):
                        cells=table.add_row().cells;cells[0].text=word['it'];cells[1].text=word['en']
            elif is_pair(block.get('pair')):
                doc.add_paragraph('EN · '+block['pair']['en']);doc.add_paragraph('IT · '+block['pair']['it'])
            elif block.get('text'):doc.add_paragraph('SOURCE / FONTE · '+block['text'])
    doc.save(path)


def write_xlsx(path,source):
    import openpyxl
    from openpyxl.styles import Font,PatternFill,Alignment
    workbook=openpyxl.load_workbook(safe_source(source));name='EN-IT Companion'
    if name in workbook.sheetnames:name='EN-IT Companion guide'
    sheet=workbook.create_sheet(name,0)
    rows=[('English','Italiano'),('Use the original glossary sheets as course vocabulary evidence.','Usa i fogli originali del glossario come prova del lessico del corso.'),('Use Organised/vocab.csv for a simple list of Italian words, word types and English meanings.','Usa Organised/vocab.csv per una lista semplice di parole italiane, categorie grammaticali e significati inglesi.'),('Read the adjacent PDF/HTML companion for grammar and exercise explanations.','Leggi la guida PDF/HTML accanto per grammatica e spiegazioni degli esercizi.')]
    rows.extend((p['en'],p['it']) for p in source.get('workbook_guide',[]) if is_pair(p))
    for row in rows:sheet.append(row)
    sheet.column_dimensions['A'].width=70;sheet.column_dimensions['B'].width=70
    for cell in sheet[1]:cell.font=Font(bold=True,color='FFFFFF');cell.fill=PatternFill('solid',fgColor='164B3B')
    for row in sheet.iter_rows():
        for cell in row:cell.alignment=Alignment(wrap_text=True,vertical='top')
    for i in range(2,len(rows)+1):
        longest=max(len(str(cell.value or '')) for cell in sheet[i])
        sheet.row_dimensions[i].height=max(45,16*(longest//60+1)+10)
    workbook.save(path)


def build(source,native=True):
    original=safe_source(source);paths=output_paths(source);cache=WORK/'renders'/source_cache_key(source);cache.mkdir(parents=True,exist_ok=True)
    if not source.get('administrative') and original.suffix.lower()!='.xlsx':
        numbers=[p['number'] for p in source.get('pages',[])]
        if numbers!=list(range(1,source['source_pages']+1)):raise ValueError('Incomplete or unordered page coverage: '+source['path'])
    original_pdf=source_pdf(source)
    groups=[(pair('How to use this companion','Come usare questo compagno'),cover_blocks(source))]
    output=fitz.open();cover=make_notes_pdf(source,groups[0][1],groups[0][0]);output.insert_pdf(cover);cover.close();toc=[];page_map=[]
    used=[]
    for page in source.get('pages',[]):
        number=page['number'];label=page_label(source,number);label['number']=number
        if original_pdf is not None:
            if not isinstance(number,int) or number<1 or number>len(original_pdf):raise ValueError('Page outside original render')
            original_at=len(output)+1;output.insert_pdf(original_pdf,from_page=number-1,to_page=number-1)
        else:original_at=None
        blocks=page_blocks(source,page);notes=make_notes_pdf(source,blocks,label);notes_at=len(output)+1;output.insert_pdf(notes);notes.close()
        groups.append((label,blocks));page_map.append({'source_page':number,'original_at':original_at,'notes_at':notes_at})
        toc.append([1,label['en']+' / '+label['it'],original_at or notes_at])
        for uid in page.get('grammar_unit_ids',[]):
            if uid in UNITS and uid not in used:used.append(uid)
    vocabulary={}
    for page in source.get('pages',[]):
        for word in page.get('vocabulary',[]):
            if not word.get('it') or not word.get('en'):continue
            key=(word['it'],word['en']); item=vocabulary.setdefault(key,{**word,'source_pages':[]})
            if page['number'] not in item['source_pages']:item['source_pages'].append(page['number'])
    if vocabulary:
        words=[]
        for word in vocabulary.values():
            word=dict(word);word['en']+=' · '+str(word['source_pages']);words.append(word)
        label=pair('Complete vocabulary for this source','Lessico completo di questa fonte');blocks=[{'kind':'vocabulary','words':words}];doc=make_notes_pdf(source,blocks,label);toc.append([1,label['en'],len(output)+1]);output.insert_pdf(doc);doc.close();groups.append((label,blocks))
    for uid in used:
        label=pair('Grammar reference · '+UNITS[uid]['title']['en'],'Riferimento grammaticale · '+UNITS[uid]['title']['it']);blocks=grammar_blocks(uid);doc=make_notes_pdf(source,blocks,label)
        toc.append([1,label['en'],len(output)+1]);output.insert_pdf(doc);doc.close();groups.append((label,blocks))
    # Preserve the complete bilingual source glossary in a readable table.
    if original.suffix.lower()=='.xlsx':
        import openpyxl
        book=openpyxl.load_workbook(original,data_only=True,read_only=True)
        for sheet in book:
            words=[]
            for row in sheet.iter_rows(min_row=2,values_only=True):
                if len(row)>1 and row[0] and row[1]:words.append({'it':str(row[0]),'en':str(row[1])})
            if words:
                label=pair('Complete source glossary · '+sheet.title,'Glossario completo della fonte · '+sheet.title);blocks=[{'kind':'vocabulary','words':words}];doc=make_notes_pdf(source,blocks,label);toc.append([1,label['en'],len(output)+1]);output.insert_pdf(doc);doc.close();groups.append((label,blocks))
        book.close()
    output.set_metadata({'title':source['title']['en']+' · EN/IT companion','author':'Parliamo companion','subject':'Private class study notes; originals preserved','keywords':'Italian, English, companion, '+source['sha256']})
    if toc:output.set_toc(toc)
    output.save(paths['pdf'],garbage=4,deflate=True);pdf_pages=len(output);output.close()
    write_html(paths['html'],source,groups)
    if native and original.suffix.lower()=='.pptx' and original_pdf is not None:
        for i in range(len(original_pdf)):
            image=cache/f'source-{i+1:03}.png'
            if not image.exists():original_pdf[i].get_pixmap(matrix=fitz.Matrix(1.6,1.6),alpha=False).save(image)
    payload={'source':source,'groups':[{'label':label,'blocks':blocks} for label,blocks in groups],'original_pdf':str(original_pdf.name) if original_pdf is not None else None,'output':str(paths['native']) if paths['native'] else None,'cache':str(cache)}
    payload_path=cache/'payload.json';payload_path.write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
    if native and paths['native']:
        if original.suffix.lower()=='.pptx':subprocess.run(['node',str(ROOT/'scripts/build_archive_companion_deck.mjs'),str(payload_path)],check=True,timeout=300)
        elif original.suffix.lower()=='.docx':write_docx(paths['native'],source,groups,original_pdf,cache)
        elif original.suffix.lower()=='.xlsx':write_xlsx(paths['native'],source)
    if original_pdf is not None:original_pdf.close()
    if digest(original)!=source['sha256']:raise ValueError('Original changed during companion build')
    result={'source':source['path'],'source_sha256':source['sha256'],'source_pages':source['source_pages'],'build_fingerprint':build_fingerprint(source,native),'native_requested':native,'companion_pdf_pages':pdf_pages,'page_map':page_map,'grammar_references':used,'outputs':{k:{'path':str(v.relative_to(ROOT)),'sha256':digest(v),'bytes':v.stat().st_size} for k,v in paths.items() if v and v.exists() and (native or k!='native')}}
    (cache/'build-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--content',type=Path,action='append');parser.add_argument('--only');parser.add_argument('--pdf-only',action='store_true');parser.add_argument('--resume',action='store_true');args=parser.parse_args()
    paths=args.content or [PRIVATE/'course1-content.json',PRIVATE/'course23-content.json'];sources=[]
    for path in paths:
        if not path.exists():continue
        sources.extend(read(path)['sources'])
    if not sources:parser.error('No reviewed source content is available')
    results=[]
    for source in sources:
        if args.only and args.only not in source['path']:continue
        result_path=WORK/'renders'/source_cache_key(source)/'build-result.json'
        if args.resume and result_path.exists():
            result=read(result_path)
            expected=output_paths(source)
            expected_keys={k for k,v in expected.items() if v and (not args.pdf_only or k!='native')}
            if result.get('build_fingerprint')==build_fingerprint(source,not args.pdf_only) and set(result['outputs'])==expected_keys and all((ROOT/v['path']).is_file() and digest(ROOT/v['path'])==v['sha256'] for v in result['outputs'].values()):results.append(result);continue
        result=build(source,native=not args.pdf_only);results.append(result);print(json.dumps({'source':source['path'],'pdf_pages':result['companion_pdf_pages'],'outputs':list(result['outputs'])},ensure_ascii=False),flush=True)
    WORK.mkdir(parents=True,exist_ok=True);dest=WORK/('build-results-'+hashlib.sha256('|'.join(str(p) for p in paths).encode()).hexdigest()[:8]+'.json');dest.write_text(json.dumps({'built_sources':len(results),'sources':results},ensure_ascii=False,indent=2)+'\n')
    return 0
if __name__=='__main__':raise SystemExit(main())
