// English + French text for the Prefects page. Loaded by pages-prefects.js.
import { DICT } from './i18n.js';
const add = (key, en, fr) => { DICT.en[key] = en; DICT.fr[key] = fr; };

add('nav.prefects', 'Prefects', 'Préfets');
add('pf.subtitle', 'The student leaders of the school for each academic year.', 'Les élèves responsables de l’école pour chaque année scolaire.');
add('pf.rule', 'Only students of Form 5, Lower Sixth and Upper Sixth can be appointed as prefects.', 'Seuls les élèves de Form 5, Lower Sixth et Upper Sixth peuvent être nommés préfets.');
add('pf.year', 'Academic year', 'Année scolaire');
add('pf.tab_board', 'Prefects', 'Préfets'); add('pf.tab_posts', 'Posts', 'Postes');
add('pf.appoint', 'Appoint a prefect', 'Nommer un préfet'); add('pf.student', 'Student', 'Élève'); add('pf.post', 'Post', 'Poste');
add('pf.search_student', 'Search by name or ID', 'Rechercher par nom ou matricule'); add('pf.choose_student', 'Choose a student', 'Choisissez un élève'); add('pf.choose_post', 'Choose a post', 'Choisissez un poste');
add('pf.no_eligible', 'No eligible student found. Students must be active and in Form 5, Lower Sixth or Upper Sixth.', 'Aucun élève éligible trouvé. Les élèves doivent être inscrits et en Form 5, Lower Sixth ou Upper Sixth.');
add('pf.none', 'No prefect has been appointed for this year yet.', 'Aucun préfet n’a encore été nommé pour cette année.');
add('pf.appointed', 'Prefect appointed.', 'Préfet nommé.');
add('pf.end', 'End post', 'Mettre fin au poste'); add('pf.restore', 'Restore', 'Rétablir'); add('pf.ended', 'Ended', 'Terminé');
add('pf.end_confirm', 'End this prefect post? The record is kept in the list.', 'Mettre fin à ce poste de préfet ? Le dossier reste dans la liste.');
add('pf.ended_on', 'Ended on {d}', 'Terminé le {d}'); add('pf.reason_no_longer_eligible', 'No longer in Form 5 – Upper Sixth', 'N’est plus en Form 5 – Upper Sixth');
add('pf.posts_hint', 'Rename, add or switch off posts to match your school.', 'Renommez, ajoutez ou désactivez des postes selon votre école.');
add('pf.off', 'Off', 'Désactivé'); add('pf.switch_off', 'Switch off', 'Désactiver'); add('pf.switch_on', 'Switch on', 'Activer');
add('err.prefect_not_eligible', 'Only an active student of Form 5, Lower Sixth or Upper Sixth can be a prefect.', 'Seul un élève inscrit de Form 5, Lower Sixth ou Upper Sixth peut être préfet.');
add('err.prefect_exists', 'This student already holds this post for this year.', 'Cet élève occupe déjà ce poste pour cette année.');
add('err.invalid_student', 'Choose a valid student.', 'Choisissez un élève valide.'); add('err.invalid_post', 'Choose a valid post.', 'Choisissez un poste valide.');
add('err.invalid_year', 'Choose a valid academic year.', 'Choisissez une année scolaire valide.'); add('err.invalid_action', 'This action is not valid.', 'Cette action n’est pas valide.');
add('profile.prefect', 'Prefect', 'Préfet'); add('profile.prefect_past', 'ended', 'terminé');
