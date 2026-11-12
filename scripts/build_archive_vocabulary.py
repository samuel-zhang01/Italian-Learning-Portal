"""Build a simple Italian / word type / English course vocabulary CSV.

No network, credentials, learner databases or browser state are used. Native glossary
rows control translations. Companion/portal additions retain separate provenance.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
import re
import unicodedata
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT/'Organised'/'Organised'
PRIVATE = ROOT/'data'/'incoming'/'archive-companions'/'vocabulary'
WORKBOOK_REL = 'Course 2 — Consolidation (Apr 2026–present)/Reference Materials/Glossario_L1.xlsx'
GLOSSARY_REL = 'Course 2 — Consolidation (Apr 2026–present)/Week 02 — La Famiglia/Glossario L1.pdf'
EDITABLE = ('learner_status', 'learnt_on', 'learner_notes')
SIMPLE_FIELDS = ['italian', 'word_type', 'english']
FIELDS = ['entry_id','italian','lemma','english','part_of_speech','gender','plural','forms_seen',
          'example_it','example_en','example_provenance','first_observed_course','first_observed_week',
          'course_1_status','course_2_status','course_3_status','revisited_in_courses','course_priority','needed_for_course',
          'learner_status','learnt_on','learner_notes','provenance','translation_source','source_count',
          'source_locations','source_refs_json','glossary_unit_as_printed','notes']

def load(path):
    return json.loads(Path(path).read_text())

def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def normalize(text):
    text=unicodedata.normalize('NFC',str(text or '')).replace('’',"'").replace('‘',"'").casefold()
    text=re.sub(r'\s+',' ',text).strip()
    return re.sub(r'[.!?…]+$','',text).strip()

def term_key(text):
    text=normalize(text)
    return re.sub(r"^(?:il|lo|la|i|gli|le|un|uno|una)\s+|^(?:l'|un')",'',text) or text

def english_key(text):
    text=normalize(text)
    for a,b in [('traveller','traveler'),('colour','color'),('centre','center'),('cataloguing','cataloging'),('organise','organize')]:text=text.replace(a,b)
    return re.sub(r'^(?:the|a|an)\s+','',text)

def synonyms(text):
    return {english_key(x) for x in re.split(r'[,;/]',text) if english_key(x)}

def safe_text(text):
    text=unicodedata.normalize('NFC',str(text or '')).strip()
    if text.startswith(('=','+','-','@')):return "'"+text
    return text

def course_of(path):
    m=re.match(r'Course (\d)',path)
    return int(m[1]) if m else None

def week_of(path):
    m=re.search(r'/Week\s*0*(\d+)([a-z]?)',path,re.I)
    if not m:m=re.search(r'(?:L2_)?Week[_ ]*0*(\d+)',path,re.I)
    return int(m[1]) if m else None

def location_sort(ref):
    return (ref.get('course') or 99, ref.get('week') if ref.get('week') is not None else 999,
            ref['path'],ref.get('page') or 0,ref.get('row') or 0)

def ranges(values):
    result=[];start=last=None
    for value in sorted(set(values)):
        if start is None:start=last=value
        elif value==last+1:last=value
        else:
            result.append(str(start) if start==last else f'{start}-{last}');start=last=value
    if start is not None:result.append(str(start) if start==last else f'{start}-{last}')
    return ','.join(result)

class Register:
    def __init__(self, inventory):
        self.inventory=inventory
        self.entries=[]
        self.by_term=defaultdict(list)
        self.rejected=[]

    def add(self,it,en,*,kind,translation_source,ref=None,pos='',lemma='',gender='',plural='',example=None,example_provenance='',notes=''):
        it=unicodedata.normalize('NFC',str(it or '')).strip();en=unicodedata.normalize('NFC',str(en or '')).strip()
        if not it or not en:
            self.rejected.append({'italian':it,'english':en,'reason':'missing bilingual term'});return
        if len(it)>180 or '\n' in it or re.search(r'\b(?:____|TODO|lorem ipsum)\b',it,re.I):
            self.rejected.append({'italian':it,'english':en,'reason':'not a bounded vocabulary target'});return
        key=term_key(lemma or it)
        candidates=self.by_term[key]
        # Meaning overlap merges synonyms while preserving clearly different senses,
        # including supplied ci/La/Le/Lei entries.
        enkey=english_key(en)
        item=next((x for x in candidates if enkey in x['english_keys'] or synonyms(en)&x['english_synonyms']),None)
        if item is None:
            if not lemma:
                lemma=term_key(it) if not re.search(r'\s',term_key(it)) else it
            item={'italian':it,'lemma':lemma,'english':en,'english_keys':set(),'english_synonyms':set(),
                  'forms':set(),'pos':set(),'gender':set(),'plurals':set(),'kinds':set(),
                  'translation_sources':set(),'refs':{},'examples':[], 'notes':set(), 'units':set()}
            self.entries.append(item);candidates.append(item)
        item['english_keys'].add(enkey);item['english_synonyms']|=synonyms(en)
        item['forms'].add(it);item['kinds'].add(kind);item['translation_sources'].add(translation_source)
        if pos:item['pos'].add(pos)
        if gender:item['gender'].add(gender)
        if plural:item['plurals'].add(plural)
        if notes:item['notes'].add(notes)
        if ref:
            ref=dict(ref);ref.setdefault('course',course_of(ref['path']));ref.setdefault('week',week_of(ref['path']))
            identity=(ref['path'],ref.get('page'),ref.get('sheet'),ref.get('row'),ref.get('kind'))
            item['refs'][identity]=ref
        if example and example.get('it') and example.get('en'):
            pair=(example['it'],example['en'],example_provenance)
            if pair not in item['examples']:item['examples'].append(pair)
        return item


def source_extracts(inventory):
    result={}
    caches=[ROOT/'data/incoming/archive-ocr-review.json',
            ROOT/'data/incoming/archive-companions/course23/extracts.json',
            ROOT/'data/incoming/archive-companions/course1/extracts.json']
    for path in caches:
        if not path.exists():continue
        values=load(path)
        for value in values:
            name=value.get('path','')
            original=inventory.get(name)
            if original and value.get('sha256')==original['sha256']:
                result[name]=value
    # Each newly reviewed Course 1 document has a native-SHA-named private extract.
    for name,source in inventory.items():
        if not name.startswith('Course 1') or not name.endswith('.docx'):continue
        path=ROOT/'data/incoming/archive-companions/course1'/source['sha256'][:12]/'source-pages.json'
        if path.exists():
            for value in load(path):
                if value.get('sha256')==source['sha256']:result[name]={**value,'path':name,'page_basis':'reviewed DOCX PDF render'}
    # The parent/course agents provide additional current extracts under bounded paths.
    for directory in [ROOT/'data/incoming/week3',ROOT/'data/incoming/week4',ROOT/'data/incoming/week5-2026-11-12',ROOT/'data/incoming/escape-room-2026-11-12']:
        path=directory/'source-pages.json'
        if not path.exists():continue
        for value in load(path):
            matches=[name for name,source in inventory.items() if source['sha256']==value.get('sha256')]
            for name in matches:result.setdefault(name,{**value,'path':name})
    return result


def glossary_metadata(extract):
    result=defaultdict(list)
    if not extract:return result
    for page in extract.get('pages',[]):
        text=page.get('text','')
        # A real glossary headword is immediately followed by phonetics in brackets.
        for match in re.finditer(r"(?m)^['‘’]?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ’' &.-]{0,65}?)\s*\[([^\]\n]{1,140})\]",text):
            term=match.group(1).strip("'’‘ ")
            if len(term)<=2 and len(re.sub(r"[^a-z]", "", normalize(match.group(2))))>len(term)*2:
                continue  # OCR can truncate maiale to le; do not mislabel the pronoun.
            tail=text[match.end():].split('\n\n',1)[0][:300]
            posmatch=re.search(r'\b(nome plurale|nome|verbo|aggettivo|avverbio|preposizione|pronome|congiunzione|interiezione)\b',tail[:90],re.I)
            unitmatch=re.search(r'\((\d{1,2})\)',tail)
            pos={'nome':'noun','nome plurale':'plural noun','verbo':'verb','aggettivo':'adjective','avverbio':'adverb',
                 'preposizione':'preposition','pronome':'pronoun','congiunzione':'conjunction','interiezione':'interjection'}.get(posmatch.group(1).lower(),'') if posmatch else ''
            unit=int(unitmatch[1]) if unitmatch and 1<=int(unitmatch[1])<=12 else None
            result[term_key(term)].append({'page':page['page'],'pos':pos,'unit':unit,'headword':term})
    return result


def native_glossary(register,extracts):
    workbook=ARCHIVE/WORKBOOK_REL
    book=openpyxl.load_workbook(workbook,read_only=True,data_only=True)
    metadata=glossary_metadata(extracts.get(GLOSSARY_REL))
    count=0
    for sheet in book:
        for rownum,values in enumerate(sheet.iter_rows(values_only=True),1):
            if rownum==1:continue
            it,en=(str(values[i]).strip() if i<len(values) and values[i] is not None else '' for i in [0,1])
            if not it and not en:continue
            meta=metadata.get(term_key(it),[])
            positions={x['pos'] for x in meta if x['pos']}
            pos=' / '.join(sorted(positions))
            if not pos and en.startswith('to ') and re.search(r'(?:are|ere|ire|arsi|ersi|irsi)(?: \(di\))?$',it):pos='verb'
            if not pos and ' ' in it:pos='phrase'
            clarification=''
            if it in {'La','Le','Lei'}:
                source_en=en
                en={'La':'you (formal direct object)','Le':'to you (formal indirect object)','Lei':'you (formal subject)'}[it]
                pos='pronoun'
                clarification=f'Formal-pronoun function clarified from the supplied English gloss: {source_en}.'
            if it=='le':pos='article / pronoun'
            if it=='la':pos='article / pronoun'
            item=register.add(it,en,kind='class_glossary',translation_source='supplied_glossary',pos=pos,notes=clarification,
                              ref={'path':WORKBOOK_REL,'sha256':register.inventory[WORKBOOK_REL]['sha256'],'sheet':sheet.title,'row':rownum,'kind':'glossary_row','match':'exact supplied bilingual row'})
            count+=1
            if item:
                for entry in meta:
                    register.add(it,en,kind='class_glossary',translation_source='supplied_glossary',pos=pos,
                                 ref={'path':GLOSSARY_REL,'sha256':register.inventory[GLOSSARY_REL]['sha256'],'page':entry['page'],'kind':'glossary_headword','match':'exact headword before phonetics in supplied OCR'})
                    if entry['unit']:item['units'].add(str(entry['unit']))
    return count


def supplied_class_glossaries(register):
    path=PRIVATE/'source-vocabulary-additions.json'
    if not path.exists():return 0
    rows=load(path)
    for word in rows:
        source=register.inventory[word['path']]
        item=register.add(word['it'],word['en'],kind='class_text',translation_source=word.get('translation_source','supplied_class_glossary'),
                          pos=word.get('part_of_speech','noun' if word.get('gender') else ''),
                          lemma=word.get('lemma',''),gender=word.get('gender',''),plural=word.get('plural',''),notes=word.get('notes',''),
                          ref={'path':word['path'],'sha256':source['sha256'],'page':word['page'],'kind':'class_glossary_target',
                               'match':'reviewed supplied bilingual target; lemma/meaning clarifications noted',
                               'page_basis':'reviewed DOCX PDF render' if word['path'].endswith('.docx') else 'slide' if word['path'].endswith('.pptx') else 'physical_pdf'})
        if item:item['forms'].update(word.get('forms',[]))
    return len(rows)


def portal_vocabulary(register):
    read=lambda name:load(ROOT/'app/learning'/f'{name}.json')
    curriculum,grammar,enrichment,library,booster=[read(n) for n in ['curriculum','grammar','enrichment','vocab-library','booster-content']]
    source_by_id={x['id']:x for x in curriculum['sources']}
    forms={}
    for noun in booster['nouns']:
        key=term_key(noun['term']['it']);forms[key]={'lemma':key,'gender':noun['gender'],'plural':noun['plural'],'pos':'noun'}
        forms[term_key(noun['plural'])]=forms[key]
    for bank in enrichment['banks']+library['banks']:
        for noun in bank['words']:
            plural=noun.get('plural')
            if noun.get('partOfSpeech')!='noun' or not isinstance(plural,dict) or not plural.get('it'):continue
            base=term_key(noun['term']['it'])
            metadata={'lemma':base,'gender':noun.get('gender',''),'plural':plural['it'],'pos':'noun','canonical_en':noun['term']['en'],'plural_en':plural.get('en','')}
            forms.setdefault(base,metadata);forms.setdefault(term_key(plural['it']),metadata)
    imperative_lemmas={'sii':'essere','abbi':'avere',"di'":'dire','dì':'dire',"fa'":'fare',"va'":'andare',"da'":'dare',"sta'":'stare','ascolta':'ascoltare','prendi':'prendere','apri':'aprire','scrivi':'scrivere','aspetti':'aspettare','prenda':'prendere','senta':'sentire','vada':'andare','faccia':'fare','aspettate':'aspettare','prepariamo':'preparare'}
    for bank in enrichment['banks']+library['banks']:
        file='enrichment' if bank in enrichment['banks'] else 'vocab-library'
        for word in bank['words']:
            extra=forms.get(term_key(word['term']['it']),{})
            imperative_lemma=imperative_lemmas.get(normalize(word['term']['it']),'') if bank['id'].startswith('week5-') else ''
            meaning=extra.get('canonical_en') if extra.get('canonical_en') and english_key(word['term']['en'])==english_key(extra.get('plural_en','')) else word['term']['en']
            item=register.add(word['term']['it'],meaning,kind='portal_extension',translation_source='original_portal',
                              pos='verb form' if imperative_lemma else word.get('partOfSpeech') or extra.get('pos','phrase' if ' ' in word['term']['it'] else ''),
                              lemma=extra.get('lemma',imperative_lemma),gender=word.get('gender') or extra.get('gender',''),
                              plural=(word.get('plural',{}).get('it','') if isinstance(word.get('plural'),dict) else word.get('plural','')) or extra.get('plural',''),
                              example=word['example'],example_provenance='original_portal',
                              ref={'path':f'app/learning/{file}.json','catalogue_id':word['id'],'kind':'portal_extension','match':'authored portal vocabulary target','course':None,'week':None})
            # A source citation links a portal topic; it does not establish that
            # the exact authored phrase occurs in the class material.
            if item:
                for ref in word.get('sourceRefs',bank.get('sourceRefs',[])):
                    source=source_by_id.get(ref['id'])
                    if source and source['path'] in register.inventory:
                        item['notes'].add('Portal topic citation is not evidence that this exact expression occurs in the class source.')
    for unit in grammar['units']:
        for i,word in enumerate(unit['words']):
            raw=word['it']
            # Reminders such as "arrivare → arrivato" are grammar notation,
            # not a new lexical entry; the component forms are already taught.
            if '→' in raw:continue
            extra=forms.get(term_key(raw),{})
            register.add(raw,word['en'],kind='portal_extension',translation_source='original_portal',
                         pos=extra.get('pos','phrase' if ' ' in raw else ''),lemma=extra.get('lemma',''),
                         gender=extra.get('gender',''),plural=extra.get('plural',''),
                         ref={'path':'app/learning/grammar.json','catalogue_id':f'grammar-word:{unit["id"]}:{i}','kind':'portal_extension','match':'authored grammar vocabulary target','course':None,'week':None})
    for verb in booster['verbs']:
        register.add(verb['infinitive'],verb['meaning']['en'],kind='portal_extension',translation_source='original_portal',pos='verb',
                     example=verb['examples']['present'],example_provenance='original_portal',
                     ref={'path':'app/learning/booster-content.json','catalogue_id':verb['id'],'kind':'portal_extension','match':'authored verb catalogue','course':None,'week':None})
    return booster


def companion_vocabulary(register):
    inputs=[]
    for name in ['course1-content.json','course23-content.json']:
        path=ROOT/'data/incoming/archive-companions'/name
        if not path.exists():continue
        inputs.append(str(path.relative_to(ROOT)))
        for source in load(path).get('sources',[]):
            original=register.inventory.get(source['path'])
            if not original or source.get('sha256')!=original['sha256']:continue
            if original.get('administrative'):continue
            for page in source.get('pages',[]):
                for word in page.get('vocabulary',[]):
                    register.add(word.get('it'),word.get('en'),kind='class_text',translation_source='authored_companion',
                                 pos=word.get('part_of_speech',''),lemma=word.get('lemma',''),gender=word.get('gender',''),plural=word.get('plural',''),
                                 example={'it':word.get('example_it',''),'en':word.get('example_en','')},example_provenance='authored_companion',
                                 ref={'path':source['path'],'sha256':original['sha256'],'page':page['number'],'kind':'class_target','match':'source-reviewed companion vocabulary','page_basis':source.get('page_basis','')})
    return inputs


def literal_class_occurrences(register,extracts,booster):
    # Match trusted vocabulary rather than promote every OCR token to a word.
    # English lookalikes (e.g. in/to/do) need explicit glossary/companion evidence.
    # Other short Italian forms can be observed without disambiguating their senses.
    by_form=defaultdict(list)
    for item in register.entries:
        for form in [item['italian'],item['lemma'],*item['forms']]:
            norm=term_key(form)
            if (len(norm)>=2 or norm=='è') and norm not in {'in','to','do','it','me','no','on'} and len(norm)<=120 and not re.search(r'[/→_]',norm):by_form[norm].append(item)
    for verb in booster['verbs']:
        candidates=register.by_term.get(term_key(verb['infinitive']),[])
        if not candidates:continue
        forms=[verb['infinitive'],*verb['present'],verb['pastParticiple'],*verb.get('pastParticiples',[])]
        for form in forms:
            if len(normalize(form))>=2 and normalize(form) not in {'do'} or normalize(form)=='è':by_form[normalize(form)].extend(candidates)
    # Prefer exact phrase lengths and retain accents; no é/e or è/e folding.
    form_patterns=[(form,re.compile(r'(?<![\wÀ-ÿ])'+re.escape(form)+r'(?![\wÀ-ÿ])'),list({id(x):x for x in items}.values())) for form,items in by_form.items()]
    total=0
    for name,source in sorted(extracts.items()):
        if register.inventory[name].get('administrative') or name==GLOSSARY_REL:continue
        for page in source.get('pages',[]):
            text=normalize(re.sub(r'https?://\S+|www\.\S+', '', page.get('text','')))
            if not text:continue
            for form,pattern,items in form_patterns:
                if not pattern.search(text):continue
                for item in items:
                    ref={'path':name,'sha256':register.inventory[name]['sha256'],'page':page['page'],
                         'kind':'class_text_occurrence','match':'literal trusted form; not a sense-level teaching or mastery claim',
                         'course':course_of(name),'week':week_of(name),'matched_form':form,
                         'page_basis':source.get('page_basis','slide' if name.endswith('.pptx') else 'physical_pdf')}
                    key=(name,page['page'],None,None,'class_text_occurrence')
                    if key not in item['refs']:
                        item['refs'][key]=ref;total+=1
                    item['forms'].add(form)
                    item['kinds'].add('class_text')
    return total


def compact_refs(refs):
    groups={}
    for ref in refs:
        key=(ref['path'],ref.get('sha256',''),ref['kind'],ref.get('page_basis',''),ref.get('sheet',''))
        group=groups.setdefault(key,{'path':ref['path'],'kind':ref['kind']})
        if ref.get('sha256'):group['sha256']=ref['sha256']
        if ref.get('page_basis'):group['page_basis']=ref['page_basis']
        if ref.get('sheet'):group['sheet']=ref['sheet']
        if ref.get('page'):group.setdefault('_pages',[]).append(ref['page'])
        if ref.get('row'):group.setdefault('_rows',[]).append(ref['row'])
        if ref.get('catalogue_id'):group.setdefault('catalogue_ids',[]).append(ref['catalogue_id'])
    out=[]
    for group in groups.values():
        if '_pages' in group:group['pages']=ranges(group.pop('_pages'))
        if '_rows' in group:group['rows']=ranges(group.pop('_rows'))
        if 'catalogue_ids' in group:group['catalogue_ids']=sorted(set(group['catalogue_ids']))
        out.append(group)
    return sorted(out,key=lambda x:(x['path'],x['kind'],x.get('sheet','')))


def make_rows(register,old):
    result=[];duplicates=Counter()
    for item in sorted(register.entries,key=lambda x:(normalize(x['lemma']),english_key(x['english']))):
        # IDs depend on lexical sense, never row order or current source filename.
        entry_id='vocab-'+hashlib.sha256((term_key(item['lemma'])+'\0'+english_key(item['english'])).encode()).hexdigest()[:16]
        duplicates[entry_id]+=1
        refs=sorted(item['refs'].values(),key=location_sort)
        classrefs=[x for x in refs if x['kind'] in {'class_target','class_glossary_target'}]
        literalrefs=[x for x in refs if x['kind']=='class_text_occurrence']
        first=classrefs[0] if classrefs else None
        statuses={}
        for course in [1,2,3]:
            relevant=[x for x in refs if x.get('course')==course]
            statuses[course]='targeted_in_material' if any(x['kind'] in {'class_target','class_glossary_target'} for x in relevant) else 'literal_form_only' if any(x['kind']=='class_text_occurrence' for x in relevant) else 'listed_in_glossary' if relevant else 'not_observed'
        priority='class_target' if classrefs else 'class_form_only' if literalrefs else 'reference_glossary' if 'class_glossary' in item['kinds'] else 'supplementary_portal'
        compact=compact_refs(refs)
        human=[]
        for ref in compact:
            loc=f"sheet {ref['sheet']}, rows {ref.get('rows','')}" if ref.get('sheet') else f"pages/slides {ref['pages']}" if ref.get('pages') else 'catalogue '+','.join(ref.get('catalogue_ids',[]))
            human.append(ref['path']+' ['+loc+']')
        ex=item['examples'][0] if item['examples'] else ('','','')
        pos=set()
        for value in item['pos']:
            pos.update(x.strip() for x in re.split(r'\s*[/|]\s*',value) if x.strip())
        if 'expression' in pos:pos.remove('expression');pos.add('phrase')
        if pos-{'phrase'}:pos.discard('phrase')
        row={'entry_id':entry_id,'italian':item['italian'],'lemma':item['lemma'],'english':item['english'],
             'part_of_speech':' | '.join(sorted(pos)),'gender':' | '.join(sorted(item['gender'])),
             'plural':' | '.join(sorted(item['plurals'])),'forms_seen':' | '.join(sorted(item['forms'])),
             'example_it':ex[0],'example_en':ex[1],'example_provenance':ex[2],
             'first_observed_course':first.get('course','') if first else '',
             'first_observed_week':first.get('week','') if first and first.get('week') is not None else '',
             'course_1_status':statuses[1],'course_2_status':statuses[2],'course_3_status':statuses[3],
             'revisited_in_courses':','.join(str(c) for c in [1,2,3] if first and c>(first.get('course') or 99) and statuses[c]=='targeted_in_material'),
             'course_priority':priority,'needed_for_course':'yes' if priority=='class_target' else 'review' if priority=='class_form_only' else 'reference' if priority=='reference_glossary' else 'supplementary',
             'learner_status':'unconfirmed','learnt_on':'','learner_notes':'',
             'provenance':' | '.join(sorted(item['kinds'])),'translation_source':' | '.join(sorted(item['translation_sources'])),
             'source_count':len({x['path'] for x in refs}),
             'source_locations':'\n'.join(human),'source_refs_json':json.dumps(compact,ensure_ascii=False,separators=(',',':')),
             'glossary_unit_as_printed':','.join(sorted(item['units'],key=int)),
             'notes':' '.join(sorted(item['notes']))}
        if any(x['kind']=='class_text_occurrence' for x in refs):
            row['notes']=(row['notes']+' Literal presence does not prove that every listed sense was explicitly taught.').strip()
        for key in EDITABLE:
            if entry_id in old and key in old[entry_id]:row[key]=old[entry_id][key]
        result.append({key:safe_text(value) if key not in EDITABLE else value for key,value in row.items()})
    assert all(value==1 for value in duplicates.values()),'Duplicate vocabulary IDs'
    return result


def simple_word_type(row):
    """Resolve common glossary omissions without guessing from noun endings."""
    term=term_key(row['italian']).rstrip('!?….,')
    meanings=english_key(row['english'])
    if normalize(row['italian'])=='ci sono':return 'verb phrase'
    if normalize(row['italian'])=='uno / una':return 'number'
    if normalize(row['italian']) in {'la prendo','lo prendo'}:return 'phrase'
    if term=='loro' and 'subject pronoun' in meanings:return 'pronoun'
    if term=='bentornato':return 'interjection'
    if term in {'la','le','lo','gli'} and meanings=='the':return 'article'
    if term in {'la','le','lo','gli'} and row['english'].startswith('the;'):return 'article / pronoun'
    if term=='esatto' and not row['italian'].endswith('!'):return 'adjective'
    if term=='si' and meanings!='yes':return 'pronoun'
    if term=='abito' and meanings.startswith('i live'):return 'verb form'
    if term=='costa' and meanings=='costs':return 'verb form'
    if term=='sale' and meanings.startswith('goes up'):return 'verb form'
    if term=='fa' and meanings=='ago':return 'adverb'
    if term=='andata' and meanings=='one-way':return 'noun'
    if term=='sei' and meanings=='six':return 'number'
    if term=='primo' and meanings=='first':return 'ordinal number'
    if term=='piano' and 'quiet' not in meanings and 'slow' not in meanings:return 'noun'
    if term=='statunitense' and 'citizen' in meanings:return 'adjective / noun'
    groups={
        'noun': '''acca|accettazione|acquisizione|alloggio|ambasciata|amica|amico|anno|assicuratore|attesa|attico|aula|autista|azienda|ballerina|ballerino|ballo|bambina|barca|bibliotecario|bicchiere|biglietteria|bilocale|binario|bottega|bozza|cambiamento|cameriere|camomilla|candidatura|cantautore|capo classico|carabiniere|cartella|cartellone|catalogazione|cd|cestino|chiocciola|cibo|cioccolata|coca-cola|commesso|compito|condizione|consiglio|conto|cous-cous|cuoco|cura|data|desiderio|destinatario|disoccupato|equilibrio|esploratore|estetista|etichetta|etto|età|euro|farmacista|file|fotografa|galleria|gattina|gattino|gattona|gattone|gioiello|giornale|girocollo|impiego|imprevisto|incrocio|infanzia|infermiera|informatico|ingegnere|ingrediente|iniziativa|interruzione|intervallo|invitato|istruzione|labbro|laboratorio|lavagna|lettera|lettura|libero professionista|libreria|librone|litro|maiale|mail|mansarda|mare|materia|meccanico|merce|metro|mezz'ora|mezzogiorno|mocassino|modulo|motivo|nastro|nipote|nome|oliva|ora|origine|pacco|paese|paglia|palcoscenico|pallone|panificio|papà|parcheggio|parrucchiere|passaggio|passatempo|pausa pranzo|pc|pelle|pensione|pensionato|percorso|periferia|pesca|ping-pong|poliziotto|polso|porto|porzione|prova|quadro|quarto|reception|registrazione|requisito|residenza|ritardo|sala da pranzo|sapone|scadenza|scala|scialle|sci|scrivania|scusa|settore|sfondo|soffitta|soggiorno|soluzione|spazzolino|stampante|statua|suggerimento|supposizione|studentessa|taglia|tasso di occupazione|tassista|tavolino|tentativo|terrazza|tessera|tragitto|tv|viso|volontariato|water''',
        'plural noun': 'alimentari|anni|bambini|consigli|guanti|mani|occhi|occhiali|parenti|spese',
        'adjective': '''accogliente|affabile|alimentare|allegro|amaro|ammobiliato|animato|antico|aperto|azzurro|brasiliano|buono|caratteristico|castano|cinese|costoso|esatto|francese|grande|impegnato|importante|incluso|inglese|italiana|leggero|libero|luminoso|lunghissimo|magnifico|magro|migliore|muscoloso|necessario|nervoso|originale|piccolissimo|pratico|robusto|salato|sfortunato|sicuro|single|slanciato|spazioso|sposato|sportivo|stabile|statunitense|stretto|tranquillo''',
        'adverb': '''all'aperto|all'estero|all'improvviso|avantieri|bene|davvero|dritto|gentilmente|già|ieri|in ordine|invece|lentamente|lontano|magari|meglio|molto|recentemente|regolarmente|soprattutto|subito|tranquillamente''',
        'adverb / preposition': 'accanto|dopo|intorno|prima',
        'article': "il|l'|un|un'|una",
        'pronoun': 'altri|ci|la|le|li|lo|ne|nessuno|niente|qualcosa|qualcuno|quella',
        'pronoun / possessive': 'loro',
        'possessive': 'mia|mio|suo|tua|tuo|vostro',
        'preposition': 'fra|tra',
        'prepositional phrase': "all'università",
        'noun phrase': "dell'acqua",
        'pronominal verb': 'metterci|volerci',
        'conjunction': 'o|siccome|quindi',
        'conjunction / adverb': 'perché',
        'pronoun / conjunction': 'che',
        'article / pronoun': 'gli',
        'number': 'zero|due|tre|quattro|cinque|sette|otto|nove|dieci|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|diciotto|diciannove|venti|ventuno|ventidue|ventitre|ventitré|ventiquattro|venticinque|ventisei|ventisette|ventotto|ventinove|trenta|trentuno|quaranta|cinquanta|sessanta|settanta|ottanta|novanta|cento|duecento|trecento|mille|duemila',
        'number / article': 'uno',
        'determiner / pronoun / adverb': 'poco|tanto|troppo|tutto',
        'determiner / pronoun': 'molte|molti|quante',
        'adverb / determiner': "meno|po'",
        'noun / adjective': 'aereo|bucato|caldo|dolce|freddo|impiegato|malato|mezzo|particolare|personale|secondo|vicino',
        'noun / adverb': 'piano',
        'past participle': 'dormito|finito|fritto|lesso|ricevuto|studiato',
        'noun / past participle': 'andata',
        'verb form / adverb': 'fa',
        'proper noun': 'brasile|cina|egitto|francia|germania|giappone|grecia|inghilterra|italia|marocco|natale|polonia|portogallo|regno unito|spagna|svizzera',
        'interjection': "buongiorno|ciao|d'accordo|esatto|grazie|ok|peccato|prego|salve|scusi|si|sì",
        'abbreviation': 'd.c|ecc',
        'verb form': "abbi|apri|ascolta|aspettate|aspetti|c'è|conosco|da'|desidera|devo|di'|esco|fa'|faccia|posso|preferisci|preferisco|prenda|prendi|prepariamo|puoi|scrivi|sei|senta|siamo|siete|sii|so|sono|sta'|va'|vada|voglio|vorrei|è",
    }
    overrides={normalize(term):kind for kind,terms in groups.items() for term in terms.split('|')}
    # These identical spellings have different functions in the course examples.
    if term=='studio':return 'verb form' if meanings=='i study' else 'noun'
    if term=='lavoro':return 'verb form' if meanings=='i work' else 'noun'
    if term=='mezza':return 'number'
    if term in overrides:return overrides[term]
    types=[x.strip() for x in row['part_of_speech'].split(' | ') if x.strip()]
    if types and types!=['phrase']:
        return ' / '.join(dict.fromkeys(types))
    if re.match(r'^to\s',meanings) and re.search(r'(are|ere|ire|arsi|ersi|irsi|arsene|ersene|irsene|arcela|ercela|ircela)(?:\s*\(di\))?$',term):return 'verb'
    if re.match(r'^to\s',meanings) and re.match(r'^\S*(?:are|ere|ire|arsi|ersi|irsi)\s',term):return 'verb phrase'
    if re.match(r'^(?:fare|stare|parlare|prendere|avere|essere)\s',term):return 'verb phrase'
    if (not re.search(r'\s',term) and '?' not in row['italian']
            and not re.match(r'^(?:I|you|he|she|it|we|they)\s',row['english'],re.I)
            and re.match(r"^(?:il|lo|la|i|gli|le|un|uno|una)\s+|^(?:l['’]|un['’])",row['italian'],re.I)):
        return 'noun'
    if not re.search(r'\s',term) and re.match(r'^(?:the|a|an)\s',row['english'],re.I):return 'noun'
    return 'phrase' if re.search(r'\s|[!?]',row['italian']) else 'word'


def simple_rows(rows):
    result=[];seen=set()
    def append(it,word_type,en):
        identity=(normalize(it),word_type,english_key(en))
        if identity in seen:return
        seen.add(identity)
        result.append({'italian':it,'word_type':word_type,'english':en})
    for row in rows:
        it=row['italian'];en=row['english']
        if normalize(it)=='si' and normalize(en)=='yes':it='sì'
        if normalize(it)=='ventitre':it='ventitré'
        if term_key(it).rstrip('!')=='piacere':
            if it.endswith('!') or 'nice to meet' in en.lower() or 'pleased to meet' in en.lower():
                append('piacere!','phrase','nice to meet you')
            else:
                if 'to like' in en or 'pleasing' in en:
                    append('piacere','verb','to be pleasing; to like')
                if 'pleasure' in en or 'favour' in en or 'favor' in en:
                    append('il piacere','noun','pleasure; favour')
            continue
        clarifications={
            ('che','who, (cosa) that, (in domande) what'):'who; that; what',
            ('gli','the; him, (cosa) to them, them'):'the (masculine plural); to him; to them',
            ('la','the; her, it'):'the (feminine singular); her; it',
            ('le','the; them, (pronome indiretto = a lei) to her, her'):'the (feminine plural); them (feminine); to her',
            ('lo','the; (persona) him, (cosa) it'):'the (masculine singular); him; it',
            ('mezzo','half; (= strumento) means'):'half; means (method or instrument)',
            ('passaggio','(trasporto gratuito di una persona) lift'):'lift; ride',
            ('personaggio','(= persona famosa) personality, celebrity'):'personality; celebrity',
            ('pesca','(attività) fishing; (frutto) peach'):'fishing; peach',
            ('piano','(di un palazzo) floor; quietly, slowly'):'floor (of a building); quietly; slowly',
            ('piatto','(utensile) plate, dish, (= vivanda) dish, (= portata) course'):'plate; dish (food or tableware); course (of a meal)',
            ('secondo','(piatto, portata) main course; second'):'main course; second',
            ('uno','a, an; (numero) one'):'a/an (masculine); one',
            ('alimentari','food'):'food; groceries',
        }
        en=clarifications.get((normalize(it),en),en)
        en=en.replace('(+ nome)','(before a noun)').replace('(in risposta a «grazie») ', '')
        # The supplied bilingual glossary embeds Italian sense labels in its
        # English cells. Keep the English meanings and translate useful labels.
        en=re.sub(r'\s*\(=\s*[^)]+\)\s*',' ',en).strip()
        italian_labels={
            'lampo':'','gelato':'','arte':'art','universitaria':'university',
            'grammatica':'grammar','ufficiale':'official','di tempo':'time',
            'per uomo':'for men','per donna':'for women','per esposizioni':'exhibition',
            'a scuola':'at school','in bagno':'bathroom','negozio':'shop','mobile':'furniture',
            'indumenti':'clothing','di clima':'climate','di tipo':'type','lirica':'',
            'imbottito':'','per borse':'for bags','in risposte':'in answers',
            'vegetale':'','di edificio, ecc.':'of a building','di città, territorio, ecc.':'of a city or area',
            'di appartamento, ecc.':'of a flat','di cibo':'food','tradizionale':'traditional',
            'al telefono':'on the telephone','reparto':'','di indumento':'clothing',
            'dipinto':'','figura quadrata':'square shape','plurale':'plural',"nell'ora":'for telling the time',
            'fidanzata':'','fidanzato':'','di cellulare':'mobile phone','cucina':'cooking',
            'di montagna':'mountain','di caffè':'coffee','colore':'colour',
            'su un mezzo di trasporto':'transport','da un mezzo di trasporto':'transport',
            'calzatura':'footwear','cinematografico':'film','di moda':'fashion',
            'in un luogo':'in a place','stanza':'room','racconto':'','atmosferico':'',
            'della finestra':'window','un biglietto':'ticket','del volto':'face','a sedere':'',
        }
        for label,english in italian_labels.items():
            en=en.replace('('+label+')',('('+english+')') if english else '')
        en=re.sub(r'\s+',' ',en).strip()
        if term_key(it)=='da' and 'andare da' in en:en="from; at; to (someone's place)"
        if term_key(it)=='sapere' and en=='to know, can':en='to know; to know how to'
        if term_key(it)=='servire' and 'to be useful' in en:en='to serve; to be useful; to be needed'
        if term_key(it)=='orientale' and 'oriental' in en:en='eastern; Asian'
        if term_key(it)=='pronto' and 'hallo' in en:en='ready; hello (on the telephone)'
        word_type=simple_word_type({**row,'italian':it})
        append(it,word_type,en)
    return sorted(result,key=lambda row:(term_key(row['italian']),row['word_type'],english_key(row['english'])))


def validate(rows,inventory,extracts,glossary_count,inputs,prior):
    failures=[]
    ids=[row['entry_id'] for row in rows]
    if len(ids)!=len(set(ids)):failures.append('duplicate entry IDs')
    if any(not row['italian'] or not row['english'] or not row['lemma'] for row in rows):failures.append('missing core bilingual fields')
    refs_total=0
    for row in rows:
        for ref in json.loads(row['source_refs_json']):
            refs_total+=1
            if ref['kind']=='portal_extension':
                if not (ROOT/ref['path']).is_file():failures.append('missing portal catalogue '+ref['path'])
                continue
            source=inventory.get(ref['path'])
            if not source or source['sha256']!=ref.get('sha256'):failures.append('invalid source identity '+ref['path'])
            if ref.get('sheet') and ref['path']!=WORKBOOK_REL:failures.append('unexpected sheet source')
            if ref.get('pages') and ref['path'] in extracts:
                maximum=len(extracts[ref['path']].get('pages',[]))
                for segment in ref['pages'].split(','):
                    endpoints=[int(x) for x in segment.split('-')]
                    if any(x<1 or x>maximum for x in endpoints):failures.append('invalid page '+ref['path'])
    glossary_rows=set()
    for row in rows:
        for ref in json.loads(row['source_refs_json']):
            if ref['path']==WORKBOOK_REL and ref.get('sheet'):
                for segment in ref['rows'].split(','):
                    ends=[int(x) for x in segment.split('-')]
                    glossary_rows.update(range(ends[0],ends[-1]+1))
    if glossary_rows!=set(range(2,glossary_count+2)):failures.append('not all native glossary rows retained')
    protected=sum(1 for row in rows if row['entry_id'] in prior)
    assert all(all(row[k]==prior[row['entry_id']].get(k,'') for k in EDITABLE) for row in rows if row['entry_id'] in prior),'Learner edits changed'
    max_cell=max((len(str(value)) for row in rows for value in row.values()),default=0)
    if max_cell>32767:failures.append('cell exceeds Excel text limit')
    teaching=[name for name,s in inventory.items() if not s.get('administrative')]
    missing_extracts=[name for name in teaching if name not in extracts]
    observed=Counter()
    for name in teaching:
        observed[name]=sum(any(ref['path']==name for ref in json.loads(row['source_refs_json'])) for row in rows)
    return {'created_on':date.today().isoformat(),'grain':'one Italian lexical target and compatible English sense group',
            'rows':len(rows),'columns':len(FIELDS),'unique_entry_ids':len(set(ids)),
            'native_glossary_rows':glossary_count,'native_glossary_rows_retained':len(glossary_rows),'core_translation_missing':0,
            'part_of_speech_missing':sum(not r['part_of_speech'] for r in rows),
            'noun_gender_unspecified':sum('noun' in r['part_of_speech'] and not r['gender'] for r in rows),
            'original_examples_available':sum(bool(r['example_it']) for r in rows),
            'learner_status_counts':dict(Counter(r['learner_status'] for r in rows)),
            'priority_counts':dict(Counter(r['course_priority'] for r in rows)),
            'translation_source_counts':dict(Counter(x for r in rows for x in r['translation_source'].split(' | '))),
            'course_coverage':{str(c):dict(Counter(r[f'course_{c}_status'] for r in rows)) for c in [1,2,3]},
            'teaching_sources':len(teaching),'sources_with_current_extracts':len(teaching)-len(missing_extracts),
            'missing_extracts':missing_extracts,'vocabulary_rows_by_source':dict(observed),
            'sources_without_vocabulary_rows':[name for name,n in observed.items() if n==0],
            'companion_indexes_used':inputs,'source_reference_groups':refs_total,'max_cell_characters':max_cell,
            'existing_learner_rows_preserved':protected,'failures':sorted(set(failures)),
            'limitations':['Course presence and reference-glossary inclusion do not prove personal learning; learner_status starts unconfirmed.',
                           'Literal class-text matches may include English lookalikes in bilingual pages; they are marked class_form_only/review, not confirmed lexical targets or personal mastery.',
                           'POS and printed glossary units derived from OCR are included only where a known headword has a clear adjacent label; missing morphology is left blank.',
                           'The glossary’s printed unit numbers belong to that supplied source and are not asserted to match the portal’s Plus-edition chapter sequence.',
                           'Examples labelled original_portal or authored_companion are generated practice, not quotations from the supplied glossary.',
                           'Administrative maps/certificate and 36 legacy generated HTML notes are excluded from vocabulary authority.']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'Organised/vocab.csv')
    parser.add_argument('--include-literal-occurrences',action='store_true',help='Add optional private corpus-match diagnostics; these do not add vocabulary entries.')
    args=parser.parse_args()
    output=args.output.resolve()
    if not output.is_relative_to((ROOT/'Organised').resolve()):parser.error('Output must remain in private Organised/.')
    PRIVATE.mkdir(parents=True,exist_ok=True)
    originals=load(ROOT/'data/incoming/archive-companions/original-inventory.json')['sources']
    inventory={x['path']:x for x in originals}
    for name,source in inventory.items():
        if source.get('administrative'):continue
        path=ARCHIVE/name
        if not path.is_file():raise ValueError('Original missing: '+name)
        if hashlib.sha256(path.read_bytes()).hexdigest()!=source['sha256']:raise ValueError('Original changed: '+name)
    old={}
    detailed=PRIVATE/'vocab-detailed.csv'
    # Earlier versions put source metadata and optional personal notes in the
    # visible CSV. Retain that record privately while exporting only study fields.
    if output.exists():
        with output.open(encoding='utf-8-sig',newline='') as f:
            reader=csv.DictReader(f)
            if reader.fieldnames and 'entry_id' in reader.fieldnames:
                old={r['entry_id']:r for r in reader}
                if not detailed.exists():detailed.write_bytes(output.read_bytes())
    if not old and detailed.exists():
        with detailed.open(encoding='utf-8-sig',newline='') as f:old={r['entry_id']:r for r in csv.DictReader(f)}
    register=Register(inventory);extracts=source_extracts(inventory)
    glossary_count=native_glossary(register,extracts)
    supplied_class_glossaries(register)
    booster=portal_vocabulary(register)
    inputs=companion_vocabulary(register)
    if args.include_literal_occurrences:literal_class_occurrences(register,extracts,booster)
    rows=make_rows(register,old)
    current_ids={row['entry_id'] for row in rows}
    for entry_id,prior in old.items():
        edited=prior.get('learner_status','') not in {'','unconfirmed'} or prior.get('learnt_on','') or prior.get('learner_notes','')
        if entry_id not in current_ids and edited:
            retained={key:prior.get(key,'') for key in FIELDS}
            retained['course_priority']='retained_personal_record'
            retained['notes']=(retained['notes']+' Retained because it contains an earlier editable learner record; review any later lexical merge.').strip()
            rows.append(retained)
    quality=validate(rows,inventory,extracts,glossary_count,inputs,old)
    if quality['failures']:raise ValueError('Vocabulary checks failed: '+', '.join(quality['failures']))
    output.parent.mkdir(parents=True,exist_ok=True)
    with detailed.open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=FIELDS,quoting=csv.QUOTE_ALL);writer.writeheader();writer.writerows(rows)
    simple=simple_rows(rows)
    if any(not all(row.values()) for row in simple):raise ValueError('Simple CSV contains an empty study field')
    temporary=PRIVATE/'vocab.csv.tmp'
    with temporary.open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=SIMPLE_FIELDS,quoting=csv.QUOTE_ALL);writer.writeheader();writer.writerows(simple)
    temporary.replace(output)
    (PRIVATE/'vocab-detailed-quality.json').write_text(json.dumps(quality,ensure_ascii=False,indent=2)+'\n')
    summary={'updated':date.today().isoformat(),'rows':len(simple),'columns':SIMPLE_FIELDS,
             'missing_study_fields':sum(not all(row.values()) for row in simple),
             'duplicate_rows':len(simple)-len({tuple(row.values()) for row in simple}),
             'word_types':dict(Counter(row['word_type'] for row in simple)),
             'native_glossary_rows_included':quality['native_glossary_rows_retained'],
             'checks':quality['failures']}
    (PRIVATE/'vocab-quality.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
    previous_summary=output.parent/'vocab-quality.json'
    if previous_summary.exists():previous_summary.unlink()
    (output.parent/'vocab-readme.txt').write_text('VOCABULARY / VOCABOLARIO\n\nvocab.csv has three columns: italian, word_type, english.\nOpen it in Excel or LibreOffice Calc; Italian accents are preserved.\nThe list includes course words, useful expressions and portal practice vocabulary.\nDifferent meanings or grammatical functions can have separate rows.\n\nvocab.csv contiene tre colonne: italiano, categoria grammaticale e significato inglese.\nAprilo con Excel o LibreOffice Calc; gli accenti italiani sono conservati.\nLa lista comprende parole del corso, espressioni utili e lessico per la pratica del portale.\nSignificati o funzioni grammaticali diversi possono avere righe separate.\n')
    (PRIVATE/'rejected-candidates.json').write_text(json.dumps(register.rejected,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(summary))

if __name__=='__main__':main()
