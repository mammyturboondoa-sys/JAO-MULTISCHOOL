// English + French text for the Super Administrator account and recovery pages.
import { DICT } from './i18n.js';
const add = (key, en, fr) => { DICT.en[key] = en; DICT.fr[key] = fr; };
const addIfMissing = (key, en, fr) => { if (!DICT.en[key]) add(key, en, fr); };

add('nav.account', 'Account & security', 'Compte et sécurité');
add('owner.title', 'Super Administrator account', 'Compte du Super administrateur');
add('owner.subtitle', 'Your own permanent password and recovery options. Only you can see and change this page.', 'Votre mot de passe permanent et vos options de récupération. Vous seul pouvez voir et modifier cette page.');
add('owner.account', 'Account', 'Compte'); add('owner.email', 'Sign-in e-mail', 'E-mail de connexion'); add('owner.name', 'Name', 'Nom');
add('owner.email_fixed', 'The e-mail address stays as it is.', 'L’adresse e-mail reste inchangée.');
add('owner.pw_changed', 'Password last changed', 'Mot de passe changé le'); add('owner.pw_not_recorded', 'Not recorded (set before this page existed)', 'Non enregistré (défini avant l’existence de cette page)');
add('owner.last_login', 'Last sign-in', 'Dernière connexion');
add('owner.pw_title', 'Change your password', 'Changer votre mot de passe');
add('owner.pw_help', 'Choose a password only you know. It is stored in scrambled form (hashed) and survives restarts, updates and backups. Other devices are signed out when you change it.', 'Choisissez un mot de passe que vous seul connaissez. Il est conservé sous forme brouillée (haché) et survit aux redémarrages, mises à jour et sauvegardes. Les autres appareils sont déconnectés quand vous le changez.');
add('owner.current', 'Current password', 'Mot de passe actuel'); add('owner.new', 'New password', 'Nouveau mot de passe'); add('owner.confirm', 'Confirm the new password', 'Confirmer le nouveau mot de passe');
add('owner.rules', 'At least 10 characters, with letters and numbers. A long phrase is best. It must be different from the current one.', 'Au moins 10 caractères, avec des lettres et des chiffres. Une longue phrase est idéale. Il doit être différent de l’actuel.');
add('owner.show', 'Show passwords', 'Afficher les mots de passe'); add('owner.save_pw', 'Save my new password', 'Enregistrer mon nouveau mot de passe');
add('owner.pw_saved', 'Your new password is saved. It is now the only one that works.', 'Votre nouveau mot de passe est enregistré. C’est désormais le seul qui fonctionne.');
add('owner.str_weak', 'Weak', 'Faible'); add('owner.str_ok', 'Acceptable', 'Acceptable'); add('owner.str_good', 'Good', 'Bon'); add('owner.str_strong', 'Strong', 'Fort');
add('owner.rec_title', 'Recovery codes', 'Codes de récupération');
add('owner.rec_help', 'If you ever forget your password, a recovery code lets you set a new one from the sign-in page. Each code works once. Keep them somewhere safe and private (for example printed, in a locked place).', 'Si vous oubliez votre mot de passe, un code de récupération vous permet d’en définir un nouveau depuis la page de connexion. Chaque code ne fonctionne qu’une fois. Gardez-les en lieu sûr et privé (par exemple imprimés, sous clé).');
add('owner.rec_left', '{n} unused recovery codes', '{n} codes de récupération non utilisés'); add('owner.rec_none', 'No recovery codes yet', 'Aucun code de récupération pour l’instant');
add('owner.rec_low', 'Only {n} left: generate a new set soon.', 'Il n’en reste que {n} : générez bientôt un nouveau jeu.');
add('owner.rec_generate', 'Generate new recovery codes', 'Générer de nouveaux codes de récupération');
add('owner.rec_replace', 'This replaces any recovery codes you had before. Enter your current password to continue.', 'Ceci remplace les codes de récupération que vous aviez. Saisissez votre mot de passe actuel pour continuer.');
add('owner.rec_generated_title', 'Your recovery codes', 'Vos codes de récupération');
add('owner.rec_once', 'These codes are shown ONLY NOW and are not stored in readable form. Copy, download or print them before closing.', 'Ces codes ne sont affichés QU’ICI et ne sont pas conservés sous forme lisible. Copiez, téléchargez ou imprimez-les avant de fermer.');
add('owner.rec_copy', 'Copy', 'Copier'); add('owner.rec_download', 'Download', 'Télécharger'); add('owner.rec_print', 'Print', 'Imprimer'); add('owner.rec_copied', 'Copied.', 'Copié.');
add('owner.rec_saved', 'I have saved these codes in a safe place', 'J’ai conservé ces codes en lieu sûr'); add('owner.rec_done', 'Done', 'Terminé'); add('owner.rec_confirm_first', 'Tick the box once your codes are saved.', 'Cochez la case une fois vos codes conservés.');
add('owner.rec_sheet', 'JAO Super Administrator — recovery codes', 'JAO Super administrateur — codes de récupération'); add('owner.rec_sheet_note', 'Each code works once. Keep this sheet private.', 'Chaque code ne fonctionne qu’une fois. Gardez cette feuille privée.');
add('owner.forgot_title', 'If you forget your password', 'Si vous oubliez votre mot de passe');
add('owner.forgot_text', 'Use one recovery code on the Super Administrator sign-in page (“Forgot your password?”). If you have no codes left, the person who controls the server can run the command npm run reset-owner on it; this only changes the password and signs you out everywhere.', 'Utilisez un code de récupération sur la page de connexion du Super administrateur (« Mot de passe oublié ? »). S’il ne vous reste aucun code, la personne qui contrôle le serveur peut y lancer la commande npm run reset-owner ; elle change seulement le mot de passe et vous déconnecte partout.');
add('owner.forgot_link', 'Forgot your password? Use a recovery code', 'Mot de passe oublié ? Utiliser un code de récupération');
add('owner.recover_title', 'Recover the Super Administrator account', 'Récupérer le compte Super administrateur');
add('owner.recover_text', 'Enter your sign-in e-mail, one of your recovery codes and a new password. The code can be used only once.', 'Saisissez votre e-mail de connexion, l’un de vos codes de récupération et un nouveau mot de passe. Le code ne peut être utilisé qu’une fois.');
add('owner.recover_code', 'Recovery code', 'Code de récupération'); add('owner.recover_btn', 'Set my new password', 'Définir mon nouveau mot de passe');
add('owner.recover_done', 'Your new password is set. You were signed out everywhere. Sign in with it now.', 'Votre nouveau mot de passe est défini. Vous avez été déconnecté partout. Connectez-vous avec lui.');
add('owner.recover_left', '{n} recovery codes remain. Consider generating a new set after you sign in.', 'Il reste {n} codes de récupération. Pensez à générer un nouveau jeu après votre connexion.');
add('owner.back_signin', 'Back to sign in', 'Retour à la connexion');
for (const [k, en, fr] of [
  ['wrong_password', 'The current password is not correct.', 'Le mot de passe actuel n’est pas correct.'],
  ['password_same', 'The new password must be different from the current one.', 'Le nouveau mot de passe doit être différent de l’actuel.'],
  ['invalid_recovery', 'The e-mail or recovery code is not valid.', 'L’e-mail ou le code de récupération n’est pas valide.'],
  ['password_mismatch', 'The passwords do not match.', 'Les mots de passe ne correspondent pas.'],
  ['password_too_short', 'The password must have at least 10 characters.', 'Le mot de passe doit comporter au moins 10 caractères.'],
  ['password_weak', 'The password needs letters and numbers.', 'Le mot de passe doit contenir des lettres et des chiffres.'],
  ['too_many_attempts', 'Too many attempts. Please wait 15 minutes and try again.', 'Trop de tentatives. Veuillez patienter 15 minutes puis réessayer.']]) addIfMissing(`err.${k}`, en, fr);
