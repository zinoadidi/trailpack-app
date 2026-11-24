// Batch 5 of B's i18n keys: the activity strings the components read at run
// time (match, teaching, listening, voice, sweep, order and practise screens).

export const PREFIXES = ['act2.'];

export const STRINGS = {
  'act2.matchTitle': { en: 'Match the pairs', et: 'Ühenda paarid', es: 'Une las parejas', fr: 'Associez les paires', fi: 'Yhdistä parit' },
  'act2.matchPicked': { en: 'Picked. Now choose what it goes with.', et: 'Valitud. Nüüd vali, millega see kokku kuulub.', es: 'Elegido. Ahora elige con qué va.', fr: 'Choisi. Sélectionnez maintenant ce qui va avec.', fi: 'Valittu. Valitse nyt, mihin se kuuluu.' },
  'act2.matchRight': { en: 'That pair is right.', et: 'See paar on õige.', es: 'Esa pareja es correcta.', fr: 'Cette paire est juste.', fi: 'Tuo pari on oikein.' },
  'act2.matchWrong': { en: 'Those two do not go together. Try again.', et: 'Need kaks ei kuulu kokku. Proovi uuesti.', es: 'Esos dos no coinciden. Inténtalo de nuevo.', fr: 'Ces deux-là ne vont pas ensemble. Réessayez.', fi: 'Ne kaksi eivät kuulu yhteen. Yritä uudelleen.' },
  'act2.orderItemLabel': { en: 'Position {position}: {text}. Use the arrow keys to move it.', et: 'Asukoht {position}: {text}. Liigutamiseks kasuta nooleklahve.', es: 'Posición {position}: {text}. Usa las teclas de flecha para moverlo.', fr: 'Position {position} : {text}. Utilisez les flèches pour le déplacer.', fi: 'Sija {position}: {text}. Siirrä nuolinäppäimillä.' },
  'act2.orderMoved': { en: 'Moved to position {position}.', et: 'Liigutatud kohale {position}.', es: 'Movido a la posición {position}.', fr: 'Déplacé à la position {position}.', fi: 'Siirretty sijalle {position}.' },
  'act2.listenPlaying': { en: 'Playing the clip.', et: 'Lõik mängib.', es: 'Reproduciendo el audio.', fr: 'Lecture du clip.', fi: 'Soitetaan klippi.' },
  'act2.listenDone': { en: 'Finished. Pick an answer, or press play again.', et: 'Lõppes. Vali vastus või vajuta uuesti esitamiseks.', es: 'Terminado. Elige una respuesta o pulsa reproducir otra vez.', fr: 'Terminé. Choisissez une réponse ou relisez.', fi: 'Valmis. Valitse vastaus tai paina toista uudelleen.' },
  'act2.voiceCoverage': { en: 'Coverage {percent}%', et: 'Kaetus {percent}%', es: 'Cobertura {percent}%', fr: 'Couverture {percent} %', fi: 'Kattavuus {percent} %' },
  'act2.voiceBand.high': { en: 'Strong', et: 'Tugev', es: 'Sólido', fr: 'Solide', fi: 'Vahva' },
  'act2.voiceBand.mid': { en: 'Partly there', et: 'Osaliselt olemas', es: 'A medias', fr: 'Partiellement', fi: 'Osittain' },
  'act2.voiceBand.low': { en: 'Needs more', et: 'Vajab veel', es: 'Necesita más', fr: 'À compléter', fi: 'Tarvitsee lisää' },
  'act2.voiceListening': { en: 'Listening. Speak now.', et: 'Kuulan. Räägi nüüd.', es: 'Escuchando. Habla ahora.', fr: 'Écoute. Parlez maintenant.', fi: 'Kuuntelen. Puhu nyt.' },
  'act2.voiceHearing': { en: 'Heard: {text}', et: 'Kuuldud: {text}', es: 'Oído: {text}', fr: 'Entendu : {text}', fi: 'Kuultu: {text}' },
  'act2.voiceFailed': { en: 'The microphone did not work. Type your answer instead.', et: 'Mikrofon ei töötanud. Kirjuta vastus hoopis.', es: 'El micrófono no funcionó. Escribe tu respuesta.', fr: 'Le micro n’a pas fonctionné. Écrivez votre réponse.', fi: 'Mikrofoni ei toiminut. Kirjoita vastaus.' },
  'act2.teachCoverage': { en: 'You covered {percent}%', et: 'Katsid {percent}%', es: 'Has cubierto el {percent}%', fr: 'Vous avez couvert {percent} %', fi: 'Käsittelit {percent} %' },
  'act2.teachCheck': { en: 'Check with the model', et: 'Kontrolli mudeliga', es: 'Comprobar con el modelo', fr: 'Vérifier avec le modèle', fi: 'Tarkista mallilla' },
  'act2.teachAsking': { en: 'Asking the model…', et: 'Küsin mudelilt…', es: 'Preguntando al modelo…', fr: 'Question au modèle…', fi: 'Kysyn mallilta…' },
  'act2.teachScored': { en: 'The model added its own notes.', et: 'Mudel lisas omad märkused.', es: 'El modelo ha añadido sus notas.', fr: 'Le modèle a ajouté ses notes.', fi: 'Malli lisäsi omat huomionsa.' },
  'act2.teachOffline': { en: 'The model is not reachable now ({note}). Your own check above still counts.', et: 'Mudel ei ole praegu kättesaadav ({note}). Ülalolev enda kontroll loeb ikka.', es: 'El modelo no está disponible ahora ({note}). Tu comprobación de arriba sigue valiendo.', fr: 'Modèle indisponible pour l’instant ({note}). Votre propre vérification compte toujours.', fi: 'Malliin ei saada nyt yhteyttä ({note}). Oma tarkistuksesi yllä lasketaan silti.' },
  'act2.sweepBadge': { en: 'Sweep {done}/{total}', et: 'Kordus {done}/{total}', es: 'Repaso {done}/{total}', fr: 'Balayage {done}/{total}', fi: 'Kertaus {done}/{total}' },
  'act2.practiceRight': { en: 'Right', et: 'Õige', es: 'Bien', fr: 'Justes', fi: 'Oikein' },
  'act2.practiceWrong': { en: 'Wrong', et: 'Vale', es: 'Mal', fr: 'Fausses', fi: 'Väärin' },
  'act2.practiceStreak': { en: 'Best run', et: 'Parim seeria', es: 'Mejor racha', fr: 'Meilleure série', fi: 'Paras putki' },
};
