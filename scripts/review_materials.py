"""Read only the supplied study folder; preserve physical page/slide numbering."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data' / 'incoming'
ALLOWED = (ROOT / 'materials', ROOT / 'Organised')

def run(args: list[str]) -> str:
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=180).stdout

def files(source: Path):
    for directory, folders, names in os.walk(source, followlinks=False):
        folders[:] = sorted(n for n in folders if not n.startswith('.') and n not in {'__MACOSX', '00 — Course Info'} and not (Path(directory)/n).is_symlink())
        for name in sorted(names):
            p = Path(directory)/name
            if not name.startswith('.') and not p.is_symlink() and p.suffix.lower() in {'.pdf', '.pptx'}:
                yield p

def slides(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as archive:
        names = sorted((n for n in archive.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', n)), key=lambda n:int(re.search(r'(\d+)\.xml', n)[1]))
        return [' '.join(t.text or '' for t in ET.fromstring(archive.read(n)).iter() if t.tag.endswith('}t')) for n in names]

def extract(path: Path, ocr: bool) -> list[dict]:
    with tempfile.TemporaryDirectory(prefix='italian-material-') as folder:
        temp = Path(folder)
        pdf = path
        if path.suffix.lower() == '.pptx':
            if not ocr:
                return [{'page':i, 'method':'slide-text', 'needs_visual_review':len(re.sub(r'\W','',text))<100, 'text':text} for i,text in enumerate(slides(path), 1)]
            run(['libreoffice', f'-env:UserInstallation={temp.as_uri()}/profile', '--headless', '--convert-to', 'pdf', '--outdir', str(temp), str(path)])
            pdf = temp / (path.stem+'.pdf')
        text = run(['pdftotext', '-layout', str(pdf), '-']).split('\f')
        if text and not text[-1].strip():
            text.pop()
        result=[]
        for page, value in enumerate(text,1):
            sparse = len(re.sub(r'\W','',value))<100
            method='text'
            if sparse and ocr:
                run(['pdftoppm','-f',str(page),'-l',str(page),'-r','150','-singlefile','-png',str(pdf),str(temp/'page')])
                value=run(['tesseract',str(temp/'page.png'),'stdout','-l','ita+eng'])
                method='ocr'
            result.append({'page':page, 'method':method, 'needs_visual_review':sparse, 'text':value.strip()})
        return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=ROOT/'materials'/'inbox')
    parser.add_argument('--ocr',action='store_true',help='OCR sparse pages; also render slides through LibreOffice')
    args=parser.parse_args()
    source=args.source.resolve()
    if not any(source.is_relative_to(a) and not a.is_symlink() for a in ALLOWED):
        parser.error('Choose a source inside this repository’s materials/ or Organised/ folder.')
    paths=list(files(source)) if source.is_dir() else []
    if not paths:
        parser.error('No PDFs or presentations found. Existing reports were left untouched.')
    needed=['pdftotext']+(['pdftoppm','tesseract'] if args.ocr else [])+(['libreoffice'] if args.ocr and any(p.suffix.lower()=='.pptx' for p in paths) else [])
    missing=[x for x in needed if not shutil.which(x)]
    if missing:
        parser.error('Missing tools: '+', '.join(missing))
    records=[]
    for p in paths:
        record={'path':p.relative_to(source).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
        try:
            record['pages']=extract(p,args.ocr)
        except (subprocess.SubprocessError, OSError, zipfile.BadZipFile, ET.ParseError) as error:
            record['error']=type(error).__name__  # Do not emit raw document/tool output.
        records.append(record)
    OUT.mkdir(parents=True,exist_ok=True)
    dest=OUT/'source-pages.json';temporary=OUT/'source-pages.tmp'
    temporary.write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
    temporary.replace(dest)
    summary={'files':len(records),'pages':sum(len(r.get('pages',[])) for r in records),'pages_needing_visual_review':sum(p['needs_visual_review'] for r in records for p in r.get('pages',[])),'failed_files':[r['path'] for r in records if 'error' in r],'report':'data/incoming/source-pages.json'}
    print(json.dumps(summary,ensure_ascii=False,indent=2))
    return bool(summary['failed_files'])

if __name__=='__main__':
    raise SystemExit(main())
