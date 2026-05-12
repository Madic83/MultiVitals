# MultiVitals

Webbapp for medicinska simuleringar med flera synkade skarmar, inloggning och instruktorsstyrning av vitalparametrar och media.

## Funktioner

- Inloggning med roller:
  - Instruktor: full kontroll over simulatorn
  - Deltagare: kan visa monitor- och mediaskarmar
- Skarmval i appen samt mojlighet att oppna varje skarm i separat flik/enhet
- Instruktorsskarm med:
  - justering av puls, SpO2, AF, blodtryck, temperatur och EtCO2
  - rytmval (sinus, AF, VT)
  - larmniva (stabil, varning, kritisk)
  - mediebibliotek for bilder/video samt aktiv visning
- iPad-overvakningsskarm
- monitorvy inspirerad av corpuls-stil
- iPhone-vy X2 (kompakt)
- iPhone-vy X3 (kompakt)
- separerad mediaskarm som visar vald bild/video
- Realtidssynk mellan oppna flikar via BroadcastChannel + localStorage

## Teknisk stack

- React 19
- TypeScript
- Vite
- ESLint

## Kom igang

1. Installera beroenden:

```bash
npm install
```

2. Starta utvecklingsserver:

```bash
npm run dev
```

3. Bygg produktion:

```bash
npm run build
```

4. Forhandsgranska produktion lokalt:

```bash
npm run preview
```

## Demo-inloggning

- Instruktor:
  - anvandarnamn: instruktor
  - losenord: sim123
- Deltagare:
  - anvandarnamn: deltagare
  - losenord: sim123

## Publicering pa GitHub

1. Skapa nytt repository pa GitHub.
2. Initiera git lokalt om det inte redan finns:

```bash
git init
```

3. Commit och pusha:

```bash
git add .
git commit -m "Initial medical simulation app"
git branch -M main
git remote add origin <DIN_REPO_URL>
git push -u origin main
```

## Viktigt

Denna app ar en simuleringsmiljo for utbildning och ovning, inte en medicinteknisk produkt for kliniskt beslutsstod.

Visuella uttryck i monitorvyerna ar inspirationsbaserade och maste granskas juridiskt och varumarkesmassigt innan kommersiell eller publik drift.
