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
- `states.js` : instantanes versionnes CPU, bus, video, DMA, audio, cartouche et RTC ; validation avant restauration.
- `app.js` : chargement local, choix dans les archives, canvas, boucle temps reel et commandes.

### Limites de cette version experimentale

Ce coeur ne promet pas la compatibilite d'un emulateur mature. Le rendu se fait par lignes avec des durees fixes : les effets raster au pixel pres, les restrictions d'acces VRAM/OAM et les subtilites du DMA/timer/APU ne sont pas reproduits au cycle exact. La synthese sonore est approximative. Le boot ROM est saute, certains registres demarrent avec des valeurs simplifiees. Pas de cable link ni manette. Les cartouches speciales (MBC6/7, camera, HuC, multicarts MBC1M...) ne sont pas prises en charge ; les types inconnus sont refuses explicitement. Le moteur de vibration MBC5 n'est pas emule.

## Sauvegardes

### In-game : RAM de cartouche (.sav)

Sauvegardez normalement depuis le menu du jeu. La RAM de la cartouche est enregistree dans IndexedDB toutes les secondes lorsqu'elle change, ainsi qu'a la pause, au changement de jeu et au redemarrage. **Enregistrer la RAM** force un commit : ce bouton n'appelle pas la fonction Sauvegarder du jeu. Le jeu doit lui-meme avoir ecrit une progression valide dans sa RAM. La confirmation d'enregistrement ne valide pas le checksum propre a chaque jeu.

- La RAM est restauree avant la premiere instruction du jeu. Choisissez **Continuer** dans le menu du jeu, pas Nouvelle partie. Hors du mode etat, Redemarrer preserve la RAM et l'horloge, mais reinitialise le processeur et la video.
- L'identite du jeu est le SHA-256 du contenu de la ROM, pas son nom : une ROM renommee ou chargee depuis un ZIP retrouve la meme sauvegarde. Deux ROM differentes avec le meme titre restent distinctes.
- L'horloge MBC3 est stockee avec son horodatage et avance pendant la fermeture du site, sauf si le jeu l'a mise en pause. Un commit de l'horloge seul ne remplace plus le message de restauration par une confirmation de sauvegarde in-game.
- **Exporter .sav** telecharge la RAM brute (MBC2 : 512 octets, nibbles bas). Aucun fichier ROM ou ZIP n'est modifie.
- **Importer .sav** exige la taille exacte de la RAM du jeu charge, demande confirmation, remplace la sauvegarde locale et redemarre le jeu en pause. Cliquez sur **Reprendre**, puis **Continuer** dans le jeu. L'horloge RTC locale est conservee. Les fichiers SAV avec un bloc RTC ajoute par un autre emulateur ne sont pas acceptes : le format importe/exporte contient uniquement la RAM. Une taille correcte ne prouve pas que le fichier appartient au jeu ou contient une progression valide.
- **Recharger la RAM locale** relit la copie IndexedDB sans enregistrer la RAM courante, puis redemarre en pause. Confirmez l'abandon des modifications courantes.
- **Recuperer la RAM precedente** restaure la copie de recuperation. Avant la premiere modification RAM d'une session restauree, sa RAM originale est conservee dans une entree distincte ; les modifications RAM suivantes et les mises a jour de l'horloge ne font pas tourner cette copie. Un import explicite conserve aussi la RAM locale precedente. Le commit principal et la copie sont ecrits dans la meme transaction. Il s'agit d'une copie, pas d'un historique illimite ; elle ne peut pas recuperer des donnees perdues avant cette fonctionnalite.
- Les boutons import/export sont desactives pour les cartouches sans RAM, meme si elles disposent d'une horloge.
- Les erreurs d'acces au stockage ou les sauvegardes invalides sont affichees. Le chargement d'un jeu avec sauvegarde est alors annule plutot que d'ecraser une sauvegarde existante. En cas d'echec d'enregistrement, le jeu actuel reste en memoire et peut etre exporte ; le changement de jeu est bloque jusqu'a ce que le commit reussisse.

Les donnees restent dans ce navigateur, pour cette origine/profil. Effacer les donnees du site ou changer de navigateur, d'adresse ou de chemin local peut rendre les sauvegardes inaccessibles. Le comportement d'IndexedDB sur `file://` depend du navigateur ; un hebergement HTTPS ou localhost est recommande pour une origine stable. Aucun transfert entre onglets n'est synchronise : evitez de jouer a la meme ROM dans deux onglets simultanement (le dernier commit gagne).

Une tentative de commit est faite quand la page devient cachee ou se ferme, et une confirmation de depart est demandee si la RAM reste non enregistree. La fermeture brutale du navigateur ou de l'appareil ne garantit pas ce dernier commit : attendez la confirmation d'enregistrement et gardez des copies `.sav`. Le fichier `.sav` ne transporte pas l'horloge RTC ; celle-ci est conservee uniquement dans le stockage local.

### Etat : reprendre a un instant precis (.state)

- **Sauvegarder l'etat** enregistre manuellement un emplacement local par ROM, independamment de la RAM in-game. Les enregistrements suivants remplacent cet emplacement.
- **Charger l'etat** restaure cet emplacement en pause : cliquez sur **Reprendre**. Il ne redemarre pas le jeu et ne passe pas par son menu Continuer.
- **Exporter .state** cree un fichier de l'instant courant. **Importer .state** recharge un fichier de cet emulateur. Le format JSON versionne est specifique a v3ry Pocket Color, limite a 4 Mio, et lie au SHA-256 exact de la ROM ; une autre version du jeu ou un fichier corrompu est refuse avant de toucher la machine.
- Les instantanes contiennent CPU et interruptions, WRAM/VRAM/OAM, palettes et image, timers et DMA, canaux audio, banques et RAM de cartouche et horloge. Ils ne contiennent pas la ROM, les touches physiques actuellement maintenues ni les buffers audio deja envoyes au navigateur. L'horloge est ramenee a l'instant sauvegarde, sans ajouter le temps reel ecoule.
- **Protection in-game** : apres chargement d'un etat, l'enregistrement automatique RAM/RTC est suspendu. Sauvegarder dans le jeu modifie la RAM de cet etat, mais pas votre `.sav` locale. **Exporter .sav** permet de garder cette RAM ; **Enregistrer la RAM** demande une confirmation pour en faire la sauvegarde in-game locale et reactiver l'automatisme. Une copie de recuperation est conservee.
- **Redemarrer** ou **Recharger la RAM locale** quitte le mode etat et retrouve la sauvegarde in-game locale, sans enregistrer automatiquement la RAM issue de l'etat. Un import `.sav` explicite quitte aussi ce mode.
- Aucun etat n'est charge automatiquement au lancement : utilisez explicitement **Charger l'etat** ou **Importer .state**. Cette fonction marche aussi pour les jeux sans RAM de sauvegarde.

Les tests inclus utilisent des ROM synthetiques creees pour ce projet, pas des jeux commerciaux. Une campagne de compatibilite avec vos ROM legales reste necessaire.

## Tests

Avec Node.js recent (22 ou plus) :

```sh
node --test tests/app.test.cjs tests/cpu.test.cjs tests/emulator.test.cjs tests/zip.test.cjs tests/saves.test.cjs tests/states.test.cjs
```

Les tests couvrent le processeur, les banques de cartouche, les timers, la video, les commandes et les archives ZIP (stockees et compressees, multiples ROM, CRC et fichiers invalides). L'interface est aussi testee avec un DOM minimal : activation initiale du son, pause, erreurs d'emulation et chargements concurrents.

Utilisez uniquement des ROM que vous etes autorise a utiliser.
