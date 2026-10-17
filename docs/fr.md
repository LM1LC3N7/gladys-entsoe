# Prix ENTSO-E du lendemain

**Connecteur non officiel, sans lien avec ENTSO-E.** Il lit les prix de
l'électricité du marché du lendemain (day-ahead) d'une zone de marché
européenne sur la
[plateforme de transparence ENTSO-E](https://transparency.entsoe.eu/), la
plateforme publique des gestionnaires de réseau de transport européens,
avec un jeton de sécurité personnel et gratuit.

> **Jamais testé avec un vrai jeton.** Cette première version a été
> construite et testée uniquement sur des réponses reproduites d'après la
> documentation (aucun compte ENTSO-E n'était disponible). Merci de signaler
> ce que vous observez sur le fil du forum ou dans une issue GitHub.

## Ce que vous obtenez

Un appareil, **ENTSO-E <zone>**, avec ces capteurs (prix en €/kWh) :

| Capteur                                  | Contenu                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Prix actuel                              | le prix de la période en cours (15 ou 60 minutes)                                                 |
| Prix de la prochaine période             | le prix de la période suivante                                                                    |
| Minimum / maximum / moyenne du jour      | sur les périodes de votre journée locale (moyenne pondérée par la durée)                          |
| Période la moins chère du jour (début)   | `HH:MM`, heure locale                                                                             |
| Prix le plus bas de demain               | une fois demain publié (en général entre 12 h 45 et 13 h 30, heure de Bruxelles)                  |
| Période la moins chère de demain (début) | `HH:MM`, ou `--:--` tant que demain n'est pas publié                                              |
| Rang de la période actuelle              | 0 = la période la moins chère du jour, 95 la plus chère (99 le jour du passage à l'heure d'hiver) |

Le rang est pratique dans les scènes : « si le rang est inférieur à 16 »
veut dire « pendant les 16 quarts d'heure les moins chers de la journée »
(quatre heures). Des prix égaux partagent le même rang (le rang compte les
périodes strictement moins chères) : un jour avec des égalités, plus de 16
périodes peuvent être « en dessous de 16 ».

**Le prix le plus bas de demain garde son ancienne valeur** jusqu'à la
publication des prix de demain (un nombre ne peut pas être « inconnu » dans
Gladys) : fiez-vous à « période la moins chère de demain », qui affiche
`--:--` en attendant. Dans un fuseau à l'ouest de Bruxelles (Lisbonne,
Londres, Canaries), la dernière heure locale d'une journée appartient au
jour de marché suivant : les valeurs de demain portent sur les heures déjà
publiées.

Les noms des capteurs sont en anglais dans Gladys (ils sont fixés à la
création de l'appareil).

**Ce sont des prix de gros.** Votre fournisseur ajoute sa marge, les frais
de réseau et les taxes. Deux options rapprochent le prix de votre facture :
les **frais fixes** (€/kWh, ajoutés au prix spot) et la **TVA** (%,
appliquée à la somme) : prix = (spot ÷ 1000 + frais) × (1 + TVA ÷ 100). Un
prix spot négatif reste négatif, sauf si les frais le dépassent.

## Obtenir un jeton de sécurité gratuit

1. Créez un compte sur la
   [plateforme de transparence](https://transparency.entsoe.eu/) (**Login**
   → **Register**) et confirmez votre adresse e-mail.
2. Envoyez un e-mail à **transparency@entsoe.eu** avec l'objet
   **« Restful API access »** et, dans le message, l'adresse e-mail de
   votre compte. ENTSO-E active l'accès à l'API à la main, en général en
   quelques jours ouvrés.
3. Une fois l'accès activé, connectez-vous, ouvrez **My Account Settings**
   et, sous **Web API Security Token**, cliquez sur **Generate a new
   token**. Copiez le jeton (il ressemble à
   `1d9cd4bd-f8aa-476c-8cc1-3442dc91506d`).

Le jeton est personnel et gratuit ; ENTSO-E accepte 400 requêtes par
minute, cette intégration en fait quelques-unes par jour.

## Installation

1. Installez l'intégration, collez le jeton dans **Jeton de sécurité
   ENTSO-E**, choisissez votre **zone de marché** (France par défaut) et
   enregistrez.
2. Appuyez sur **Lire les prix maintenant** : le prix actuel et la moyenne
   du jour s'affichent sous le bouton.
3. Ouvrez **Découverte** et ajoutez l'appareil **ENTSO-E <zone>**.

**À propos du jeton :** Gladys le garde dans sa base (en clair, masqué dans
l'interface, et dans ses sauvegardes), ne le réaffiche jamais, et
l'intégration ne l'envoie qu'à ENTSO-E (`web-api.tp.entsoe.eu`). La
plateforme l'exige dans l'adresse de la requête : l'intégration n'écrit
donc jamais d'adresse dans ses journaux.

## Options

| Option                   | Défaut       | Usage                                                                                                                                                         |
| ------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zone de marché           | FR           | 40 zones (France, Belgique, Allemagne/Luxembourg, Italie, pays nordiques…). La changer crée un nouvel appareil ; supprimez l'ancien.                          |
| TVA (%)                  | 0            | de 0 à 50                                                                                                                                                     |
| Frais fixes              | 0 €/kWh      | de 0 à 1                                                                                                                                                      |
| Fuseau horaire de Gladys | Europe/Paris | le fuseau de votre Gladys (Paramètres → Système), en nom IANA. Il fixe le début de la journée et les heures affichées. Un nom inconnu revient à Europe/Paris. |

## Quand les prix sont lus

- Au démarrage : aujourd'hui et demain (une requête).
- Demain est demandé à partir de **13 h, heure de Bruxelles** (l'enchère se
  clôt à midi), puis de nouveau après 10, 20, 30 puis toutes les 60 minutes
  jusqu'à sa publication. La lecture suivante a lieu le lendemain à 13 h.
- Entre deux lectures, les capteurs avancent chaque quart d'heure à partir
  des prix en mémoire, **sans aucun appel réseau**. À minuit, demain devient
  aujourd'hui.
- Une reconnexion à Gladys (le conteneur continue de tourner) garde les
  prix, la pause 429, un jeton refusé et le délai d'attente après une
  erreur, et ne relit pas quand aujourd'hui et demain sont connus. Un
  redémarrage du conteneur repart de zéro : il lit une fois.
- Enregistrer la configuration relit aussitôt, même avec le même jeton
  après un refus (une requête).

## Erreurs

| Situation                             | Ce qui se passe                                                                                                                                                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jeton refusé (401)                    | les lectures **s'arrêtent** et l'état le signale ; les derniers prix restent affichés. Corrigez le jeton (ou attendez qu'ENTSO-E active votre accès à l'API), puis enregistrez la configuration ou appuyez sur **Lire les prix maintenant**. |
| Trop de requêtes (429)                | toute lecture, bouton compris, attend le délai donné par ENTSO-E (d'une minute à six heures ; dix minutes sans délai donné).                                                                                                                 |
| ENTSO-E en panne (5xx), erreur réseau | nouvel essai après 5, 15, 30 puis toutes les 60 minutes ; les derniers prix restent affichés.                                                                                                                                                |
| Aucun prix pour la zone               | l'état le signale ; nouvel essai toutes les heures.                                                                                                                                                                                          |

## Comment les données sont lues

L'intégration demande le document A44 (prix du lendemain, type de contrat
A01). Depuis le 1er octobre 2025, le marché européen du lendemain fonctionne
au **quart d'heure** ; les réponses en périodes de **60 minutes** sont lues
aussi. Dans une courbe en « blocs de taille variable » (A03), une période
absente de la réponse reprend le prix précédent (la règle ENTSO-E) ; dans
les autres courbes, une période absente reste sans prix. Les journées de 23
et 25 heures des changements d'heure sont gérées. La réponse est lue par un analyseur borné
et linéaire, et refusée au-delà de 256 Ko.

## Limites

- Une zone par installation de l'intégration.
- Pas de déclencheur de scène, de widget ni de contrat d'énergie dans cette
  version.
- Prix en €/MWh uniquement : une zone qu'ENTSO-E coterait autrement est
  signalée dans l'état (« pas cotée en EUR/MWh ») et redemandée toutes les
  six heures.
- Jamais testé avec un vrai jeton ENTSO-E (voir le haut de la page).

La logique de lecture est reprise de
[JaccoR/hass-entso-e](https://github.com/JaccoR/hass-entso-e) (Apache-2.0).
