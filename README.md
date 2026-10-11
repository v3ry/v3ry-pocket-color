# v3ry Pocket Color

Émulateurs web expérimentaux pour Game Boy, Game Boy Color et Game Boy Advance, avec des cœurs écrits en JavaScript dans ce projet. L'application fonctionne sans bibliothèque d'émulation, sans compte et sans service distant.

**Version affichée : 0.10.1** — pré-version expérimentale.

## Fonctionnalités

- Chargement local de fichiers `.gb`, `.gbc`, `.gba` et `.zip`, avec choix de la ROM dans les archives multijeux ou multiconsoles. Les fichiers ne sont pas envoyés sur un serveur.
- Émulation du processeur, de la vidéo, du son et des cartouches compatibles. La compatibilité varie selon les jeux.
- Émulation expérimentale du Game Boy Printer : les jeux compatibles envoient leur image, qui se déroule progressivement à l’écran.
- Commandes au clavier, personnalisables, tactiles ou avec une manette standard.
- Pause, redémarrage, plein écran, avance rapide et capture PNG à la résolution de la console. Le son des deux cœurs est disponible et le volume est réglable.
- Affichage 2D original ; filtres et rendus expérimentaux 2.5D/3D pour le GB/GBC lorsque le jeu dispose d'un profil adapté.
- Sauvegarde locale de la mémoire de cartouche, avec récupération, historique et import/export `.sav`.
- Trois emplacements de sauvegarde d'état par jeu GB/GBC, avec aperçu et import/export `.state`.
- Inspecteur graphique GB/GBC et indicateurs de performances pour les deux moteurs.
- Application installable et utilisable hors ligne après préparation sur HTTPS ou localhost.

## Démarrage

Ouvrez `index.html` dans un navigateur récent. Aucun build ni installation de dépendances n'est nécessaire. Pour l'installation hors ligne, utilisez HTTPS ou servez le dossier sur `localhost`.

## Organisation du projet

- `gbc/` : moteur Game Boy / Game Boy Color, audio, cartouches, sauvegardes et rendus spécifiques à cette console. Les profils visuels sont dans `gbc/preset/`.
- `gba/` : CPU ARM7TDMI en modes ARM/Thumb, cartouches, bus mémoire, vidéo 2D, audio, timers, interruptions, DMA et services BIOS partiels du moteur GBA.
- À la racine : interface (`index.html`, `styles.css`, `app.js`), lecture des archives (`zip.js`) et application hors ligne.
- `tests/gbc/` et `tests/gba/` : tests et données synthétiques des moteurs ; les tests de l'interface, des archives et de la PWA restent dans `tests/`.
- `tools/gba-probe.cjs` : sonde sans interface pour une ROM GBA (`node tools/gba-probe.cjs rom.gba [images]`) ; elle affiche en JSON le premier arrêt (instruction, SWI ou DMA non pris en charge, avec adresse et registres), les redémarrages de la console et le nombre d'appels BIOS.

L'interface sélectionne le moteur d'après l'extension de la ROM, y compris dans un ZIP. Le stockage transactionnel existant est partagé ; les clés de sauvegarde GBA sont séparées des clés GB/GBC.

## Commandes par défaut

| Action | Clavier |
| --- | --- |
| Directions | Flèches |
| A / B | A / Z sur AZERTY, Q / W sur QWERTY |
| Start | Entrée |
| Select | Maj |
| L / R (GBA) | E / R |
| Plein écran | F |
| Sauvegarder / charger un état (GB/GBC) | F6 / F8 |

Les commandes peuvent être remappées dans **Commandes et performances**. Les raccourcis de sauvegarde demandent confirmation lors du chargement.

## Données et sauvegardes

Les ROM restent sur votre appareil. Les sauvegardes sont stockées dans le navigateur et associées au contenu de la ROM. Elles ne sont pas partagées entre navigateurs ou appareils ; exportez les fichiers importants pour en conserver une copie.

Les sauvegardes `.sav` contiennent la mémoire de cartouche. Les sauvegardes `.state` reprennent l'émulation à un instant précis et sont propres à v3ry Pocket Color. Utilisez uniquement des fichiers et des jeux que vous êtes autorisé à utiliser. Aucune ROM ni aucun BIOS n'est fourni.

Les cartouches GBA avec signatures SRAM, Flash (64/128 Kio) ou EEPROM (512 octets/8 Kio) sont prises en charge. La taille EEPROM est détectée à partir des commandes DMA3 ou du fichier `.sav` importé. Les sauvegardes GBA peuvent être importées, exportées et restaurées depuis l'historique. Les états `.state` restent réservés au GB/GBC.

Les exports EEPROM stockent les octets dans l'ordre du flux série (bit de poids fort en premier), par blocs de 8 octets. Certains émulateurs utilisent l'ordre inverse dans chaque bloc : leurs fichiers nécessitent une conversion avant import ; cet ordre n'est pas détectable automatiquement.

Les ZIP stockés ou DEFLATE sont acceptés jusqu'à 64 Mio, avec contrôle du CRC et sélection dans les sous-dossiers. La limite par ROM reste de 8 Mio pour GB/GBC et de 32 Mio pour GBA. Les ZIP chiffrés, ZIP64 et multi-volumes ne sont pas pris en charge.

## Limites

Le projet est expérimental : la compatibilité et la précision de l'émulation ne sont pas garanties. Les rendus 2.5D/3D sont des prototypes visuels optionnels ; ils ne changent ni les règles ni les commandes du jeu. Les sauvegardes locales peuvent être supprimées par le navigateur.

Le moteur GBA est une première implémentation, vérifiée avec des ROM synthétiques, pas une certification de la ludothèque. Il propose les modes vidéo 0 à 5, fonds à tuiles/affines, sprites, fenêtres et effets de couleur, avec une précision de timing approximative. L'audio comprend les quatre canaux PSG et les deux sorties Direct Sound avec FIFO, timers et DMA ; le mixage et la précision audio restent approximatifs. Certains services BIOS sont réimplémentés sans BIOS externe (division, racine carrée, ArcTan, BitUnPack, copie/remplissage, attentes, matrices affines BG/OBJ, Huffman, LZ77, RLE, filtres différentiels, somme de contrôle, SoundBias, MidiKey2Freq et CustomHalt) ; d'autres, notamment le pilote sonore du BIOS et MultiBoot, arrêtent explicitement l'émulation avec une erreur. Un saut à l'adresse 0 ou le service HardReset redémarre la console sans l'animation du logo. Le décodage couvre tous les groupes d'instructions ARM et Thumb de l'ARM7TDMI ; seules les instructions indéfinies (coprocesseur, extensions ARMv5 et suivantes) arrêtent l'émulation, et le timing des instructions reste approximatif. Le DMA3 en capture vidéo est pris en charge. Les périphériques de cartouche (dont RTC), le link, les états, les shaders et la 3D GBA ne sont pas implémentés.

Référence matérielle : [GBATEK](https://mgba-emu.github.io/gbatek/). Aucun code de moteur tiers ni données graphiques de jeu ne sont intégrés.

## Tests

Avec Node.js 22 ou plus récent, depuis la racine du projet :

```sh
node --test
```

## Licence

Le code source, la documentation et les ressources originales sont distribués sous licence **GNU GPL v3 uniquement** (`GPL-3.0-only`). Voir [LICENSE](LICENSE). Les marques et contenus tiers restent la propriété de leurs ayants droit ; le projet n'est ni affilié ni approuvé par Nintendo.
