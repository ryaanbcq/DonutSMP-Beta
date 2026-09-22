// Qui decide de relancer la connexion, et quand.
//
// Extrait du bot parce que c est exactement ce qui a lache le 15/09 : le ping
// de detection de version n a jamais repondu, mineflayer a emis `error` sans
// jamais emettre `end`, et la seule relance du fichier etait branchee sur
// `end`. Le process est reste vivant sept jours sans etre en jeu, pm2 vert.
//
// Trois regles :
//   - `end` ET `error` peuvent relancer, une seule relance a la fois ;
//   - une connexion morte ne parle plus : ses evenements en retard sont
//     ignores grace au numero de generation ;
//   - un chien de garde relance quoi qu il arrive apres un silence trop long,
//     y compris quand aucun evenement n est venu.

export function creerSuperviseur({
  connecter,
  base = 5_000,
  plafond = 60_000,
  silenceMax = 5 * 60_000,
  minuteur = setTimeout,
  maintenant = () => Date.now(),
  journal = () => {},
}) {
  let generation = 0;
  let essais = 0;
  let prevue = false;
  let vuA = maintenant();

  const delai = () => Math.min(plafond, base * 2 ** essais++);

  return {
    /** Numero de la tentative en cours : les handlers le citent pour se faire entendre. */
    nouvelleGeneration() {
      generation += 1;
      return generation;
    },
    courante(g) { return g === generation; },

    /** Le bot est en jeu : on repart de zero. */
    connecte() {
      essais = 0;
      prevue = false;
      vuA = maintenant();
    },

    /** Signe de vie sans reconnexion (le bot est toujours la). */
    battement() { vuA = maintenant(); },

    /**
     * Programme une relance. Rend le delai retenu, ou null si la demande est
     * ignoree (relance deja prevue, ou generation perimee).
     */
    relancer(raison, g = generation) {
      if (prevue) return null;
      if (g !== generation) return null;
      prevue = true;
      const ms = delai();
      journal(`${raison}, reconnexion dans ${Math.round(ms / 1000)} s`);
      minuteur(() => {
        prevue = false;
        vuA = maintenant();
        connecter();
      }, ms);
      return ms;
    },

    /**
     * A appeler regulierement. `enJeu` dit si le bot est reellement en jeu.
     * Rend true si le chien de garde a mordu.
     */
    chienDeGarde(enJeu) {
      if (enJeu) { this.connecte(); return false; }
      if (prevue) return false;
      if (maintenant() - vuA < silenceMax) return false;
      // Personne n a rien dit depuis trop longtemps : la tentative en cours est
      // abandonnee (sa generation devient perimee) et on repart.
      generation += 1;
      essais = 0;
      vuA = maintenant();
      prevue = true;
      journal('chien de garde : pas en jeu depuis trop longtemps, relance forcee');
      minuteur(() => { prevue = false; connecter(); }, 0);
      return true;
    },
  };
}
