from __future__ import annotations

import shutil
from pathlib import Path
from textwrap import wrap

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf"
WEB = ROOT / "public" / "downloads"
W, H = A4

CREAM = HexColor("#F6F0E4")
PAPER = HexColor("#FFFDF8")
GREEN = HexColor("#1F5A43")
RED = HexColor("#B64D3C")
OCHRE = HexColor("#D99A35")
INK = HexColor("#18372C")
MUTED = HexColor("#66736B")
LINE = HexColor("#D9D2C5")

pdfmetrics.registerFont(TTFont("Arial", "/System/Library/Fonts/Supplemental/Arial.ttf"))
pdfmetrics.registerFont(TTFont("ArialBold", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"))
pdfmetrics.registerFont(TTFont("Georgia", "/System/Library/Fonts/Supplemental/Georgia.ttf"))
pdfmetrics.registerFont(TTFont("GeorgiaBold", "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"))
pdfmetrics.registerFont(TTFont("GeorgiaItalic", "/System/Library/Fonts/Supplemental/Georgia Italic.ttf"))


def text_lines(c: Canvas, text: str, x: float, y: float, width: int, leading: float, font="Arial", size=10, color=INK):
    c.setFont(font, size)
    c.setFillColor(color)
    for line in wrap(text, width=width, break_long_words=False):
        c.drawString(x, y, line)
        y -= leading
    return y


def header(c: Canvas, number: int, title: str, subtitle: str, label: str):
    c.setFillColor(CREAM)
    c.rect(0, 0, W, H, fill=1, stroke=0)
    c.setFillColor(GREEN)
    c.rect(0, H - 94, W, 94, fill=1, stroke=0)
    c.setFillColor(OCHRE)
    c.circle(W - 72, H - 48, 38, fill=1, stroke=0)
    c.setFillColor(PAPER)
    c.setFont("ArialBold", 8)
    c.drawString(34, H - 29, f"PARLIAMO!  ·  {label.upper()}")
    c.setFont("GeorgiaBold", 25)
    c.drawString(34, H - 61, title)
    c.setFont("Arial", 9)
    c.drawString(35, H - 79, subtitle)
    c.setFillColor(GREEN)
    c.setFont("GeorgiaBold", 20)
    c.drawCentredString(W - 72, H - 55, f"{number:02d}")


def answer_strip(c: Canvas, answers: list[str]):
    c.saveState()
    c.translate(W / 2, 57)
    c.rotate(180)
    x, y, width, height = -W / 2 + 30, -34, W - 60, 68
    c.setFillColor(GREEN)
    c.roundRect(x, y, width, height, 7, fill=1, stroke=0)
    c.setFillColor(HexColor("#F0D38E"))
    c.setFont("ArialBold", 7)
    c.drawString(x + 12, y + height - 15, "GIRA LA PAGINA PER CONTROLLARE  ·  TURN THE PAGE UPSIDE DOWN")
    c.setFillColor(PAPER)
    c.setFont("Arial", 7.2)
    joined = "   ·   ".join(f"{i+1}. {a}" for i, a in enumerate(answers))
    lines = wrap(joined, 135, break_long_words=False)
    for i, line in enumerate(lines[:4]):
        c.drawString(x + 12, y + height - 30 - i * 10, line)
    c.restoreState()


def question_page(c: Canvas, number: int, title: str, subtitle: str, rule: str, examples: list[tuple[str, str]], questions: list[str], answers: list[str]):
    header(c, number, title, subtitle, "Practice workbook")
    y = H - 124
    c.setFillColor(PAPER)
    c.roundRect(34, y - 72, W - 68, 72, 7, fill=1, stroke=0)
    c.setFillColor(RED)
    c.setFont("ArialBold", 8)
    c.drawString(48, y - 18, "LA REGOLA IN UNA FRASE")
    y = text_lines(c, rule, 48, y - 38, 92, 13, "Georgia", 10.5)
    y -= 26
    c.setFillColor(RED)
    c.setFont("ArialBold", 8)
    c.drawString(34, y, "ESEMPI MODELLO  ·  MODEL EXAMPLES")
    y -= 17
    for it, en in examples:
        c.setFont("GeorgiaBold", 10.5); c.setFillColor(INK); c.drawString(46, y, it)
        c.setFont("GeorgiaItalic", 8.5); c.setFillColor(MUTED); c.drawString(300, y, en)
        y -= 18
    y -= 7
    c.setStrokeColor(LINE); c.line(34, y, W - 34, y); y -= 22
    c.setFillColor(RED); c.setFont("ArialBold", 8); c.drawString(34, y, "PROVA SENZA GUARDARE  ·  WORK FROM MEMORY")
    y -= 23
    for i, q in enumerate(questions, 1):
        c.setFillColor(OCHRE); c.circle(45, y + 3, 10, fill=1, stroke=0)
        c.setFillColor(INK); c.setFont("ArialBold", 8); c.drawCentredString(45, y, str(i))
        y = text_lines(c, q, 65, y + 4, 83, 12, "Arial", 9.5)
        c.setStrokeColor(HexColor("#C9C4B7")); c.line(65, y - 4, W - 42, y - 4)
        y -= 25
    answer_strip(c, answers)
    c.showPage()


PAGES = [
    ("Essere, avere e stare", "The three essential ways to be and have", "Use essere for identity, avere for possession and age, and stare for temporary state or health.", [("Sono studente.", "I am a student."), ("Ho ventidue anni.", "I am twenty-two."), ("Sto molto bene.", "I am very well.")], ["Complete: Io ___ britannico.", "Translate: We are tired.", "Complete: Marta ___ una sorella.", "Translate: I am 25 years old.", "Ask: How are you?", "Complete: Oggi noi ___ bene."], ["sono", "Siamo stanchi/e.", "ha", "Ho venticinque anni.", "Come stai? / Come sta?", "stiamo"]),
    ("Articoli", "Definite and indefinite articles", "Choose the article from the noun’s gender, number and opening sound: s+consonant and z need lo/uno.", [("lo studente / gli studenti", "the student / the students"), ("un’amica", "a female friend"), ("uno psicologo", "a psychologist")], ["___ zaino", "___ amica", "___ studenti", "___ casa", "Plural: il giornalista", "Correct: un psicologo"], ["lo zaino", "un’amica", "gli studenti", "la casa", "i giornalisti", "uno psicologo"]),
    ("Presente indicativo", "Regular and useful irregular verbs", "Remove -are, -ere or -ire and add the ending that matches the subject.", [("Parlo italiano.", "I speak Italian."), ("Prendiamo un caffè.", "We have a coffee."), ("Preferisci il tè?", "Do you prefer tea?")], ["parlare, io: ___", "prendere, noi: ___", "dormire, loro: ___", "preferire, tu: ___", "fare, io: ___", "andare, voi: ___"], ["parlo", "prendiamo", "dormono", "preferisci", "faccio", "andate"]),
    ("Piacere", "Likes, dislikes and agreement", "The thing liked controls piace or piacciono; the person is shown with mi, ti, gli, le, ci or vi.", [("Mi piace il mare.", "I like the sea."), ("Mi piacciono le città.", "I like cities."), ("Anche a me!", "Me too!")], ["Mi piace / piacciono la pasta.", "Mi piace / piacciono i musei.", "Translate: We like Rome.", "Agree: Mi piace il cinema.", "Disagree: Non mi piace il calcio.", "Correct: Io piaccio le città."], ["piace", "piacciono", "Ci piace Roma.", "Anche a me!", "A me sì.", "Mi piacciono le città."]),
    ("Verbi riflessivi", "Daily routine", "Keep the reflexive pronoun before the conjugated verb: mi, ti, si, ci, vi, si.", [("Mi sveglio alle sette.", "I wake up at seven."), ("Ci prepariamo insieme.", "We get ready together."), ("Si veste in fretta.", "He/she gets dressed quickly.")], ["svegliarsi, noi: ___", "vestirsi, io: ___", "alzarsi, loro: ___", "Translate: She washes her hands.", "Put in order: presto / mi / alzo", "Past: I got up at eight."], ["ci svegliamo", "mi vesto", "si alzano", "Si lava le mani.", "Mi alzo presto.", "Mi sono alzato/a alle otto."]),
    ("Preposizioni", "Simple and articulated prepositions", "Di, a, da, in and su fuse with definite articles; con and per normally stay separate.", [("al museo", "at/to the museum"), ("nella camera", "in the room"), ("sugli scaffali", "on the shelves")], ["a + il cinema", "in + la camera", "su + gli scaffali", "di + le vacanze", "da + gli amici", "Translate: I go home."], ["al cinema", "nella camera", "sugli scaffali", "delle vacanze", "dagli amici", "Vado a casa."]),
    ("Pronomi diretti", "Lo, la, li and le", "Replace the direct object and place the pronoun before the conjugated verb.", [("Compro la pizza. → La compro.", "I buy the pizza. → I buy it."), ("Vedo gli amici. → Li vedo.", "I see the friends. → I see them.")], ["Mangio la pasta. → ___", "Compro i libri. → ___", "Vedi Marta? → Sì, ___", "Prendete le chiavi? → Sì, ___", "Translate: I know him.", "Correct: Compro le."], ["La mangio.", "Li compro.", "la vedo", "le prendiamo", "Lo conosco.", "Le compro."]),
    ("Possessivi", "Family and possession", "The possessive agrees with the thing possessed, not the owner; singular close family often omits the article.", [("mio fratello", "my brother"), ("le nostre case", "our houses"), ("la mia amica", "my female friend")], ["___ madre (my)", "___ cugine (our)", "___ libro (his/her)", "___ genitori (your plural)", "Correct: la mia madre", "Translate: their house"], ["mia madre", "le nostre cugine", "il suo libro", "i vostri genitori", "mia madre", "la loro casa"]),
    ("Passato prossimo", "Talking about completed past events", "Use present avere or essere plus a past participle; with essere, make the participle agree.", [("Ho mangiato.", "I ate."), ("Siamo arrivati/e.", "We arrived."), ("Marta è tornata.", "Marta returned.")], ["Ieri io ___ (bere) un caffè.", "Noi ___ (andare) a Roma.", "Marta ___ (tornare) a casa.", "Past participle: fare", "Past participle: scegliere", "Correct: Ho andato al museo."], ["ho bevuto", "siamo andati/e", "è tornata", "fatto", "scelto", "Sono andato/a al museo."]),
    ("C’è e ci sono", "Describing homes, towns and hotels", "Use c’è for one thing and ci sono for more than one.", [("C’è un balcone.", "There is a balcony."), ("Ci sono due camere.", "There are two bedrooms.")], ["___ una farmacia qui vicino.", "___ tre ristoranti.", "Translate: Is there Wi-Fi?", "Translate: There are no rooms.", "Describe: one kitchen", "Describe: two bathrooms"], ["C’è", "Ci sono", "C’è il Wi-Fi?", "Non ci sono camere.", "C’è una cucina.", "Ci sono due bagni."]),
    ("Al bar e al ristorante", "Useful language you can say immediately", "Vorrei is a friendly, polite default for ordering; use per favore and grazie naturally.", [("Vorrei un caffè.", "I’d like a coffee."), ("Il conto, per favore.", "The bill, please."), ("Per me gli gnocchi.", "Gnocchi for me.")], ["Order a sparkling water.", "Ask for a table for two.", "Ask for the menu.", "Say you are vegetarian.", "Order 200g of ham.", "Ask whether breakfast is included."], ["Vorrei dell’acqua frizzante.", "Un tavolo per due, per favore.", "Posso avere il menù?", "Sono vegetariano/a.", "Vorrei due etti di prosciutto.", "La colazione è inclusa?"]),
    ("Fare proposte", "Invite, accept and refuse politely", "Use Ti va di + infinitive, Perché non + noi, or Che ne dici di + infinitive.", [("Ti va di uscire?", "Do you feel like going out?"), ("Sì, volentieri!", "Yes, gladly!"), ("Magari un’altra volta.", "Maybe another time.")], ["Suggest going to the museum.", "Suggest having a picnic.", "Accept warmly.", "Refuse: you already have plans.", "Ask: What about going for a walk?", "Say: I don’t feel like it."], ["Ti va di andare al museo?", "Perché non facciamo un picnic?", "Sì, volentieri!", "Mi dispiace, ho già un impegno.", "Che ne dici di fare una passeggiata?", "Non mi va."]),
]


READINGS = [
    ("Una mattina a Londra", "Routine · A1", ["Ogni mattina Guglielmo si sveglia alle sette.", "Fa una doccia, si veste e prepara un caffè forte.", "Prima di uscire controlla il tempo e prende l’ombrello.", "Va all’università in metropolitana e durante il viaggio ripassa dieci parole italiane."], ["A che ora si sveglia?", "Che cosa prepara?", "Che cosa prende prima di uscire?", "Come va all’università?", "Che cosa ripassa?"], ["Alle sette.", "Un caffè forte.", "L’ombrello.", "In metropolitana.", "Dieci parole italiane."]),
    ("Un fine settimana a Bologna", "Passato prossimo · A1+", ["Sabato scorso sono andato a Bologna con due amici.", "Abbiamo visitato il centro e abbiamo mangiato le tagliatelle al ragù.", "Nel pomeriggio ha piovuto, quindi siamo entrati in un museo.", "La sera eravamo stanchi, ma molto contenti della giornata."], ["Dove è andato?", "Con chi?", "Che cosa hanno mangiato?", "Perché sono entrati nel museo?", "Come erano la sera?"], ["A Bologna.", "Con due amici.", "Le tagliatelle al ragù.", "Perché ha piovuto.", "Stanchi ma contenti."]),
    ("Una cena semplice", "Ristorante · A1", ["Al ristorante chiediamo un tavolo per due vicino alla finestra.", "Come antipasto prendiamo delle olive e del pane.", "Io ordino la pasta, mentre la mia amica preferisce il pesce.", "Alla fine chiediamo il conto e lasciamo una piccola mancia."], ["Per quante persone è il tavolo?", "Dove vogliono sedersi?", "Che cosa prendono come antipasto?", "Che cosa ordina l’amica?", "Che cosa chiedono alla fine?"], ["Per due.", "Vicino alla finestra.", "Olive e pane.", "Il pesce.", "Il conto."]),
    ("L’appartamento ideale", "Casa · A1+", ["Cerco un appartamento luminoso non lontano dal centro.", "Deve avere una camera, un soggiorno e una cucina moderna.", "Vorrei anche un balcone perché mi piace fare colazione fuori.", "Prima di firmare il contratto chiedo se le spese sono incluse."], ["Com’è l’appartamento?", "Dov’è?", "Quali stanze deve avere?", "Perché vuole un balcone?", "Che cosa chiede prima di firmare?"], ["Luminoso.", "Non lontano dal centro.", "Camera, soggiorno e cucina.", "Per fare colazione fuori.", "Se le spese sono incluse."]),
    ("Un problema in albergo", "Albergo · A1+", ["Arrivo in albergo alle sei, ma la mia prenotazione non è nel sistema.", "Spiego il problema con calma e mostro l’e-mail di conferma.", "La receptionist controlla di nuovo e trova una camera al terzo piano.", "La ringrazio e le chiedo a che ora servono la colazione."], ["A che ora arriva?", "Qual è il problema?", "Che cosa mostra?", "Dov’è la camera?", "Che cosa chiede alla fine?"], ["Alle sei.", "La prenotazione non è nel sistema.", "L’e-mail di conferma.", "Al terzo piano.", "A che ora servono la colazione."]),
]


def build_practice(path: Path):
    c = Canvas(str(path), pagesize=A4)
    c.setTitle("Parliamo! — Italian Practice Workbook")
    for i, page in enumerate(PAGES, 1):
        question_page(c, i, *page)
    c.save()


def build_readings(path: Path):
    c = Canvas(str(path), pagesize=A4)
    c.setTitle("Parliamo! — Bilingual Reading Workbook")
    for i, (title, subtitle, paragraphs, questions, answers) in enumerate(READINGS, 1):
        header(c, i, title, subtitle, "Reading workbook")
        y = H - 124
        c.setFillColor(PAPER); c.roundRect(34, y - 180, W - 68, 180, 7, fill=1, stroke=0)
        c.setFillColor(RED); c.setFont("ArialBold", 8); c.drawString(48, y - 18, "LEGGI PRIMA SENZA TRADURRE  ·  READ FOR THE GIST")
        y -= 44
        for p in paragraphs:
            y = text_lines(c, p, 48, y, 92, 14, "Georgia", 10.5)
            y -= 8
        y -= 22
        c.setFillColor(RED); c.setFont("ArialBold", 8); c.drawString(34, y, "DOMANDE DI COMPRENSIONE")
        y -= 25
        for n, q in enumerate(questions, 1):
            c.setFillColor(OCHRE); c.circle(45, y + 3, 10, fill=1, stroke=0)
            c.setFillColor(INK); c.setFont("ArialBold", 8); c.drawCentredString(45, y, str(n))
            y = text_lines(c, q, 65, y + 4, 82, 12, "Arial", 9.5)
            c.setStrokeColor(LINE); c.line(65, y - 4, W - 42, y - 4)
            y -= 28
        answer_strip(c, answers)
        c.showPage()
    c.save()


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    WEB.mkdir(parents=True, exist_ok=True)
    practice = OUT / "Parliamo_Practice_Workbook.pdf"
    readings = OUT / "Parliamo_Reading_Workbook.pdf"
    build_practice(practice)
    build_readings(readings)
    shutil.copy2(practice, WEB / practice.name)
    shutil.copy2(readings, WEB / readings.name)
    print(practice)
    print(readings)


if __name__ == "__main__":
    main()
