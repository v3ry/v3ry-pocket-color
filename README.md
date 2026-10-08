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

### Avance rapide et captures

Le selecteur **Vitesse** propose x1, x2 et x4, y compris en plein ecran. Il multiplie le budget d'emulation sans modifier la vitesse CPU materielle du jeu. La vitesse obtenue depend des performances de votre appareil. Le son est temporairement coupe en x2/x4 et ses buffers sont vides pour ne pas accumuler de retard ; revenir a x1 retrouve le son s'il etait active. Changer de vitesse ne reprend pas un jeu en pause. La vitesse reste un reglage de session, pas une preference persistante ni un champ des etats.

**Capture PNG** telecharge l'image originale 160 x 144, sans interface, en jeu ou en pause. Le nom comprend celui de la ROM et un horodatage. La capture ne change ni la partie ni les sauvegardes.

### Prototype 2.5D et presets

Chargez **Pokemon Cristal UE version 1.1** ou **Aladdin GBC**, puis choisissez **Rendu > 2.5D**. Le mode 2D reste le choix par defaut. Le panneau **Camera et relief 2.5D / 3D** regle rotation, inclinaison, zoom, relief et ombrage ; Camera du preset retrouve les valeurs adaptees au jeu. Les reglages fonctionnent aussi en pause. Le selecteur reste accessible en plein ecran et permet de revenir instantanement en **2D original**, sans redemarrer.

Le rendu utilise **WebGL natif**, sans moteur ni bibliotheque 3D. Le fond est un assemblage de tuiles extrudees et la fenetre GB/CGB reste un affichage fixe par-dessus la scene. Aladdin utilise une profondeur uniforme et un plan de sprites separe. Cristal reconstruit plusieurs hauteurs de decor et redresse les silhouettes de personnages. La capture des couches est activee uniquement en 2.5D ou 3D : elle observe les lignes du rendu original, conserve leurs palettes et respecte la transparence, la priorite et la limite de dix sprites par ligne. Cela preserve notamment les couleurs raster de l'introduction d'Aladdin. Les sprites visibles devant la fenetre sont conserves avec cet affichage fixe.

Les textures proviennent de la derniere image complete. A l'activation ou apres un chargement d'etat, l'image originale sert provisoirement de plan unique jusqu'a la prochaine image complete ; en pause, reprendre le jeu permet de reconstruire les couches. Le rendu 2.5D est limite a 30 actualisations par seconde, sans changer le budget du coeur. Son cout et la fluidite dependent du GPU et du navigateur. Si WebGL est absent, echoue ou perd son contexte, un message explique le retour au mode 2D ; la partie continue.

**C'est un prototype visuel, pas une conversion automatique en vrai jeu 3D.** Les collisions, la physique, les commandes et les sauvegardes restent celles du jeu 2D. Les personnages sont des silhouettes pixelisees inclinees et surelevees, pas des modeles 3D. La geometrie utilise les registres de scroll et les identifiants de tuiles actuels : les changements de scroll ou de carte par ligne ne sont pas reconstruits en geometrie, meme si leurs pixels sont conserves. Une fenetre utilisee comme decor plutot que comme HUD peut paraitre detachee. Camera et mode de rendu ne sont pas inclus dans les etats. Les captures PNG restent en 2D originale.

**Cristal : un relief non uniforme.** Le preset `preset/pokemon-crystal.js` lit les pointeurs de tileset et les blocs proches dans la banque physique WRAM 1, puis les definitions graphiques et collisions dans la ROM de l'utilisateur. Il compare des groupes de 2 x 2 tuiles, avec leur banque VRAM, plutot que d'attribuer une hauteur arbitraire a un identifiant de tuile reutilisable :

Ses reglages par defaut sont : rotation **0 degre**, inclinaison **-20 degres**, zoom **83 %**, relief **14** et ombrage **73 %**. **Camera du preset** restaure ces cinq valeurs.

- Sol a hauteur zero ; murs/obstacles/arbres a 20 unites, mobilier interactif a 12, rebords a 5, herbe a 2 et eau a -2, avant multiplication par **Relief / 8**.
- Les faces laterales relient les obstacles au sol. Les bordures uniformes hors carte sont masquees pour eviter une enorme plaque de vide surelevee.
- Les silhouettes disjointes du calque sprites ont chacune leur pied et une hauteur progressive vers leur tete. La transparence est preservee ; deux silhouettes tres proches peuvent encore etre groupees.
- Au moins **85 % de la surface visible** doit correspondre aux definitions de carte. Sinon le preset affiche exactement les pixels 2D sans perspective et le signale : titres, menus, combats et transitions restent lisibles. Le relief revient automatiquement quand la carte est reconnue.

Cette classification est une **approximation par collision**, pas une identification precise des toits et facades : un mur et une cime d'arbre peuvent avoir la meme hauteur, une porte peut rester au sol, et des graphismes ambigus utilisent la plus petite hauteur connue. Les pointeurs, dimensions et limites ROM/WRAM sont controles. La disposition memoire a ete verifiee sur **Cristal UE 1.1** ; Cristal 1.0, Or, Argent et les ROM modifiees ne sont pas certifies et n'ont pas de preset equivalent. Aucune ROM, table graphique ou sauvegarde n'est embarquee.

References de format : [blocs et collisions](https://github.com/pret/pokecrystal/blob/master/data/tilesets.asm), [types de collision](https://github.com/pret/pokecrystal/blob/master/constants/collision_constants.asm), [chargement de carte](https://github.com/pret/pokecrystal/blob/master/home/map.asm). L'analyse et le renderer du projet restent implementes ici, sans code d'emulation externe.

Les reglages propres aux jeux sont dans **`preset/`** :

- `match` selectionne le titre interne, le mode CGB et le type de cartouche, jamais le nom du fichier. `revision` peut exiger l'octet de revision ROM (1 pour Cristal 1.1). Ce n'est pas une certification des ROM modifiees.
- `camera` definit `yaw` (-45 a 45 degres), `pitch` (-35 a 35) et `zoom` (0,5 a 1,3).
- `backgroundDepth` et `spriteDepth` separent les plans ; `thickness` (0 a 16) definit l'extrusion vers l'arriere pour Aladdin, ou l'intensite du relief pour Cristal.
- `light` definit l'ombrage initial entre 0 et 1 ; sans valeur, l'ombrage reste a 0,75.
- `tileDepths` associe une cle `"banque VRAM:identifiant de tuile"` a un decalage de profondeur entre -32 et 32. Par exemple, `"1:42": 6` avance la tuile 42 de banque 1 de six unites. Les identifiants peuvent changer de contenu selon les scenes : des regles semantiques demandent une analyse specifique du jeu.
- `terrain(game)` peut fournir une carte de profondeurs 32 x 32 avec `active`, `reason`, `depths` et un masque `hidden`. Ses profondeurs sont multipliees par Relief / 8 et doivent rester dans [-64, 64] apres multiplication. `active: false` conserve la vue originale et affiche `reason`. `raisedSprites` active le relief par silhouette, uniquement quand la carte est reconnue.

Pour ajouter un preset, declarez-le dans `PocketPresets`, chargez son script avant `app.js` dans `index.html` et ajoutez-le aux fichiers caches de `sw.js` avec une nouvelle version de cache. Ces scripts ordinaires fonctionnent aussi en ouverture locale, sans serveur ni chargement externe.

### Mode 3D : tous les types de lieux de Cristal

Dans **Cristal UE 1.1**, choisissez **Rendu > 3D - Cristal**. Le mode suit automatiquement les cartes explorables reconnues : villes, routes, interieurs, grottes, passages, donjons et environnement special. Les 36 tilesets et les sept categories d'environnement ont le meme chemin de reconstruction, sans liste de cartes a autoriser individuellement. Cela ne certifie pas une visite exhaustive de chaque carte du jeu.

**Bourg Geon conserve son preset detaille** : sol horizontal, arbres a tronc et cime en volume, quatre maisons avec toits a deux pentes, panneaux debout et ombres geometriques. **Ailleurs, le rendu est generique** : les blocs locaux actifs en WRAM donnent une grille de 6 x 5 metatuiles (192 x 160 pixels), reconstruite avec les definitions graphiques de la ROM, les pixels VRAM et les palettes actuelles. Chaque secteur de 16 x 16 pixels est pose horizontalement a une hauteur derivee de sa collision ; obstacles et mobilier ont des faces laterales texturees, l'eau est abaissee et les personnages sont debout.

`world.js` partage le renderer WebGL et l'extraction de silhouettes avec le mode 2.5D. Ses modeles et petites textures pixelisees sont generes ici, sans moteur externe, images copiees ou donnees de ROM embarquees. Le preset `preset/pokemon-crystal.js` identifie la carte 24/4, tileset 1, 10 x 9 blocs, et lit les **blocs actifs en WRAM**, pas une carte statique embarquee. Les blocages et entrees restent ceux de l'emulation. Les portes sont placees aux colonnes d'entree du decor original.

- Les controles de camera restent les memes. Bourg Geon ajoute 40 degres d'inclinaison et multiplie le zoom par 0,6 pour ouvrir le paysage ; les cartes generiques ajoutent 25 degres et multiplient le zoom par 0,9 pour mieux cadrer la region locale. Les cinq valeurs preferees du mode 2.5D restent inchangees. Relief 14 correspond a l'echelle normale des modeles et personnages.
- Les blocs non classes par le preset detaille de Bourg Geon passent au rendu generique. **Start conserve le decor 3D** dans toute carte reconnue : menu et description fixes, pixels et commandes du jeu. Les sous-menus plein ecran, combats et cartes graphiques non reconnus reviennent aux pixels originaux. Les dialogues utilisant la fenetre restent fixes et lisibles. Pointeurs invalides, LCD eteint, transitions ou moins de 85 % de terrain reconnu gardent un retour explicite au rendu precedent/original.
- La camera suit SCX/SCY par rapport a l'ancrage graphique de destination, y compris lors d'un deplacement vers la gauche/le haut et du bouclage 255/0. Cela evite les sauts de 16 pixels dus a la preparation anticipee des blocs. Sol et modeles statiques sont reutilises tant que leurs donnees ne changent pas ; seul le decalage de camera est transmis au shader. Les silhouettes et ombres des personnages restent actualisees.
- Les cinq passes (sol, modeles, ombres, personnages, interface) ont leurs propres buffers GPU et textures. Les sommets et textures inchanges ne sont pas retransmis ; les modeles, ombres et menus ne remplacent plus mutuellement leur texture. Ce cache reste borne a cinq buffers et cinq textures, liberes a la fermeture du renderer. Il reduit les transferts, sans garantir un gain de FPS si le cout dominant vient de l'emulation.
- **Reconstruction approximative, pas une conversion du jeu en 3D native.** Hors de Bourg Geon, les toits, arbres, rochers et meubles restent des secteurs textures sureleves, pas des modeles semantiques comme les maisons detaillees. Les palettes de tuiles sont deduites par vote dans la carte VRAM ; une tuile absente utilise la palette 0, donc certaines couleurs peuvent differer. Les animations de tuiles et changements de palettes invalident le cache. Les graphismes modifies par ligne ne sont pas reconstruits dans les textures generiques.
- Le terrain couvre la ville entiere a Bourg Geon et une **region locale renouvelee pendant le deplacement** ailleurs. Le bord de cette region reste visible avec une camera large. Seuls les personnages visibles dans l'image Game Boy sont disponibles : ils peuvent apparaitre/disparaitre au bord du champ, etre tronques ou regroupes s'ils se touchent. Les sprites caches par le decor 2D ne sont pas recuperes. Il ne s'agit pas encore d'une camera libre explorant un monde complet.
- Aucun changement de physique, de collision, de sauvegarde ou d'etat. Le rendu reste opt-in, plafonne a 30 Hz et fonctionne hors ligne ; les captures PNG restent celles de la 2D originale.

Les conversations utilisant la boite de texte standard de Cristal (six rangees en bas de l'ecran) gardent le decor 3D, detaille ou generique. Le cadre, le texte anime et l'indicateur de suite restent fixes en surimpression avec les pixels du jeu. La reconnaissance verifie tout le cadre et le terrain restant : un combat, un menu plein ecran ou une boite non reconnue conserve le retour en 2D.

Un preset peut exposer `world(game)` avec `active`, `reason`, les dimensions en blocs, `blocks` (tableau ligne par ligne), `ground` (materiaux et berges par bloc), `objects` (arbres, maisons et panneaux avec leurs positions), `originX`/`originY` en pixels et un masque `overlay` optionnel de 160 x 144 pixels pour l'interface. Toutes les classifications propres a Bourg Geon restent dans **`preset/pokemon-crystal.js`**, pas dans le renderer partage. Ajouter d'autres jeux/cartes necessite leur propre classification, pas seulement activer ce champ.

La variante `generic: true` fournit `tiles` (24 x 20 codes avec identifiant/banque VRAM dans l'octet bas et palette dans les bits 8-10) et `surfaces` (positions et hauteurs de secteurs 16 x 16). `zoomFactor`, `pitchOffset` et `clearColor` adaptent le cadrage et le fond ; les interieurs et grottes utilisent un fond sombre. Les tables propres a Cristal restent dans son preset et `graphics.js` decode les textures en lecture seule.

### Application installable et hors ligne

Sous **HTTPS ou localhost**, le lecteur prepare automatiquement ses fichiers pour une utilisation hors ligne. Attendez le message **Application prete hors ligne** avant de couper la connexion. Installez-le avec le bouton propose par les navigateurs compatibles, ou depuis leur menu (sur iOS : Partager puis Sur l'ecran d'accueil). La disponibilite de l'installation depend du navigateur ; le lecteur reste utilisable sans installation.

Le service worker ne met en cache que les fichiers de l'application : **aucune ROM, ZIP, sauvegarde ou requete externe**. Les ROM restent a selectionner sur votre appareil, les sauvegardes restent dans IndexedDB. Le navigateur peut purger ces donnees ; exportez les sauvegardes importantes. Une installation sur un autre domaine ou port ne partage pas le stockage de la page locale.

Les mises a jour ne rechargent jamais une partie en cours. Lorsqu'une mise a jour est prete, sauvegardez puis fermez tous les onglets/fenetres de cette application et rouvrez-la. Pour publier une modification des fichiers caches, incrementez la version `CACHE` dans `sw.js` afin de conserver un ensemble coherent de fichiers.

En ouverture `file://`, le lecteur fonctionne deja sans reseau mais ne peut pas installer de service worker. Pour tester la PWA localement, servez ce dossier sur localhost avec un serveur de fichiers statiques. Aucun compte, serveur de ROM ni dependance d'emulation n'est ajoute.

## Coeur maison

### Inspecteur graphique

Ouvrez **Inspecteur graphique** dans le lecteur pour examiner les 384 tuiles de chaque banque VRAM, les deux cartes 32 x 32 (attributs CGB et adressage signe inclus), les 40 sprites OAM et les palettes BG/OBJ. Les positions, banques, palettes et flips des sprites ainsi que les registres LCD sont disponibles sous les apercus. Les pixels transparents sont affiches sur un damier.

Les cases Fond, Fenetre et Sprites isolent les couches dans un **apercu separe**, sans modifier le jeu, ses entrees ni ses sauvegardes. Cet apercu reutilise le rendu du coeur avec la VRAM et les registres actuels ; il ne reproduit pas les changements de palettes/scroll intervenus pendant la derniere image. Il respecte les couches activees par LCDC. L'inspecteur est masque en plein ecran.

L'actualisation en direct est limitee a 5 Hz et ne travaille pas lorsque le panneau est ferme. Decochez-la pour garder une vue fixe, ou utilisez Actualiser, y compris lorsque le jeu est en pause. Banque 1 et palettes 2-7 sont reservees au CGB ; le GB utilise BGP et les deux palettes OBJ.

- `cpu.js` : instructions normales et CB du LR35902, flags, pile, interruptions, EI differe et HALT.
- `cartridge.js` : ROM simple, MBC1, MBC2, MBC3 avec RTC et MBC5 ; banques ROM/RAM.
- `emulator.js` : bus memoire, joypad, timers, serial interne, DMA, VRAM/WRAM CGB, palettes couleur, changement de vitesse, rendu fond/fenetre/sprites a 160 x 144.
- `audio.js` : synthese des deux canaux pulse, du canal wave et du canal noise, enveloppes, longueur et sweep ; sortie stereo via Web Audio.
- `zip.js` : lecture du repertoire ZIP, extraction native DEFLATE et CRC32.
- `saves.js` : stockage IndexedDB par empreinte SHA-256 de la ROM, commits serialises et restauration RAM/RTC.
- `states.js` : instantanes versionnes CPU, bus, video, DMA, audio, cartouche et RTC ; validation avant restauration.
- `graphics.js` : inspection video en lecture seule et reconstruction des couches avec le rendu partage.
- `scene.js`, `preset/aladdin.js`, `preset/pokemon-crystal.js` : geometrie, camera et rendu WebGL 2.5D ; classification du relief Cristal par collisions.
- `pwa.js`, `sw.js`, `manifest.webmanifest` : installation, cache hors ligne limite aux fichiers de l'application et mises a jour sans interruption de partie.
- `app.js` : chargement local, choix dans les archives, canvas, boucle temps reel et commandes.

### Acces video et timer

Les acces **CPU** a la VRAM sont bloques en mode LCD 3 ; ceux a l'OAM sont bloques en modes 2 et 3. Les lectures renvoient FF et les ecritures sont ignorees. LCD eteint, les deux memoires sont accessibles hors conflit DMA. Les transferts DMA utilisent un chemin distinct afin de ne pas appliquer les restrictions CPU a leur source.

Les donnees de palettes CGB sont egalement inaccessibles en mode 3, mais l'auto-increment de l'index fonctionne meme si l'ecriture est refusee. Desactiver TAC quand le bit DIV selectionne est haut incremente TIMA sur DMG, mais pas sur CGB ; changer de frequence avec le timer actif ou reinitialiser DIV conserve le comportement sur front descendant.

Ces regles suivent [Pan Docs : acces VRAM/OAM](https://gbdev.io/pandocs/Accessing_VRAM_and_OAM.html), [palettes](https://gbdev.io/pandocs/Palettes.html) et [timer](https://gbdev.io/pandocs/Timer_Obscure_Behaviour.html). Elles sont testees sur GB/CGB et ne modifient pas le format des etats existants. Les acces sont encore positionnes a la granularite de l'instruction CPU, pas de chaque acces bus.

Le registre LY revient a zero au quatrieme dot de la ligne 153, alors que le PPU reste en VBlank jusqu'a la fin de cette ligne. La comparaison LYC/STAT suit cette valeur visible, sans raccourcir la trame. Ce timing permet notamment a Aladdin GBC de synchroniser ses palettes par ligne sans bandes de couleurs corrompues. Il est teste en GB, en GBC aux deux vitesses CPU et apres restauration d'un etat.

### DMA progressif, duree de rendu et horloge audio

- **OAM DMA** copie un octet toutes les quatre horloges CPU, pendant 640 horloges (640 dots en vitesse normale, 320 en double vitesse). La source est lue au moment de chaque copie. Une nouvelle ecriture dans FF46 recommence le transfert. Le CPU n'est plus artificiellement arrete : il peut executer sa routine en HRAM. Sur GB, les autres acces CPU sont bloques ; sur CGB, le bus source (cartouche, WRAM ou VRAM) et l'OAM sont bloques, mais les autres bus restent accessibles. Les conflits renvoient FF ou ignorent les ecritures ; les interruptions internes ne sont pas faussement declenchees par ces lectures bloquees.
- **Video** garde des lignes de 456 dots, mais allonge le mode 3 selon SCX modulo 8, le demarrage de la fenetre (+6) et les fetches des dix premiers sprites de la ligne (+6 a +11). Le mode 0 et le declenchement HDMA suivent cette fin variable. La condition WY est memorisee au debut des lignes puis remise a zero au VBlank ; sur CGB, desactiver la fenetre efface cette condition. Les lignes dont la recherche OAM chevauche un DMA ne dessinent pas de sprites.
- **Audio** utilise le front descendant du bit interne DIV 12 (13 en double vitesse) pour le sequenceur 512 Hz : longueurs, sweep et enveloppes. Ecrire DIV quand ce bit est haut produit aussi un tick audio. La generation des echantillons est intercalee avec cette horloge et conserve sa cadence dans les deux modes CPU. L'APU eteinte ne fait pas avancer le sequenceur. Le routage et le volume NR51/NR50 correspondent aux canaux gauche/droite Web Audio, sans inversion stereo.

References : [Pan Docs : OAM DMA](https://gbdev.io/pandocs/OAM_DMA_Transfer.html), [rendu](https://gbdev.io/pandocs/Rendering.html), [fenetre](https://gbdev.io/pandocs/Window.html) et [DIV-APU](https://gbdev.io/pandocs/Audio_details.html#div-apu).

### Limites de cette version experimentale

Ce coeur ne promet pas la compatibilite d'un emulateur mature. Le rendu reste par lignes : les penalites du mode 3 sont calculees a la fin du mode 2, pas par un FIFO pixel. Les modifications au milieu du mode 3 et les cas particuliers WX=0/166 restent approximatifs. Les acces CPU et le demarrage DMA sont encore positionnes a la granularite de l'instruction. Les valeurs de bus pendant les conflits, les glitches OAM d'un DMA demarre en mode 3, le GDMA/HDMA immediat et les subtilites du timer/APU ne sont pas reproduits au cycle exact. La synthese sonore reste approximative malgre le sequenceur synchronise. Le boot ROM est saute, certains registres demarrent avec des valeurs simplifiees. Pas de cable link. Les cartouches speciales (MBC6/7, camera, HuC, multicarts MBC1M...) ne sont pas prises en charge ; les types inconnus sont refuses explicitement. Le moteur de vibration MBC5 n'est pas emule.

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
- Les nouveaux etats sont en **version 2**, pour conserver le DMA OAM en cours, la duree de rendu et la condition de fenetre. Les etats version 1 restent lisibles : leur DMA etait deja copie immediatement, donc aucun transfert OAM n'est invente a la restauration. Les nouveaux etats ne sont pas lisibles par les anciennes versions de l'application.
- Les instantanes contiennent CPU et interruptions, WRAM/VRAM/OAM, palettes et image, timers et DMA, canaux audio, banques et RAM de cartouche et horloge. Ils ne contiennent pas la ROM, les touches physiques actuellement maintenues ni les buffers audio deja envoyes au navigateur. L'horloge est ramenee a l'instant sauvegarde, sans ajouter le temps reel ecoule.
- **Protection in-game** : apres chargement d'un etat, l'enregistrement automatique RAM/RTC est suspendu. Sauvegarder dans le jeu modifie la RAM de cet etat, mais pas votre `.sav` locale. **Exporter .sav** permet de garder cette RAM ; **Enregistrer la RAM** demande une confirmation pour en faire la sauvegarde in-game locale et reactiver l'automatisme. Une copie de recuperation est conservee.
- **Redemarrer** ou **Recharger la RAM locale** quitte le mode etat et retrouve la sauvegarde in-game locale, sans enregistrer automatiquement la RAM issue de l'etat. Un import `.sav` explicite quitte aussi ce mode.
- Aucun etat n'est charge automatiquement au lancement : utilisez explicitement **Charger l'etat** ou **Importer .state**. Cette fonction marche aussi pour les jeux sans RAM de sauvegarde.

Les tests inclus utilisent des ROM synthetiques creees pour ce projet, pas des jeux commerciaux. Une campagne de compatibilite avec vos ROM legales reste necessaire.

## Tests

Avec Node.js recent (22 ou plus) :

```sh
node --test tests/app.test.cjs tests/cpu.test.cjs tests/emulator.test.cjs tests/graphics.test.cjs tests/scene.test.cjs tests/pwa.test.cjs tests/zip.test.cjs tests/saves.test.cjs tests/states.test.cjs
```

Les tests couvrent le processeur (dont les immediats signes SP), les banques de cartouche, les quatre frequences timer, le DMA progressif et ses conflits de bus, les penalites video, la fenetre, DIV-APU, la cadence video/audio CGB en double vitesse, l'inspecteur en lecture seule, la migration et la restauration des etats, les commandes et les archives ZIP (stockees et compressees, multiples ROM, CRC et fichiers invalides). L'interface est aussi testee avec un DOM minimal : activation initiale du son, volume, preferences clavier, manettes, plein ecran, reprise automatique apres restauration, emplacements d'etat, historique RAM, FPS, erreurs d'emulation et chargements concurrents.

Les tests 2.5D couvrent la selection des presets/revisions, les UV, le clipping et le bouclage de carte, l'extrusion, les palettes par ligne, la recomposition exacte des couches, les limites/priorites des sprites, la conservation des etats, les reglages en pause et les replis WebGL. Les tests Cristal verifient les hauteurs distinctes, les silhouettes independantes, la limite de reconnaissance a 85 %, les banques et bornes memoire, et les menus sans perspective. Le pipeline WebGL est teste avec un contexte simule ; la compilation des shaders et le rendu reel doivent aussi etre verifies dans un navigateur.

Utilisez uniquement des ROM que vous etes autorise a utiliser.
