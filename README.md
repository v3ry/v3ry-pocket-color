# v3ry Pocket Color

Émulateur web expérimental pour Game Boy et Game Boy Color, avec un cœur écrit en JavaScript dans ce projet. Il fonctionne sans bibliothèque d'émulation, sans compte et sans service distant.

**Version affichée : 0.9.0** — pré-version expérimentale.

## Fonctionnalités

- Chargement local de fichiers `.gb`, `.gbc` et `.zip`. Les fichiers ne sont pas envoyés sur un serveur.
- Émulation du processeur, de la vidéo, du son et des cartouches compatibles. La compatibilité varie selon les jeux.
- Commandes au clavier, personnalisables, tactiles ou avec une manette standard.
- Pause, redémarrage, plein écran, réglage du volume, avance rapide et capture d'écran PNG.
- Affichage 2D original, filtres visuels et rendus expérimentaux 2.5D/3D lorsque le jeu dispose d'un profil adapté.
- Sauvegarde locale de la mémoire de cartouche, avec récupération, historique et import/export `.sav`.
- Trois emplacements de sauvegarde d'état par jeu, avec aperçu et import/export `.state`.
- Inspecteur graphique et indicateurs de performances.
- Application installable et utilisable hors ligne après préparation sur HTTPS ou localhost.

## Démarrage

Ouvrez `index.html` dans un navigateur récent. Aucun build ni installation de dépendances n'est nécessaire. Pour l'installation hors ligne, utilisez HTTPS ou servez le dossier sur `localhost`.

## Organisation du projet

- `gbc/` : moteur Game Boy / Game Boy Color, audio, cartouches, sauvegardes et rendus spécifiques à cette console. Les profils visuels sont dans `gbc/preset/`.
- À la racine : interface (`index.html`, `styles.css`, `app.js`), lecture des archives (`zip.js`) et application hors ligne.
- `tests/gbc/` : tests et données synthétiques du moteur ; les tests de l'interface, des archives et de la PWA restent dans `tests/`.

Les futurs moteurs pourront être ajoutés dans des dossiers voisins, comme `gba/`, avec leurs tests dans `tests/gba/`. Seul le moteur GB/GBC est présent et relié à l'interface pour le moment.

## Commandes par défaut

| Action | Clavier |
| --- | --- |
| Directions | Flèches |
| A / B | A / Z sur AZERTY, Q / W sur QWERTY |
| Start | Entrée |
| Select | Maj |
| Plein écran | F |
| Sauvegarder / charger un état | F6 / F8 |

Les commandes peuvent être remappées dans **Commandes et performances**. Les raccourcis de sauvegarde demandent confirmation lors du chargement.

## Données et sauvegardes

Les ROM restent sur votre appareil. Les sauvegardes sont stockées dans le navigateur et associées au contenu de la ROM. Elles ne sont pas partagées entre navigateurs ou appareils ; exportez les fichiers importants pour en conserver une copie.

Les sauvegardes `.sav` contiennent la mémoire de cartouche. Les sauvegardes `.state` reprennent l'émulation à un instant précis et sont propres à v3ry Pocket Color. Utilisez uniquement des fichiers et des jeux que vous êtes autorisé à utiliser. Aucune ROM ni aucun BIOS n'est fourni.

## Limites

Le projet est expérimental : la compatibilité et la précision de l'émulation ne sont pas garanties. Les rendus 2.5D/3D sont des prototypes visuels optionnels ; ils ne changent ni les règles ni les commandes du jeu. Les sauvegardes locales peuvent être supprimées par le navigateur.

## Tests

Avec Node.js 22 ou plus récent, depuis la racine du projet :

```sh
node --test
```

## Licence

Le code source, la documentation et les ressources originales sont distribués sous licence **GNU GPL v3 uniquement** (`GPL-3.0-only`). Voir [LICENSE](LICENSE). Les marques et contenus tiers restent la propriété de leurs ayants droit ; le projet n'est ni affilié ni approuvé par Nintendo.
