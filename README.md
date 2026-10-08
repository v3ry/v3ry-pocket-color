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

**Commandes et performances** permet de reaffecter les huit commandes. Cliquez sur Changer la touche, puis appuyez sur une touche physique ; Echap annule. Les touches deja affectees a une autre commande et les raccourcis reserves sont refuses. Clavier par defaut restaure les positions AZERTY/QWERTY. Le clavier, le volume (0 a 100 %) et l'affichage FPS sont conserves dans localStorage ; les erreurs de preferences sont signalees sans bloquer le jeu.

Les manettes a disposition **standard** utilisent l'API native Gamepad : croix ou stick gauche (zone morte 0,35), bouton inferieur pour A, bouton droit pour B, boutons 8/9 pour Select/Start. Plusieurs manettes sont combinees avec le clavier et le tactile sans relacher une commande encore maintenue par une autre source. Les commandes sont relachees a la deconnexion, a la pause, pendant une saisie et quand la page perd le focus. Les manettes non standard sont signalees mais ne sont pas remappees automatiquement. Le navigateur peut exiger un appui initial et HTTPS/localhost.

**F6** sauvegarde l'etat dans l'emplacement selectionne ; **F8** le recharge avec confirmation. Ces raccourcis ne s'appliquent pas pendant la saisie ni avec Ctrl/Alt/Meta. L'ecrasement d'un emplacement existant demande confirmation.

L'affichage de performances mesure les images emulees par seconde, le temps CPU d'emulation par callback d'affichage et les rattrapages limites a 50 ms. Ce n'est pas une mesure de precision materielle ni un benchmark de compatibilite. Le budget temps reel tient compte du doublement de vitesse CPU CGB, pour conserver la cadence video/audio. En plein ecran paysage bas, les commandes tactiles sont disposees autour de l'image.

### Plein ecran

Le bouton **Plein ecran** ou la touche **F** agrandit le lecteur. **F**, **Echap** ou le bouton de sortie revient a l'interface normale. Pause, son, volume, etat rapide et commandes tactiles restent accessibles ; les panneaux de sauvegarde sont masques jusqu'a la sortie. Les boutons Etat/Charger utilisent l'emplacement selectionne avant le plein ecran. Sur un appareil a pointeur fin, la barre se masque apres 2,5 secondes : bougez le pointeur ou utilisez Tab pour la retrouver. Elle reste visible au focus clavier et sur les appareils tactiles. L'image garde ses proportions 160 x 144 avec des pixels nets et des bandes si necessaire. La partie et les sauvegardes ne sont pas reinitialisees. Les touches maintenues sont relachees et le focus revient a l'ecran.

Si l'API Fullscreen est absente ou refusee, un message explique le passage a un mode immersif dans la page ; les barres du navigateur peuvent alors rester visibles. F est ignore pendant la saisie, avec Ctrl/Alt/Meta et lors de la repetition automatique.

## Coeur maison

- `cpu.js` : instructions normales et CB du LR35902, flags, pile, interruptions, EI differe et HALT.
- `cartridge.js` : ROM simple, MBC1, MBC2, MBC3 avec RTC et MBC5 ; banques ROM/RAM.
- `emulator.js` : bus memoire, joypad, timers, serial interne, DMA, VRAM/WRAM CGB, palettes couleur, changement de vitesse, rendu fond/fenetre/sprites a 160 x 144.
- `audio.js` : synthese des deux canaux pulse, du canal wave et du canal noise, enveloppes, longueur et sweep ; sortie stereo via Web Audio.
- `zip.js` : lecture du repertoire ZIP, extraction native DEFLATE et CRC32.
- `saves.js` : stockage IndexedDB par empreinte SHA-256 de la ROM, commits serialises et restauration RAM/RTC.
- `states.js` : instantanes versionnes CPU, bus, video, DMA, audio, cartouche et RTC ; validation avant restauration.
- `app.js` : chargement local, choix dans les archives, canvas, boucle temps reel et commandes.

### Acces video et timer

Les acces **CPU** a la VRAM sont bloques en mode LCD 3 ; ceux a l'OAM sont bloques en modes 2 et 3. Les lectures renvoient FF et les ecritures sont ignorees. LCD eteint, les deux memoires sont accessibles. Les transferts DMA utilisent un chemin distinct afin de ne pas appliquer les restrictions CPU a leur source.

Les donnees de palettes CGB sont egalement inaccessibles en mode 3, mais l'auto-increment de l'index fonctionne meme si l'ecriture est refusee. Desactiver TAC quand le bit DIV selectionne est haut incremente TIMA sur DMG, mais pas sur CGB ; changer de frequence avec le timer actif ou reinitialiser DIV conserve le comportement sur front descendant.

Ces regles suivent [Pan Docs : acces VRAM/OAM](https://gbdev.io/pandocs/Accessing_VRAM_and_OAM.html), [palettes](https://gbdev.io/pandocs/Palettes.html) et [timer](https://gbdev.io/pandocs/Timer_Obscure_Behaviour.html). Elles sont testees sur GB/CGB et ne modifient pas le format des etats existants. Les acces sont encore positionnes a la granularite de l'instruction CPU, pas de chaque acces bus.

Le registre LY revient a zero au quatrieme dot de la ligne 153, alors que le PPU reste en VBlank jusqu'a la fin de cette ligne. La comparaison LYC/STAT suit cette valeur visible, sans raccourcir la trame. Ce timing permet notamment a Aladdin GBC de synchroniser ses palettes par ligne sans bandes de couleurs corrompues. Il est teste en GB, en GBC aux deux vitesses CPU et apres restauration d'un etat, sans changement de format.

### Limites de cette version experimentale

Ce coeur ne promet pas la compatibilite d'un emulateur mature. Le rendu se fait par lignes avec des durees fixes : les effets raster au pixel pres et les subtilites du DMA/timer/APU ne sont pas reproduits au cycle exact. La synthese sonore est approximative. Le boot ROM est saute, certains registres demarrent avec des valeurs simplifiees. Pas de cable link. Les cartouches speciales (MBC6/7, camera, HuC, multicarts MBC1M...) ne sont pas prises en charge ; les types inconnus sont refuses explicitement. Le moteur de vibration MBC5 n'est pas emule.

## Sauvegardes

### In-game : RAM de cartouche (.sav)

Sauvegardez normalement depuis le menu du jeu. La RAM de la cartouche est enregistree dans IndexedDB toutes les secondes lorsqu'elle change, ainsi qu'a la pause, au changement de jeu et au redemarrage. **Enregistrer la RAM** force un commit : ce bouton n'appelle pas la fonction Sauvegarder du jeu. Le jeu doit lui-meme avoir ecrit une progression valide dans sa RAM. La confirmation d'enregistrement ne valide pas le checksum propre a chaque jeu.

- La RAM est restauree avant la premiere instruction du jeu. Choisissez **Continuer** dans le menu du jeu, pas Nouvelle partie. Hors du mode etat, Redemarrer preserve la RAM et l'horloge, mais reinitialise le processeur et la video.
- L'identite du jeu est le SHA-256 du contenu de la ROM, pas son nom : une ROM renommee ou chargee depuis un ZIP retrouve la meme sauvegarde. Deux ROM differentes avec le meme titre restent distinctes.
- L'horloge MBC3 est stockee avec son horodatage et avance pendant la fermeture du site, sauf si le jeu l'a mise en pause. Un commit de l'horloge seul ne remplace plus le message de restauration par une confirmation de sauvegarde in-game.
- **Exporter .sav** telecharge la RAM brute (MBC2 : 512 octets, nibbles bas). Aucun fichier ROM ou ZIP n'est modifie.
- **Importer .sav** exige la taille exacte de la RAM du jeu charge, demande confirmation, remplace la sauvegarde locale et redemarre le jeu automatiquement, sans pause. Choisissez **Continuer** dans le jeu. L'horloge RTC locale est conservee. Les fichiers SAV avec un bloc RTC ajoute par un autre emulateur ne sont pas acceptes : le format importe/exporte contient uniquement la RAM. Une taille correcte ne prouve pas que le fichier appartient au jeu ou contient une progression valide.
- **Recharger la RAM locale** relit la copie IndexedDB sans enregistrer la RAM courante, puis redemarre automatiquement. Confirmez l'abandon des modifications courantes.
- **Recuperer la RAM precedente** restaure la copie de recuperation. Avant la premiere modification RAM d'une session restauree, sa RAM originale est conservee dans une entree distincte ; les modifications RAM suivantes et les mises a jour de l'horloge ne font pas tourner cette copie. Un import explicite conserve aussi la RAM locale precedente. Le commit principal et la copie sont ecrits dans la meme transaction. Il s'agit d'une copie, pas d'un historique illimite ; elle ne peut pas recuperer des donnees perdues avant cette fonctionnalite.
- **Historique RAM** conserve en plus les trois versions precedant les derniers commits qui modifient la RAM, avec date d'archivage. Les commits RTC seuls ne font pas tourner l'historique. Choisissez une copie, puis **Restaurer cette copie** : apres confirmation, le jeu redemarre automatiquement ; la version remplacee rejoint l'historique. Principal, recuperation et historique sont ecrits atomiquement. Ces copies ne garantissent pas la validite propre au jeu et ne recuperent pas des donnees perdues avant leur creation.
- Les boutons import/export sont desactives pour les cartouches sans RAM, meme si elles disposent d'une horloge.
- Les erreurs d'acces au stockage ou les sauvegardes invalides sont affichees. Le chargement d'un jeu avec sauvegarde est alors annule plutot que d'ecraser une sauvegarde existante. En cas d'echec d'enregistrement, le jeu actuel reste en memoire et peut etre exporte ; le changement de jeu est bloque jusqu'a ce que le commit reussisse.

Les donnees restent dans ce navigateur, pour cette origine/profil. Effacer les donnees du site ou changer de navigateur, d'adresse ou de chemin local peut rendre les sauvegardes inaccessibles. Le comportement d'IndexedDB sur `file://` depend du navigateur ; un hebergement HTTPS ou localhost est recommande pour une origine stable. Aucun transfert entre onglets n'est synchronise : evitez de jouer a la meme ROM dans deux onglets simultanement (le dernier commit gagne).

Une tentative de commit est faite quand la page devient cachee ou se ferme, et une confirmation de depart est demandee si la RAM reste non enregistree. La fermeture brutale du navigateur ou de l'appareil ne garantit pas ce dernier commit : attendez la confirmation d'enregistrement et gardez des copies `.sav`. Le fichier `.sav` ne transporte pas l'horloge RTC ; celle-ci est conservee uniquement dans le stockage local.

### Etat : reprendre a un instant precis (.state)

- **Sauvegarder l'etat** enregistre l'un des trois emplacements locaux par ROM, independamment de la RAM in-game, avec un nom facultatif, une date et une miniature. Remplacer un emplacement demande confirmation. Les anciens etats locaux restent accessibles dans l'emplacement 1. Changer d'emplacement affiche ses informations sans charger le jeu.
- **Charger l'etat** restaure l'emplacement selectionne et reprend automatiquement, meme si le jeu etait en pause. Il ne redemarre pas le jeu et ne passe pas par son menu Continuer. Les imports et recuperations reprennent aussi automatiquement ; un onglet cache attend naturellement son retour au premier plan.
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

Les tests couvrent le processeur (dont les immediats signes SP), les banques de cartouche, les quatre frequences timer, la video, la cadence video/audio CGB en double vitesse, les commandes et les archives ZIP (stockees et compressees, multiples ROM, CRC et fichiers invalides). L'interface est aussi testee avec un DOM minimal : activation initiale du son, volume, preferences clavier, manettes, plein ecran, reprise automatique apres restauration, emplacements d'etat, historique RAM, FPS, erreurs d'emulation et chargements concurrents.

Utilisez uniquement des ROM que vous etes autorise a utiliser.
