# Changelog

Les changements notables de chaque version sont consignés ici.

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
