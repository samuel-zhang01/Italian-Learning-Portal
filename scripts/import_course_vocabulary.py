"""Project the approved three-column word list into public vocabulary targets.

The input stays private. Only Italian/English lexical pairs, word types, explicit
answers and stable identities are emitted; no archive paths or source excerpts.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'app' / 'learning'
DESTINATION = APP / 'course-vocabulary.json'


def read(name):
    return json.loads((APP / (name + '.json')).read_text())


def normalise(value):
    value = unicodedata.normalize('NFC', str(value)).strip().lower().replace('’', "'").replace('‘', "'")
    return re.sub(r'\s+', ' ', re.sub(r'[.!?,;:]+$', '', value)).strip()


def english_key(value):
    value = normalise(value)
    value = re.sub(r'\((?:masculine|feminine|masculine\s*/\s*feminine)\)', '', value)
    value = re.sub(r'^(?:the|a|an)\s+', '', value)
    return re.sub(r'\s+', ' ', value).strip()


def english_senses(value):
    # A slash inside a gender note is not a second English meaning.
    value = re.sub(r'\((?:masculine|feminine|masculine\s*/\s*feminine)\)', '', value, flags=re.I)
    return tuple(sorted(set(english_key(part) for part in re.split(r'[,;/]', value) if english_key(part))))


def noun_key(value):
    return re.sub(r"^(?:(?:il|lo|la|i|gli|le|un|uno|una)\s+|l'|un')", '', normalise(value))


def answers_for(italian):
    """Slash alternatives are complete targets, never dangling participles."""
    pieces = [part.strip() for part in italian.split('/') if part.strip()]
    if len(pieces) > 1 and pieces[0].startswith('sono '):
        pieces = [part if part.startswith('sono ') else 'sono ' + part for part in pieces]
    return list(dict.fromkeys(pieces))


def category(part):
    if re.search(r'\bverb\b', part) or 'participle' in part:
        return 'verbs'
    if re.search(r'\bnoun\b', part):
        return 'nouns'
    if 'adjective' in part or 'possessive' in part:
        return 'describing'
    if part == 'adverb':
        return 'adverbs'
    if 'phrase' in part or part in {'interjection', 'idiom'}:
        return 'expressions'
    if 'number' in part:
        return 'numbers'
    return 'connections'


GROUPS = {
    'nouns': ('Names for your world', 'Nomi per il tuo mondo', 'People, places and things from your course word list.', 'Persone, luoghi e cose dal lessico del corso.'),
    'verbs': ('Put words in motion', 'Parole in movimento', 'Infinitives, useful verb forms and verb phrases.', 'Infiniti, forme verbali utili e locuzioni verbali.'),
    'describing': ('Paint a picture', 'Dipingi con le parole', 'Adjectives and words that help describe people and things.', 'Aggettivi e parole per descrivere persone e cose.'),
    'adverbs': ('Add a little detail', 'Aggiungi un dettaglio', 'Words for how, when and how often.', 'Parole per dire come, quando e quanto spesso.'),
    'expressions': ('Say a little more', 'Di’ qualcosa in più', 'Useful phrases, greetings and everyday expressions.', 'Frasi utili, saluti ed espressioni quotidiane.'),
    'numbers': ('Make it count', 'Dai i numeri', 'Numbers and ordering words from the course.', 'Numeri e parole per ordinare dal corso.'),
    'connections': ('Small words, big meaning', 'Piccole parole, grandi significati', 'Pronouns, articles and the words that connect a sentence.', 'Pronomi, articoli e parole che collegano una frase.'),
}

TYPE_CLARIFICATIONS = {
    'uno / due': 'number',
    'piccolo / piccola': 'adjective', 'nuovo / nuova': 'adjective',
    'rosso / rossa': 'adjective', 'vecchio / vecchia': 'adjective',
    'italiano / italiana': 'adjective / noun',
    'sono andato / andata': 'verb form', 'sono arrivato / arrivata': 'verb form',
}

# Dictionary cues that otherwise conceal different senses or grammatical roles.
# These are short meaning clarifications, not invented usage examples.
CUE_CLARIFICATIONS = {
    ('bigliettino', 'card'): 'small card; note',
    ('scheda', 'card'): 'card (information or record)',
    ('la tessera', 'card'): 'membership card; pass',
    ('bosco', 'wood'): 'wood; forest', ('legno', 'wood'): 'wood (material)',
    ('crema', 'cream'): 'cream (cosmetic or food preparation)', ('panna', 'cream'): 'cream (dairy)',
    ('esercizio', 'exercise'): 'exercise (task)', ('ginnastica', 'exercise'): 'gymnastics; physical exercise',
    ('foglio', 'sheet'): 'sheet (of paper)', ('lenzuolo', 'sheet'): 'sheet (for a bed)',
    ('freddo', 'cold'): 'cold (temperature)', ('raffreddore', 'cold'): 'a cold (illness)',
    ('giurisprudenza', 'law'): 'law (field of study)', ('legge', 'law'): 'law (rule)',
    ('località', 'place'): 'locality; location', ('luogo', 'place'): 'place',
    ('misura', 'size'): 'size; measurement', ('taglia', 'size'): 'size (clothing)',
    ('modo', 'way'): 'way (method)', ('percorso', 'way'): 'way; route',
    ('pallina', 'ball'): 'small ball', ('pallone', 'ball'): 'large ball',
    ('periodo', 'time'): 'period of time', ('volta', 'time'): 'time (occurrence)',
    ('pittura', 'painting'): 'painting (art or activity)', ('tela', 'painting'): 'painting (canvas)',
    ('tappetino', 'carpet'): 'small rug; mat', ('tappeto', 'carpet'): 'carpet; rug',
    ('te', 'you'): 'you (informal object)', ('tu', 'you'): 'you (informal singular subject)',
    ('voi', 'you'): 'you (plural subject)',
    ('abitare', 'to live'): 'to live (reside)', ('vivere', 'to live'): 'to live; be alive',
    ('cambiare', 'to change'): 'to change (something)', ('cambiarsi', 'to change'): 'to get changed (clothes)',
    ('giocare', 'to play'): 'to play (a game)', ('suonare', 'to play'): 'to play (an instrument)',
    ('spendere', 'to spend'): 'to spend (money)', ('trascorrere', 'to spend'): 'to spend (time)',
    ('azzurro', 'blue'): 'light blue', ('blu', 'blue'): 'blue; dark blue',
    ('castano', 'brown'): 'brown (hair)', ('marrone', 'brown'): 'brown (colour)',
    ('doppio', 'double'): 'double (quantity)', ('matrimoniale', 'double'): 'double (for a bed); marital',
    ('scorso', 'last'): 'last (previous)', ('ultimo', 'last'): 'last (final)',
    ('single', 'single'): 'single (unmarried)', ('singolo', 'single'): 'single; individual',
    ('tuo', 'your'): 'your (one possessor; masculine singular)',
    ('vostro', 'your'): 'your (plural possessors; masculine singular)',
    ('camera doppia', 'double room'): 'double room (two guests)',
    ('camera matrimoniale', 'double room'): 'room with a double bed',
    ('mi raccomando', 'please'): 'please make sure; I am counting on you',
    ('il', 'the'): 'the (masculine singular)', ("l'", 'the'): 'the (before a vowel)',
}

# Only reviewed equivalents share accepted answers. English homographs such as
# wood/material vs wood/forest never create aliases through string matching.
SAFE_ALIASES = {
    'company': ['azienda', 'compagnia'], 'desk': ['banco', 'scrivania'],
    'need': ['bisogno', 'esigenza'], 'bracelet': ['bracciale', 'braccialetto'],
    'dancer': ['ballerina', 'ballerino'], 'chocolate': ['cioccolata', 'cioccolato'],
    'cousin': ['cugina', 'cugino'], 'e-mail': ['e-mail', 'mail'],
    'day': ['giornata', 'giorno'], 'hobby': ['hobby', 'passatempo'],
    'model': ['indossatrice', 'modella'], 'nurse': ['infermiera', 'infermiere'],
    'guest': ['invitato', 'ospite'], 'south': ['meridione', 'sud'],
    'north': ['nord', 'settentrione'], 'view': ['panorama', 'vista'],
    'teacher': ['professore', 'professoressa'], 'evening': ['sera', 'serata'],
    'to go to bed': ['andare a dormire', 'andare a letto'],
    'to go shopping': ['fare shopping', 'fare spese'], 'to meet': ['incontrarsi', 'vedersi'],
    'to come back': ['rientrare', 'ritornare', 'tornare'],
    'furnished': ['ammobiliato', 'arredato'], 'famous': ['celebre', 'famoso'],
    'happy': ['contento', 'felice'], 'different': ['differente', 'diverso'],
    'big': ['grande', 'grosso'], 'wonderful': ['meraviglioso', 'stupendo'],
    'really': ['davvero', 'veramente'], 'how are you?': ['come stai?', 'come va?'],
    'where are you from?': ["di dov'è?", 'Di dove sei?'],
    'e-mail address': ['indirizzo di posta elettronica', 'indirizzo e-mail'],
    'vegetable soup': ['minestrone di verdure', 'zuppa di verdure'],
    'boiled potatoes': ['patate bollite', 'patate lesse'], 'and': ['e', 'ed'],
    'car': ['auto', 'macchina', 'automobile'],
}
SAFE_ALIASES = {english_key(key): forms for key, forms in SAFE_ALIASES.items()}


def existing_targets():
    library, enrichment, grammar, booster = [read(name) for name in ['vocab-library', 'enrichment', 'grammar', 'booster-content']]
    targets = []
    keys = set()
    paired = {
        'word:identity:4': ['italiano', 'italiana'], 'word:numbers:0': ['uno', 'una'],
        'word:past:4': ['sono andato', 'sono andata'], 'word:past:5': ['sono arrivato', 'sono arrivata'],
        'word:clothes:4': ['rosso', 'rossa'], 'word:clothes:6': ['piccolo', 'piccola'],
        'word:body:0': ['la mano', 'le mani'], 'word:body:1': ['il dente', 'i denti'],
    }
    for bank in library['banks'] + enrichment['banks']:
        for word in bank['words']:
            targets.append({'id': word['id'], 'term': word['term'], 'answers': word.get('answers') or paired.get(word['id']) or [word['term']['it']]})
            keys.add(normalise(word['term']['it']))
    # This is the existing supplemental identity rule, before course-list expansion.
    # Reusing those IDs keeps saved words, drafts and dated recall intact.
    for unit in grammar['units']:
        for index, term in enumerate(unit['words']):
            key = normalise(term['it'])
            if key in keys:
                continue
            keys.add(key)
            pieces = re.split(r'\s*→\s*', term['it'])
            target = pieces[1] if len(pieces) > 1 and not re.match(r'^to\s', term['en'], re.I) else pieces[0]
            targets.append({'id': f'grammar-word:{unit["id"]}:{index}', 'term': term, 'answers': answers_for(target)})
    for noun in booster['nouns']:
        key = normalise(noun['term']['it'])
        if key in keys:
            continue
        keys.add(key)
        targets.append({'id': 'noun-vocab:' + noun['id'], 'term': noun['term'], 'answers': [noun['term']['it']]})
    return targets


def build(rows):
    targets = existing_targets()
    by_form = {}
    for target in targets:
        for form in target['answers']:
            by_form.setdefault(noun_key(form), []).append(target)
    banks = {key: {'id': 'course-' + key, 'title': {'en': value[0], 'it': value[1]}, 'description': {'en': value[2], 'it': value[3]}, 'collection': 'course', 'words': []} for key, value in GROUPS.items()}
    coverage = []
    imported = []
    for row in rows:
        italian, english, part = [row[key].strip() for key in ['italian', 'english', 'word_type']]
        if not italian or not english or not part:
            raise ValueError('Every row needs Italian, English and word type')
        part = TYPE_CLARIFICATIONS.get(normalise(italian), part)
        answers = answers_for(italian)
        candidates = by_form.get(noun_key(answers[0]), [])
        match = next((target for target in candidates
                      if english_senses(target['term']['en']) == english_senses(english)
                      and all(noun_key(answer) in {noun_key(form) for form in target['answers']} for answer in answers)), None)
        row_key = hashlib.sha256((normalise(italian) + '\0' + normalise(english)).encode()).hexdigest()[:20]
        if match:
            coverage.append({'key': row_key, 'id': match['id'], 'partOfSpeech': part})
            continue
        item_id = 'course-word:' + row_key
        cue = CUE_CLARIFICATIONS.get((normalise(italian), english_key(english)), english)
        safe = SAFE_ALIASES.get(english_key(english), [])
        if normalise(italian) in {normalise(form) for form in safe}:
            answers += [form for form in safe if normalise(form) not in {normalise(answer) for answer in answers}]
        word = {'id': item_id, 'term': {'it': italian, 'en': cue}, 'partOfSpeech': part, 'answers': answers}
        banks[category(part)]['words'].append(word)
        imported.append(word)
        coverage.append({'key': row_key, 'id': item_id})
    if len({entry['key'] for entry in coverage}) != len(rows):
        raise ValueError('The list contains duplicate Italian/English lexical pairs')
    if len({word['id'] for word in imported}) != len(imported):
        raise ValueError('Stable word identity collision')
    return {'schemaVersion': 1, 'listRows': len(rows), 'coverage': coverage, 'banks': [bank for bank in banks.values() if bank['words']]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, default=ROOT / 'Organised/vocab.csv')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    source = args.input.resolve()
    if not source.is_relative_to((ROOT / 'Organised').resolve()):
        parser.error('Choose the approved word list within Organised/.')
    with source.open(encoding='utf-8-sig', newline='') as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames != ['italian', 'word_type', 'english']:
            parser.error('Expected italian, word_type, english columns only.')
        rows = list(reader)
    value = build(rows)
    encoded = json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n'
    if args.check:
        if DESTINATION.read_text() != encoded:
            raise ValueError('Course vocabulary is stale; rerun the importer')
    else:
        DESTINATION.write_text(encoded)
    new = sum(len(bank['words']) for bank in value['banks'])
    print(json.dumps({'list_rows': len(rows), 'new_targets': new, 'existing_rows_covered': len(rows) - new, 'new_banks': len(value['banks']), 'checked': args.check}))


if __name__ == '__main__':
    main()
