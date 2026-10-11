# Changelog

Les changements notables de chaque version sont consignés ici.

## [Non publié]

### Ajouté

- GB/GBC : cartouches MBC7 (type `0x22`, utilisées par Kirby Tilt 'n' Tumble et Command Master). La mémoire EEPROM 93LC56 (256 octets, sauvegardée en `.sav`) et les commandes READ, WRITE, ERASE, WRAL, ERAL, EWEN et EWDS sont émulées, ainsi que la double activation de la RAM. L'accéléromètre est émulé au repos : il n'y a pas d'entrée d'inclinaison.
- GB/GBC : cartouches MMM01 (types `0x0B` à `0x0D`). Le menu final de la ROM est affiché au démarrage, et l'en-tête est lu à la fin de la ROM. Les registres de sélection de jeu, de masque et de RAM suivent Pan Docs. Hypothèses non vérifiées sur matériel : le masque ROM verrouille les bits de sélection selon la valeur du registre 0x6000, et la RAM non mappée utilise la même banque que le mode mappé. Le bit 7 (multiplexage) n'est pas émulé.
- GB/GBC : câble de liaison entre deux consoles (`gbc/link.js`). Le maître (horloge interne) échange son octet avec l'esclave armé (horloge externe) à la fin du transfert, avec IRQ des deux côtés ; sans esclave prêt, le maître reçoit `0xFF`. Le câble est testé en mode normal et en vitesse CGB rapide. L'échange est instantané à la fin du transfert, pas bit par bit, et l'interface ne propose pas encore de deuxième console.
- GBA : câble multijoueur à 2 à 4 consoles (`gba/link.js`). Les registres SIOCNT (bits SI, SD, ID, erreur, occupé, IRQ) et SIOMULTI0 à 3 suivent GBATEK. Le parent est la première console branchée. Un enfant absent ou non prêt interrompt la chaîne : les emplacements suivants restent à `0xFFFF` et l'erreur est levée. Le câble n'a pas de délai par enfant ni de timeout, et l'interface ne propose pas encore de deuxième console.
- GB/GBC : cartouches HuC1 (type `0xFF`) avec commutation des banques ROM et RAM, sans activation de RAM, et mode infrarouge qui renvoie `0xC0`. Pas de capteur réel.
- GB/GBC : cartouches HuC3 (type `0xFE`) avec RAM protégée selon le mode, boîte aux lettres et commandes de mémoire à 4 bits. L'horloge (snapshot et réglage), le générateur de tonalités et l'infrarouge réel ne sont pas émulés ; les valeurs de lecture non documentées sont des estimations.
- GBA : sauvegardes d'état (slots, sauvegarde et chargement rapides, export/import `.state` et aperçu), comme pour GB/GBC. Le format `v3ry-pocket-color-gba-state` est distinct de celui du GB/GBC ; un état ne se charge que dans la même ROM et est entièrement validé avant d'être appliqué.
- GBA : pilote sonore HLE pour les services BIOS 0x1A à 0x24, 0x28 et 0x29 (init, mode, main, VSync, clear, start, stop, continue, fade-out). Seuls les canaux carrés 1 et 2 du PSG sont joués. Le format de partition est documenté dans `gba/emulator.js`. Il n'a été validé que par des tests synthétiques : aucun jeu testé n'appelle ces services, et les noms BIOS exacts restent à confirmer. `SoundGetJumpList` (0x2A) remplit la table de 36 entrées avec des zéros : les appels passant par ces entrées ne sont pas reproduits.
- GBA : service BIOS `MultiBoot` (0x25) sans partenaire de liaison. Aucun esclave ne répond, donc aucun client n'est marqué et rien n'est envoyé.
- GBA : horloge temps réel (S-3511A) des cartouches Pokémon Rubis, Saphir et Émeraude. La date et l'heure sont lues et écrites via GPIO, et l'état est conservé dans les sauvegardes d'état. Le protocole suit GBATEK ; il n'a pas encore été validé sur une vraie cartouche.
- GBA : registres de liaison série (SIOCNT, SIODATA, SIOMULTI, RCNT) avec transfert temporisé et IRQ, en mode normal, multijoueur et UART. Le câble est considéré comme débranché : aucun partenaire ne répond, et le multijoueur signale une erreur. Le multijoueur réel n'est pas géré.
- Interface : thème clair, sombre ou système, réglable dans « Affichage, commandes et performances ». Le choix est conservé avec les autres réglages (version 3 des préférences). Par défaut, le thème suit le système, ce qui change l'apparence des navigateurs réglés en sombre.

### Corrigé

- GBA : l'horloge temps réel (S-3511A) ignorait les commandes d'état. Le code assemblait la commande de bit 0 à bit 7, alors que le matériel l'envoie MSB first avec la forme `0110 rrr r` (registre sur les bits 1 à 3, lecture sur le bit 0). Les commandes de statut (`0x62`/`0x63`) n'étaient donc pas reconnues, et la réinitialisation (`0x60`) n'était pas prise en compte. Les dates et heures, déjà reconnues par chance, ne changent pas.
- GBA : un DMA répété (sauf mode immédiat) recharge désormais son nombre d'unités depuis le registre `DMAxCNT_L` à chaque déclenchement, comme GBATEK le décrit. Avant, la valeur figée à l'activation était réutilisée, donc une modification du compteur pendant le DMA était ignorée. Le test de priorité confirme que, à déclenchement égal, le DMA le plus bas s'exécute en premier.
- GBA : le son Direct Sound manquait dans Super Mario Advance. Une demande de remplissage de FIFO faite pendant que le DMA son était désarmé restait bloquée et n'était jamais renouvelée. Chaque dépassement de minuteur demande désormais le remplissage tant que la FIFO contient 16 octets ou moins.
- GBA : le Direct Sound était envoyé du mauvais côté. Les bits de routage gauche et droite de SOUNDCNT_H et le volume gauche de SOUNDCNT_L étaient inversés.
- GBA : le canal ondes du PSG continuait de sonner après l'arrêt de son compteur ou la coupure de son DAC (NR30). Il est désormais silencieux dans ces cas.
- GBA : la coupure du son (SOUNDCNT_X bit 7) effaçait SOUNDCNT_H, alors que le matériel le conserve. SOUNDCNT_L est toujours remis à zéro, et sa lecture ne renvoie plus une valeur périmée.
- GBA : en mode bitmap 4, l'index de couleur 0 était opaque. Il est désormais transparent, comme en mode tuile : un sprite de priorité supérieure ne reste plus masqué.
- GBA : les canaux PSG étaient environ 4,6 fois plus forts que le Direct Sound par rapport au matériel. Un canal au maximum vaut désormais un quart de la pleine échelle Direct Sound, comme dans GBATEK. Les jeux qui jouent surtout avec le PSG sonnent donc nettement plus bas qu'avant.

## [0.11.0] - 2026-10-11

### Ajouté

- GBA : services BIOS `GetBiosChecksum` (0x0D), `SoundBias` (0x19), `MidiKey2Freq` (0x1F) et `CustomHalt` (0x27).
- GBA : capture vidéo DMA3 (démarrage spécial) : un transfert par ligne de la 2ᵉ à la 161ᵉ, arrêt à la ligne 162.
- GBA : les arrêts d'émulation lèvent une erreur structurée (`kind`, `report` avec adresse, opcode ou service SWI, mode, registres et image), aussi conservée dans `lastStop`.
- GBA : un saut à l'adresse 0 (vecteur de reset) ou le service `HardReset` (0x26) redémarre la console depuis la cartouche, comme le matériel, au lieu d'arrêter l'émulation. Chaque redémarrage est consigné dans `resets` et affiché par la sonde.
- Outil `tools/gba-probe.cjs` : exécute une ROM `.gba` ou `.zip` sans interface et affiche le premier arrêt, les redémarrages et le nombre d'appels BIOS.
- Tests : balayage exhaustif des 65 536 encodages Thumb et de tous les groupes de décodage ARM, qui ne rejettent plus que les instructions indéfinies sur ARM7TDMI.

### Corrigé

- GBA : une IRQ imbriquée dans un gestionnaire d'interruption ne remet plus le processeur en attente d'`IntrWait` à son retour : le processeur restait figé au milieu du gestionnaire, le VBlank masqué n'était jamais traité et le jeu appelait ensuite un pointeur nul (007 Everything or Nothing redémarrait vers l'image 2442).
- GBA : à la fin d'un gestionnaire, `IntrWait` se termine immédiatement si l'interruption attendue a été signalée pendant que le gestionnaire la masquait, au lieu d'attendre le VBlank suivant (image perdue).
- GBA : un registre de contrôle DMA avec contrôle de source réservé (3) incrémente l'adresse au lieu d'arrêter l'émulation ; le DMA0 en démarrage spécial (interdit) ne s'arrête plus et ne transfère rien.
- GBA : une écriture de PC avec le bit S en mode User/System, qui n'a pas de SPSR, laisse CPSR inchangé au lieu d'arrêter l'émulation.
- GBA : un encodage `STRD` (indéfini sur ARMv4) n'est plus décodé comme `MSR`.
- Le cache hors ligne est renouvelé pour diffuser ces correctifs.

## [0.10.1] - 2026-10-10

### Corrigé

- GBA : une interruption reçue pendant `VBlankIntrWait`/`IntrWait` (par exemple VCount) est maintenant traitée immédiatement, puis l'attente reprend. Les changements de mode vidéo en milieu d'image étaient auparavant retardés jusqu'au VBlank, ce qui dédoublait la scène et produisait des triangles noirs (Mario Kart Super Circuit).
- Le rendu affine GBA accumule désormais correctement la transformation scanline par scanline et applique immédiatement les écritures des références, notamment celles déclenchées par DMA en HBlank. Cela améliore les effets de perspective pseudo-3D (« Mode 7 »).
- Les paramètres affines sont maintenant échantillonnés au début de chaque ligne, après les DMA HBlank, plutôt qu'à sa fin.
- L’image GBA n’est présentée qu’après la fin des 160 lignes visibles, évitant d’afficher une trame partiellement mise à jour.
- Le cache hors ligne est renouvelé pour diffuser les correctifs graphiques.

## [0.10.0] - 2026-10-10

### Ajouté

- Émulation expérimentale du Game Boy Printer : réception des images imprimées et rendu progressif de la feuille.
- Panneau d'impression sous le sélecteur de ROM, masquable et réaffiché lors d'une nouvelle impression.

### Modifié

- Incrément de la version de l'application et du cache hors ligne.
