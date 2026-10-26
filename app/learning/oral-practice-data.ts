import type { OralPracticeScene } from "./oral-practice-model.ts";
export type { OralPracticeScene, OralPracticeChoice, OralPracticeProduction } from "./oral-practice-model.ts";

// Original public companion scenes. Full text belongs to the lazy practice view,
// while validation uses the small identities in oral-practice-model.ts.
export const oralPracticeScenes: readonly OralPracticeScene[] = [
  {
    id: "oral-market",
    level: "A1",
    title: { en: "A different choice", it: "Un’altra scelta" },
    context: {
      en: "Listen to two people and work out their final decision. Try before opening the text.",
      it: "Ascolta due persone e individua la decisione finale. Prova prima di aprire il testo.",
    },
    lines: [
      { speaker: "A", text: { en: "I would like two kilos of apples, please.", it: "Vorrei due chili di mele, per favore." } },
      { speaker: "B", text: { en: "I have no apples today. The pears cost two euros a kilo.", it: "Oggi non ho mele. Le pere costano due euro al chilo." } },
      { speaker: "A", text: { en: "All right: then I will take one kilo of pears.", it: "Va bene: allora prendo un chilo di pere." } },
      { speaker: "B", text: { en: "Agreed. That is two euros.", it: "D’accordo. Sono due euro." } },
    ],
    gist: {
      id: "gist",
      prompt: { en: "What do the speakers finally agree on?", it: "Su che cosa si accordano alla fine?" },
      options: [
        { id: "gist-a", label: { en: "The customer buys nothing.", it: "Il cliente non compra niente." } },
        { id: "gist-b", label: { en: "The customer buys pears because apples are unavailable.", it: "Il cliente compra pere perché non ci sono mele." } },
        { id: "gist-c", label: { en: "The customer reserves apples for tomorrow.", it: "Il cliente prenota le mele per domani." } },
      ],
      correctOptionId: "gist-b",
      explanation: {
        en: "The first request is for apples. The seller has none, and the customer accepts pears instead.",
        it: "La prima richiesta riguarda le mele. Il venditore non ne ha e il cliente accetta invece le pere.",
      },
    },
    detail: {
      id: "detail",
      prompt: { en: "At the end, how much fruit does the customer decide to buy?", it: "Alla fine, quanta frutta decide di comprare il cliente?" },
      options: [
        { id: "detail-a", label: { en: "One kilo.", it: "Un chilo." } },
        { id: "detail-b", label: { en: "Two kilos.", it: "Due chili." } },
        { id: "detail-c", label: { en: "Three kilos.", it: "Tre chili." } },
      ],
      correctOptionId: "detail-a",
      explanation: {
        en: "The final choice is un chilo di pere. Two kilos belonged to the earlier apple request.",
        it: "La scelta finale è un chilo di pere. I due chili appartenevano alla precedente richiesta di mele.",
      },
    },
    retell: {
      prompt: {
        en: "Cover the scene. Change the purchase: you want one kilo of tomatoes, but there are none. Accept two kilos of courgettes at three euros a kilo. Tell someone your request, the alternative and the total price.",
        it: "Copri la scena. Cambia l’acquisto: vuoi un chilo di pomodori, ma non ci sono. Accetta due chili di zucchine a tre euro al chilo. Di’ a qualcuno la richiesta, l’alternativa e il prezzo totale.",
      },
      frame: {
        en: "I would like ___, but today there are none. I will take ___ at ___ a kilo. The total is ___.",
        it: "Vorrei ___, ma oggi non ci sono. Prendo ___ a ___ al chilo. In tutto pago ___.",
      },
      model: {
        en: "I would like one kilo of tomatoes, but there are none today. I will take two kilos of courgettes at three euros a kilo. I pay six euros in total.",
        it: "Vorrei un chilo di pomodori, ma oggi non ci sono. Prendo due chili di zucchine a tre euro al chilo. In tutto pago sei euro.",
      },
      rubric: [
        { en: "I changed the unavailable item to tomatoes and accepted two kilos of courgettes.", it: "Ho cambiato il prodotto mancante in pomodori e accettato due chili di zucchine." },
        { en: "I kept the quantities clear and gave the correct total of six euros.", it: "Ho mantenuto chiare le quantità e indicato il totale corretto di sei euro." },
      ],
    },
    transfer: {
      prompt: {
        en: "On a later day, keep the old notes closed. At a bakery, ask for four bread rolls. Only three remain, at one euro each. Agree to buy the three, give the total and close politely.",
        it: "In un giorno successivo, tieni chiusi i vecchi appunti. In panetteria chiedi quattro panini. Ne restano solo tre, a un euro ciascuno. Accetta di comprare i tre panini, indica il totale e concludi con cortesia.",
      },
      frame: {
        en: "I would like ___, please. Are there only ___? All right, I will take ___. That is ___. Thank you, ___.",
        it: "Vorrei ___, per favore. Ci sono solo ___? Va bene, prendo ___. Sono ___. Grazie, ___.",
      },
      model: {
        en: "I would like four bread rolls, please. Are there only three? All right, I will take three bread rolls. That is three euros. Thank you, have a good day.",
        it: "Vorrei quattro panini, per favore. Ci sono solo tre panini? Va bene, prendo tre panini. Sono tre euro. Grazie, buona giornata.",
      },
      rubric: [
        { en: "I requested four bread rolls but clearly accepted three.", it: "Ho chiesto quattro panini ma accettato chiaramente di prenderne tre." },
        { en: "I gave a total of three euros and a polite closing.", it: "Ho indicato un totale di tre euro e una chiusura cortese." },
      ],
    },
  },
  {
    id: "oral-invitation",
    level: "A1",
    title: { en: "A shared plan", it: "Un programma insieme" },
    context: {
      en: "Two people are arranging an activity together. Listen for how they reach an agreement.",
      it: "Due persone organizzano un’attività insieme. Ascolta come raggiungono un accordo.",
    },
    lines: [
      { speaker: "A", text: { en: "Would you like to go to the park on Saturday morning?", it: "Ti va di andare al parco sabato mattina?" } },
      { speaker: "B", text: { en: "I work on Saturday morning. Can we go there on Sunday?", it: "Sabato mattina lavoro. Possiamo andarci domenica?" } },
      { speaker: "A", text: { en: "Yes, Sunday at ten, in front of the library.", it: "Sì, domenica alle dieci, davanti alla biblioteca." } },
      { speaker: "B", text: { en: "Perfect, I will bring the water.", it: "Perfetto, porto io l’acqua." } },
    ],
    gist: {
      id: "gist",
      prompt: { en: "How do the speakers reach an agreement?", it: "Come raggiungono un accordo le due persone?" },
      options: [
        { id: "gist-a", label: { en: "They cancel the activity.", it: "Annullano l’attività." } },
        { id: "gist-b", label: { en: "They keep the Saturday plan.", it: "Mantengono il programma di sabato." } },
        { id: "gist-c", label: { en: "They move the plan from Saturday to Sunday.", it: "Spostano il programma da sabato a domenica." } },
      ],
      correctOptionId: "gist-c",
      explanation: {
        en: "One person works on Saturday. The other accepts the proposed Sunday alternative.",
        it: "Una persona lavora sabato. L’altra accetta l’alternativa proposta per domenica.",
      },
    },
    detail: {
      id: "detail",
      prompt: { en: "Where do they agree to meet?", it: "Dove decidono di incontrarsi?" },
      options: [
        { id: "detail-a", label: { en: "In front of the café.", it: "Davanti al bar." } },
        { id: "detail-b", label: { en: "In front of the library.", it: "Davanti alla biblioteca." } },
        { id: "detail-c", label: { en: "Inside the park.", it: "Dentro il parco." } },
      ],
      correctOptionId: "detail-b",
      explanation: {
        en: "The destination is the park, but the stated meeting point is davanti alla biblioteca.",
        it: "La destinazione è il parco, ma il punto d’incontro indicato è davanti alla biblioteca.",
      },
    },
    retell: {
      prompt: {
        en: "Cover the scene. You suggest the cinema on Tuesday evening, but your invented friend works then. Agree on Wednesday at half past seven, in front of the post office. Tell another person the reason for the change and the final arrangement.",
        it: "Copri la scena. Proponi il cinema martedì sera, ma il tuo amico inventato lavora in quel momento. Concordate mercoledì alle sette e mezza, davanti alla posta. Racconta a un’altra persona il motivo del cambiamento e l’accordo finale.",
      },
      frame: {
        en: "My friend works on ___. We are going to ___ on ___ at ___. We meet in front of ___.",
        it: "Il mio amico ___ lavora. Andiamo ___ mercoledì alle ___. Ci incontriamo davanti ___.",
      },
      model: {
        en: "My friend works on Tuesday evening. We are going to the cinema on Wednesday at half past seven. We meet in front of the post office.",
        it: "Il mio amico martedì sera lavora. Andiamo al cinema mercoledì alle sette e mezza. Ci incontriamo davanti alla posta.",
      },
      rubric: [
        { en: "I explained why Tuesday does not work and chose Wednesday instead.", it: "Ho spiegato perché martedì non va bene e scelto invece mercoledì." },
        { en: "I kept the final time and the post-office meeting point clear.", it: "Ho mantenuto chiari l’orario finale e il punto d’incontro davanti alla posta." },
      ],
    },
    transfer: {
      prompt: {
        en: "On a later day, close the old notes. Invite an invented neighbour for coffee on Friday at three. They cannot come on Friday: agree on Saturday at four, in front of the statue. Say the invitation and the accepted alternative.",
        it: "In un giorno successivo, chiudi i vecchi appunti. Invita una persona inventata del vicinato a prendere un caffè venerdì alle tre. Non può venire venerdì: concordate sabato alle quattro, davanti alla statua. Formula l’invito e l’alternativa accettata.",
      },
      frame: {
        en: "Would you like to ___ on ___ at ___? You cannot? All right, ___ at ___. We meet in front of ___.",
        it: "Ti va di ___ venerdì alle ___? Non puoi? Va bene sabato alle ___. Ci incontriamo davanti ___.",
      },
      model: {
        en: "Would you like to have a coffee on Friday at three? You cannot come on Friday? All right, Saturday at four. We meet in front of the statue.",
        it: "Ti va di prendere un caffè venerdì alle tre? Non puoi venerdì? Va bene sabato alle quattro. Ci incontriamo davanti alla statua.",
      },
      rubric: [
        { en: "I offered Friday at three and accepted Saturday at four.", it: "Ho proposto venerdì alle tre e accettato sabato alle quattro." },
        { en: "I kept the statue as the final meeting point and made the agreement clear.", it: "Ho mantenuto la statua come punto d’incontro finale e reso chiaro l’accordo." },
      ],
    },
  },
  {
    id: "oral-delay",
    level: "A2",
    title: { en: "An explanation", it: "Una spiegazione" },
    context: {
      en: "One person asks about something that happened. Listen for the problem and the response to it.",
      it: "Una persona chiede che cosa è successo. Ascolta il problema e la reazione.",
    },
    lines: [
      { speaker: "A", text: { en: "Why did you arrive after the visit had started?", it: "Perché sei arrivata dopo l’inizio della visita?" } },
      { speaker: "B", text: { en: "I was waiting for the tram when they closed the stop.", it: "Aspettavo il tram quando hanno chiuso la fermata." } },
      { speaker: "A", text: { en: "How did you manage to reach the museum?", it: "Come hai fatto a raggiungere il museo?" } },
      { speaker: "B", text: { en: "I took the bus and arrived at eleven.", it: "Ho preso l’autobus e sono arrivata alle undici." } },
    ],
    gist: {
      id: "gist",
      prompt: { en: "How does the speaker solve the travel problem?", it: "Come risolve il problema del viaggio la persona che risponde?" },
      options: [
        { id: "gist-a", label: { en: "She takes a different means of transport.", it: "Prende un altro mezzo di trasporto." } },
        { id: "gist-b", label: { en: "She gives up the visit and goes home.", it: "Rinuncia alla visita e torna a casa." } },
        { id: "gist-c", label: { en: "She waits at the same stop until the evening.", it: "Aspetta alla stessa fermata fino a sera." } },
      ],
      correctOptionId: "gist-a",
      explanation: {
        en: "The tram stop closes while she is waiting. She reaches the museum by bus instead.",
        it: "La fermata del tram chiude mentre lei aspetta. Raggiunge invece il museo in autobus.",
      },
    },
    detail: {
      id: "detail",
      prompt: { en: "What time does she say she arrived?", it: "A che ora dice di essere arrivata?" },
      options: [
        { id: "detail-a", label: { en: "At ten.", it: "Alle dieci." } },
        { id: "detail-b", label: { en: "At half past ten.", it: "Alle dieci e mezza." } },
        { id: "detail-c", label: { en: "At eleven.", it: "Alle undici." } },
      ],
      correctOptionId: "detail-c",
      explanation: { en: "Her last line gives the arrival time: alle undici.", it: "L’ultima battuta indica l’orario di arrivo: alle undici." },
    },
    retell: {
      prompt: {
        en: "Cover the scene. Tell a new version about Nora: she was waiting for a train when its cancellation was announced. She took a bus and arrived at the cinema at six. Distinguish the background from the completed events.",
        it: "Copri la scena. Racconta una nuova versione su Nora: aspettava un treno quando hanno annunciato la cancellazione. Ha preso un autobus ed è arrivata al cinema alle sei. Distingui lo sfondo dagli eventi conclusi.",
      },
      frame: {
        en: "Nora was waiting for ___ when ___. She took ___. She arrived at the ___ at ___.",
        it: "Nora aspettava ___ quando ___. Ha preso ___. È arrivata al ___ alle ___.",
      },
      model: {
        en: "Nora was waiting for the train when its cancellation was announced. She took the bus. She arrived at the cinema at six.",
        it: "Nora aspettava il treno quando hanno annunciato la cancellazione. Ha preso l’autobus. È arrivata al cinema alle sei.",
      },
      rubric: [
        { en: "I used a background form such as aspettava and completed-event forms for the announcement and response.", it: "Ho usato una forma di sfondo come aspettava e forme di evento concluso per l’annuncio e la reazione." },
        { en: "I kept Nora, the cinema and the new arrival time of six consistent.", it: "Ho mantenuto coerenti Nora, il cinema e il nuovo orario di arrivo alle sei." },
      ],
    },
    transfer: {
      prompt: {
        en: "On a later day, keep the old notes closed. Tell a new story about Leo: he was cycling to the sports centre when the chain broke. He continued on foot and arrived at half past seven. Add how he felt on arrival.",
        it: "In un giorno successivo, tieni chiusi i vecchi appunti. Racconta una nuova storia su Leo: andava al centro sportivo in bicicletta quando si è rotta la catena. Ha continuato a piedi ed è arrivato alle sette e mezza. Aggiungi come si sentiva all’arrivo.",
      },
      frame: {
        en: "Leo was going to ___ when ___. He continued ___ and arrived at ___. He felt ___.",
        it: "Leo andava ___ quando ___. Ha continuato ___ ed è arrivato alle ___. Era ___.",
      },
      model: {
        en: "Leo was cycling to the sports centre when the chain broke. He continued on foot and arrived at half past seven. He was tired but happy.",
        it: "Leo andava al centro sportivo in bicicletta quando si è rotta la catena. Ha continuato a piedi ed è arrivato alle sette e mezza. Era stanco, ma contento.",
      },
      rubric: [
        { en: "I distinguished the ongoing journey from the breakage and completed response.", it: "Ho distinto il viaggio in corso dalla rottura e dalla reazione conclusa." },
        { en: "I used the new person, destination and time consistently and included a feeling on arrival.", it: "Ho usato in modo coerente la nuova persona, la destinazione e l’orario e incluso una sensazione all’arrivo." },
      ],
    },
  },
];

export default oralPracticeScenes;
