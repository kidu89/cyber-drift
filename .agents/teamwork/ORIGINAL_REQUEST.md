# Original User Request

## Initial Request — 2026-10-17T17:46:59Z

Dezvoltarea și extinderea completă a simulatorului 3D WebGPU „Teleoperator” într-un joc urban deschis (open-world driving game) complet, integrând un sistem diversificat de misiuni, randare vizuală avansată, garaj cu vehicule extinse și navigație dinamică în San Francisco.

Working directory: c:\Users\Gabi\Downloads\game fly
Integrity mode: development

## Requirements

### R1. Sistem de Misiuni, Activități și Scenarii Dinamice (Gameplay & Missions)
Un sistem complet de gameplay integrat în interfață și pe hartă, care oferă jucătorului obiective active:
- **Curse urbane (Time Trials / Checkpoint Races):** Rute predefinite prin San Francisco cu checkpoint-uri luminate, cronometru, clasament cu medalii/stele și recorduri personale salvate local.
- **Scenariu de urmărire cu Poliția (Police Pursuit):** Sistem de căutare dinamic (Heat Levels 1-5), cu patrule de poliție reactive, blocaje rutiere pe bulevarde și mecanism de evadare (*Cooldown Zone*).
- **Evenimente de Drift & Cascadorii:** Detectare în timp real a unghiului de alunecare și a vitezei, acordând puncte de stil și multiplicatori; rampe și provocări de salt pe dealurile abrupte din San Francisco (Lombard St, Twin Peaks).
- **Mod Fares / Servicii VIP:** Misiuni de transport rapid contra cronometru sau curse de confort cu pasageri exigenți.

### R2. Îmbunătățiri Grafice, Iluminare și Efecte de Mediu (Graphics & Atmosphere)
Fidelitate vizuală de top utilizând capabilitățile WebGPU și Three.js:
- **Ciclu Zi/Noapte dinamic și Vreme:** Tranziție fluidă între miezul zilei, apus auriu (golden hour), noapte iluminată stradal și vreme ploioasă.
- **Carosabil umed și reflexii:** Asfalt cu shader de umiditate și reflexii dinamice ale clădirilor și luminilor pe timp de ploaie.
- **Efecte de particule GPU:** Fum și urme persistente de anvelope la frânare și drift, flăcări la eșapament la accelerație maximă/nitro și iluminare neon sub vehicule.
- **HUD și cameră îmbunătățită:** Vitezometru optimizat, efecte de motion blur la viteze ridicate și cameră dinamică cu trepidație realistă la impact și denivelări.

### R3. Flotă Extinsă de Vehicule, Garaj și Tuning (Fleet & Customization)
- **Extindere vehicule:** Suport pentru multiple clase de vehicule (robotaxi Waymo/Cybercab, supercars, muscle cars clasice, mașină de poliție interceptor).
- **Mecanică de Tuning & Fizică:** Comportament ajustabil între stilurile „Arcade” (drift facil, nitro regenerabil) și „Simulator” (aderență realistă, control al tracțiunii și ABS configurabile).
- **Garaj de personalizare:** Meniu vizual pe turntable pentru schimbarea culorii caroseriei (mat, lucios, perlat, fibră de carbon), culorii jantelor, nuanței geamurilor și a etrierelor de frână.

### R4. Navigație Urbană și Trasee Extinse (Map & Navigation)
- **Navigație GPS activă:** Linie de ghidaj 3D proiectată direct pe suprafața șoselei sau săgeți de direcție către destinația selectată.
- **Trasee extinse:** Deschiderea completă a accesului pe podurile Golden Gate Bridge și Bay Bridge către punctele de belvedere, rute de viteză pe autostradă și circuite închise în parcuri.
- **Minimap & Hartă Fullscreen interactive:** Marcare clară a evenimentelor, recordurilor de viteză (speed traps) și a garajelor, cu funcție de teleportare rapidă (*Fast Travel*).

---

## Acceptance Criteria

### Verificare Funcțională & Gameplay
- [ ] Meniul de pauză/activități permite selectarea și pornirea a cel puțin 3 tipuri distincte de misiuni (cursă pe checkpoint-uri, zonă de drift, urmărire cu poliția).
- [ ] Finalizarea sau eșuarea unei misiuni afișează un sumar clar al rezultatelor (scor, timp, bani/XP câștigați) și salvează progresul în `localStorage`.
- [ ] Modul de urmărire cu poliția declanșează reacția vehiculelor de patrulă la depășirea vitezei sau coliziuni, cu sirenă și logică de urmărire.

### Verificare Grafică & Mediu
- [ ] Comutarea vremii pe „Rain” activează efectul de ploaie și reflexiile de pe asfalt pe orice browser compatibil WebGPU.
- [ ] Comutarea timpului activează iluminatul stradal și farurile vehiculelor în modul noapte.
- [ ] Efectele de particule pentru derapaje (fum și urme de cauciuc) sunt vizibile în viraje bruște și frânare.

### Verificare Tehnică & Performanță
- [ ] Jocul pornește corect din `http://localhost:3000` fără erori critice în consola browserului.
- [ ] Rata de cadre se menține fluidă (60 FPS pe hardware dedicat sau profil scalabil automat pentru laptopuri/dispozitive mobile).
- [ ] Toate componentele și scripturile noi respectă arhitectura existentă modulară din proiect.
