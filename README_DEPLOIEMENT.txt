SLPJ · MISE À JOUR GITHUB - 30 NOVEMBRE HORS CALCUL - VERSION V3

Correction : le menu déroulant des horaires du lundi 30 novembre n'affiche plus
« 48 h max. » et ne bloque plus une sélection pour ce motif.
Le lundi 30 reste soumis uniquement aux autres règles applicables : créneaux autorisés,
pause et repos. Ses heures sont enregistrées et affichées, mais non comptabilisées.

MODIFICATION GITHUB UNIQUEMENT :
1. À la racine du dépôt publié sur GitHub Pages, remplacer index.html et app.js
   par les fichiers contenus dans l'archive. L'archive complète comprend également
   les autres fichiers, identiques à la version V2 pour faciliter un déploiement complet.
2. Confirmer le commit et attendre que GitHub Actions / Pages indique le déploiement réussi.
3. Ouvrir https://planning-equipe.runs-at.dev/?v=20261115-v3
   puis faire Cmd+Maj+R.
4. Vérifier « Version 30 novembre v3 · règles chargées » à l'accueil,
   puis le menu des horaires du lundi 30 novembre.

AUCUNE modification SQL / Supabase Edge n'est nécessaire pour cette correction d'affichage.
NE JAMAIS publier de secrets Supabase ni l'archive Supabase privée sur GitHub.
