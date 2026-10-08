# v3ry Pocket Color

Lecteur Game Boy / Game Boy Color web avec un coeur d'emulation JavaScript ecrit dans ce projet. Aucune bibliotheque d'emulation, aucun CDN, aucune ROM ni BIOS ne sont utilises.

## Lancement

Ouvrez `index.html` dans un navigateur recent. Le site fonctionne localement et hors ligne. Choisissez une ROM `.gb`, `.gbc` ou une archive `.zip`, ou deposez le fichier sur la zone de chargement. Les fichiers restent sur votre appareil.

Pour un hebergement, utilisez un serveur de fichiers statiques, par exemple `npx serve .` avec Node.js. Aucun build ni installation de dependances n'est necessaire pour ouvrir le site.

### ZIP

- Archives standard avec fichiers stockes (methode 0) ou DEFLATE (methode 8).
- Decompression via l'API native du navigateur `DecompressionStream("deflate-raw")`, sans bibliotheque ZIP.
- Choix du jeu lorsque plusieurs ROM sont presentes, y compris dans des sous-dossiers.
- Verification des tailles, des en-tetes et du CRC32. Pas d'extraction sur le disque.
- Limites : 32 Mio par archive, 8 Mio par ROM, 4096 entrees. ZIP chiffres, ZIP64 et multi-volumes non pris en charge.
- Si votre navigateur ne supporte pas DEFLATE brut, extrayez le ZIP manuellement ou utilisez un navigateur recent.

### Commandes

| Commande | Clavier |
| --- | --- |
| Directions | Fleches |
| A / B | A / Z (AZERTY), Q / W (QWERTY) |
| Start | Entree |
| Select | Maj |

Les raccourcis utilisent les positions physiques (`KeyboardEvent.code`) : A/Z sur AZERTY correspondent a Q/W sur QWERTY, sans detection de la disposition.

Cliquez sur l'ecran pour lui donner le focus apres avoir utilise un bouton de l'interface. Les boutons tactiles fonctionnent aussi a la souris et permettent plusieurs appuis simultanes. Le lecteur propose pause/reprise, redemarrage et activation/coupure du son. Les touches sont relachees lorsque la fenetre perd le focus.

## Coeur maison

- `cpu.js` : instructions normales et CB du LR35902, flags, pile, interruptions, EI differe et HALT.
- `cartridge.js` : ROM simple, MBC1, MBC2, MBC3 avec RTC et MBC5 ; banques ROM/RAM.
- `emulator.js` : bus memoire, joypad, timers, serial interne, DMA, VRAM/WRAM CGB, palettes couleur, changement de vitesse, rendu fond/fenetre/sprites a 160 x 144.
- `audio.js` : synthese des deux canaux pulse, du canal wave et du canal noise, enveloppes, longueur et sweep ; sortie stereo via Web Audio.
- `zip.js` : lecture du repertoire ZIP, extraction native DEFLATE et CRC32.
- `saves.js` : stockage IndexedDB par empreinte SHA-256 de la ROM, commits serialises et restauration RAM/RTC.
- `app.js` : chargement local, choix dans les archives, canvas, boucle temps reel et commandes.

### Limites de cette version experimentale

Ce coeur ne promet pas la compatibilite d'un emulateur mature. Le rendu se fait par lignes avec des durees fixes : les effets raster au pixel pres, les restrictions d'acces VRAM/OAM et les subtilites du DMA/timer/APU ne sont pas reproduits au cycle exact. La synthese sonore est approximative. Le boot ROM est saute, certains registres demarrent avec des valeurs simplifiees. Pas de cable link, manette ni sauvegarde d'etat. Les cartouches speciales (MBC6/7, camera, HuC, multicarts MBC1M...) ne sont pas prises en charge ; les types inconnus sont refuses explicitement. Le moteur de vibration MBC5 n'est pas emule.

## Sauvegardes

Sauvegardez normalement depuis le menu du jeu. La RAM de la cartouche est enregistree dans IndexedDB toutes les secondes lorsqu'elle change, ainsi qu'a la pause, au changement de jeu et au redemarrage. Le bouton **Sauvegarder maintenant** force un commit et le message **Sauvegarde locale enregistree** confirme son succes. Il ne cree pas une sauvegarde d'etat : le jeu doit lui-meme avoir ecrit sa progression dans sa RAM.

- La sauvegarde est restauree automatiquement au chargement. Redemarrer preserve la RAM et l'horloge, mais reinitialise le processeur et la video.
- L'identite du jeu est le SHA-256 du contenu de la ROM, pas son nom : une ROM renommee ou chargee depuis un ZIP retrouve la meme sauvegarde. Deux ROM differentes avec le meme titre restent distinctes.
- L'horloge MBC3 est stockee avec son horodatage et avance pendant la fermeture du site, sauf si le jeu l'a mise en pause.
- **Exporter .sav** telecharge la RAM brute (MBC2 : 512 octets, nibbles bas). Aucun fichier ROM ou ZIP n'est modifie.
- **Importer .sav** exige la taille exacte de la RAM du jeu charge, demande confirmation, remplace la sauvegarde locale et redemarre le jeu. L'horloge RTC locale est conservee. Les fichiers SAV avec un bloc RTC ajoute par un autre emulateur ne sont pas acceptes : le format importe/exporte contient uniquement la RAM.
- Les boutons import/export sont desactives pour les cartouches sans RAM, meme si elles disposent d'une horloge.
- Les erreurs d'acces au stockage ou les sauvegardes invalides sont affichees. Le chargement d'un jeu avec sauvegarde est alors annule plutot que d'ecraser une sauvegarde existante. En cas d'echec d'enregistrement, le jeu actuel reste en memoire et peut etre exporte ; le changement de jeu est bloque jusqu'a ce que le commit reussisse.

Les donnees restent dans ce navigateur, pour cette origine/profil. Effacer les donnees du site ou changer de navigateur, d'adresse ou de chemin local peut rendre les sauvegardes inaccessibles. Le comportement d'IndexedDB sur `file://` depend du navigateur ; un hebergement HTTPS ou localhost est recommande pour une origine stable. Aucun transfert entre onglets n'est synchronise : evitez de jouer a la meme ROM dans deux onglets simultanement (le dernier commit gagne).

Une tentative de commit est faite quand la page devient cachee ou se ferme, et une confirmation de depart est demandee si la RAM reste non enregistree. La fermeture brutale du navigateur ou de l'appareil ne garantit pas ce dernier commit : attendez la confirmation d'enregistrement et gardez des copies `.sav`. Le fichier `.sav` ne transporte pas l'horloge RTC ; celle-ci est conservee uniquement dans le stockage local.

Les tests inclus utilisent des ROM synthetiques creees pour ce projet, pas des jeux commerciaux. Une campagne de compatibilite avec vos ROM legales reste necessaire.

## Tests

Avec Node.js recent (22 ou plus) :

```sh
node --test tests/app.test.cjs tests/cpu.test.cjs tests/emulator.test.cjs tests/zip.test.cjs tests/saves.test.cjs
```

Les tests couvrent le processeur, les banques de cartouche, les timers, la video, les commandes et les archives ZIP (stockees et compressees, multiples ROM, CRC et fichiers invalides). L'interface est aussi testee avec un DOM minimal : activation initiale du son, pause, erreurs d'emulation et chargements concurrents.

Utilisez uniquement des ROM que vous etes autorise a utiliser.
