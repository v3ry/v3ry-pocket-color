# Changelog

Les changements notables de chaque version sont consignés ici.

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
