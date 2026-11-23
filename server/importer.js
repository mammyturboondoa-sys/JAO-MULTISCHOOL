'use strict';
// The Data Import Centre engine. Every category is described once (columns, checks, how a valid row is saved).
// Rules that hold for ALL categories:
//   * everything is scoped by the school of the signed-in administrator (taken from the session, never from the request);
//   * the server validates every row itself, whatever the browser says;
//   * saving is ONE database transaction: if anything fails, nothing is saved;
//   * every record created or changed is logged in import_items so the batch can be rolled back safely.
const crypto = require('node:crypto');
const S = require('./security');
const X = require('./xlsx');

const MAX_ROWS = 10000;
const CATEGORIES_SHOP = ['textbooks', 'notebooks', 'reading_books', 'school_supplies', 'school_uniforms'];
const SHOP_LABELS = {
  textbooks: ['textbooks', 'textbook', 'manuels', 'manuel', 'manuels scolaires'], notebooks: ['notebooks', 'notebook', 'cahiers', 'cahier'],
  reading_books: ['reading books', 'reading_books', 'livres de lecture', 'livre de lecture', 'lecture'],
  school_supplies: ['school supplies', 'school_supplies', 'fournitures scolaires', 'fournitures', 'supplies'],
  school_uniforms: ['school uniforms', 'school_uniforms', 'uniformes scolaires', 'uniformes', 'uniforme', 'uniform'],
};

// ---------- small helpers ----------
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
const cell = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000);
const today = () => new Date().toISOString().slice(0, 10);
function parseDate(s) {
  s = cell(s); if (!s) return null;
  let m;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) return fixDate(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s))) return fixDate(+m[3], +m[2], +m[1]); // day first (DD/MM/YYYY)
  if (/^\d{5}$/.test(s)) return X.serialToIso(Number(s));
  return null;
}
function fixDate(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(iso + 'T00:00:00Z'); return dt.getUTCMonth() + 1 === mo && dt.getUTCDate() === d ? iso : null;
}
function parseNum(s) {
  s = cell(s).replace(/\s|\u00a0/g, '').replace(/fcfa|xaf|f$/i, ''); if (s === '') return null;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ''); else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
}
const yes = (s) => ['1', 'yes', 'y', 'oui', 'o', 'true', 'vrai', 'x', 'active', 'actif'].includes(norm(s));
const no = (s) => ['0', 'no', 'n', 'non', 'false', 'faux', 'inactive', 'inactif'].includes(norm(s));
const GENDERS = { male: 'male', m: 'male', masculin: 'male', homme: 'male', garcon: 'male', boy: 'male', female: 'female', f: 'female', feminin: 'female', femme: 'female', fille: 'female', girl: 'female', other: 'other', autre: 'other' };
const STATUS = { active: 'active', actif: 'active', transferred: 'transferred', transfere: 'transferred', graduated: 'graduated', diplome: 'graduated' };
const LEVELS = { o: 'ordinary', ol: 'ordinary', ordinary: 'ordinary', 'o level': 'ordinary', 'ordinary level': 'ordinary', ordinaire: 'ordinary', 'niveau ordinaire': 'ordinary', 'gce o level': 'ordinary', 'gce ordinary level': 'ordinary',
  a: 'advanced', al: 'advanced', advanced: 'advanced', 'a level': 'advanced', 'advanced level': 'advanced', avance: 'advanced', 'niveau avance': 'advanced', 'gce a level': 'advanced', 'gce advanced level': 'advanced' };
const parseLevel = (s) => LEVELS[norm(s)] || null;
const classLabel = (name, section) => `${name}${section ? (section.length === 1 ? '' : ' ') + section : ''}`;

// ---------- messages (EN / FR) ----------
const MSG = {
  en: { required: 'This field is required.', bad_date: 'Not a valid date. Use YYYY-MM-DD or DD/MM/YYYY.', future_date: 'The date cannot be in the future.', bad_number: 'Not a valid number.', bad_gender: 'Use male, female or other.',
    bad_status: 'Use active, transferred or graduated.', bad_email: 'Not a valid e-mail address.', bad_phone: 'Not a valid phone number.', year_not_found: 'Academic year “{v}” does not exist. Create it first (or import it under Academic years).',
    no_current_year: 'No academic year is marked as current. Fill in the academic year column.', class_not_found: 'Class “{v}” does not exist for that academic year.', subject_not_found: 'No subject with code “{v}”.', term_not_found: 'Term “{v}” does not exist in that academic year.',
    student_not_found: 'No student with code “{v}” in this school.', teacher_not_found: 'No active teacher with e-mail “{v}”.', class_full: 'The class is full (capacity {v}).', dup_in_file: 'Duplicate of row {v} in this file.',
    code_format: 'Use letters, digits, - or _ only.', bad_coef: 'The coefficient must be greater than 0 and at most 100.', not_in_class: 'This subject is not taught in the student’s class. Add it to the class first.',
    student_year: 'The student’s class belongs to a different academic year than this term.', score_range: 'The mark must be between 0 and {v}.', max_needed: 'Assessment “{v}” does not exist: give its maximum score to create it.',
    max_conflict: 'Another row gives a different maximum score for this same assessment.', bad_max: 'The maximum score must be greater than 0 and at most 1000.', bad_type: 'Use quiz, test, assignment, oral, project or exam.',
    bad_category: 'Unknown category. Use: textbooks, notebooks, reading books, school supplies or school uniforms.', bad_price: 'The price must be a whole number of FCFA (0 or more).', bad_qty: 'The quantity must be a whole number (0 or more).',
    product_not_found: 'No product with code “{v}”.', bad_level: 'Use Ordinary Level (O) or Advanced Level (A).', bad_year_num: 'Not a valid examination year.', cand_taken: 'Candidate number already registered for another student.',
    student_has_cand: 'This student already has a different candidate number for that exam.', setting_bad: 'Invalid value for this setting.', bad_image: 'Image “{v}” was not attached or is not a valid JPG/PNG/WEBP of at most 2 MB.',
    email_in_use: 'This e-mail address is already used in this school.', nothing_to_change: 'Nothing to change.', blank_score: 'No mark entered: this row is skipped.', example_ignored: 'Example row ignored.' },
  fr: { required: 'Ce champ est obligatoire.', bad_date: 'Date non valide. Utilisez AAAA-MM-JJ ou JJ/MM/AAAA.', future_date: 'La date ne peut pas être dans le futur.', bad_number: 'Nombre non valide.', bad_gender: 'Utilisez male, female ou other (masculin, féminin, autre).',
    bad_status: 'Utilisez actif, transféré ou diplômé.', bad_email: 'Adresse e-mail non valide.', bad_phone: 'Numéro de téléphone non valide.', year_not_found: 'L’année scolaire « {v} » n’existe pas. Créez-la d’abord (ou importez-la dans Années scolaires).',
    no_current_year: 'Aucune année scolaire n’est marquée comme courante. Remplissez la colonne année scolaire.', class_not_found: 'La classe « {v} » n’existe pas pour cette année scolaire.', subject_not_found: 'Aucune matière avec le code « {v} ».', term_not_found: 'Le trimestre « {v} » n’existe pas dans cette année scolaire.',
    student_not_found: 'Aucun élève avec le matricule « {v} » dans cet établissement.', teacher_not_found: 'Aucun enseignant actif avec l’e-mail « {v} ».', class_full: 'La classe est pleine (capacité {v}).', dup_in_file: 'Doublon de la ligne {v} de ce fichier.',
    code_format: 'Utilisez uniquement lettres, chiffres, - ou _.', bad_coef: 'Le coefficient doit être supérieur à 0 et au plus 100.', not_in_class: 'Cette matière n’est pas enseignée dans la classe de l’élève. Ajoutez-la d’abord à la classe.',
    student_year: 'La classe de l’élève appartient à une autre année scolaire que ce trimestre.', score_range: 'La note doit être comprise entre 0 et {v}.', max_needed: 'L’évaluation « {v} » n’existe pas : indiquez sa note maximale pour la créer.',
    max_conflict: 'Une autre ligne donne une note maximale différente pour cette même évaluation.', bad_max: 'La note maximale doit être supérieure à 0 et au plus 1000.', bad_type: 'Utilisez quiz, test, assignment, oral, project ou exam.',
    bad_category: 'Catégorie inconnue. Utilisez : manuels, cahiers, livres de lecture, fournitures scolaires ou uniformes scolaires.', bad_price: 'Le prix doit être un nombre entier de FCFA (0 ou plus).', bad_qty: 'La quantité doit être un nombre entier (0 ou plus).',
    product_not_found: 'Aucun produit avec le code « {v} ».', bad_level: 'Utilisez Niveau ordinaire (O) ou Niveau avancé (A).', bad_year_num: 'Année d’examen non valide.', cand_taken: 'Ce numéro de candidat est déjà enregistré pour un autre élève.',
    student_has_cand: 'Cet élève a déjà un autre numéro de candidat pour cet examen.', setting_bad: 'Valeur non valide pour ce paramètre.', bad_image: 'L’image « {v} » n’a pas été jointe ou n’est pas un JPG/PNG/WEBP valide de 2 Mo maximum.',
    email_in_use: 'Cette adresse e-mail est déjà utilisée dans cet établissement.', nothing_to_change: 'Rien à modifier.', blank_score: 'Aucune note saisie : cette ligne est ignorée.', example_ignored: 'Ligne d’exemple ignorée.' },
};
const say = (lang, code, v) => (MSG[lang] || MSG.en)[code].replace('{v}', v ?? '');

// ---------- category definitions ----------
// col: [key, requiredFlag, 'English heading', 'Titre français', example1, example2, hint EN, hint FR, [allowed values]]
const C = (key, req, en, fr, e1, e2, hen, hfr, list) => ({ key, required: !!req, en, fr, ex: [e1 ?? '', e2 ?? ''], hint: { en: hen || '', fr: hfr || '' }, list });
const YEAR_HINT = ['Leave empty to use the current academic year.', 'Laissez vide pour utiliser l’année scolaire courante.'];

const DEFS = {};
const def = (key, o) => { DEFS[key] = { key, ...o }; };

def('academic_years', { updatable: true, title: ['Academic years and terms', 'Années scolaires et trimestres'], existing: 'update', existingNote: ['Existing years only get the missing terms.', 'Les années existantes reçoivent seulement les trimestres manquants.'],
  cols: [C('academic_year', 1, 'Academic year', 'Année scolaire', '2025-2026', '2026-2027', 'Example: 2025-2026.', 'Exemple : 2025-2026.'), C('terms', 0, 'Terms', 'Trimestres', 'Term 1; Term 2; Term 3', 'Term 1; Term 2; Term 3', 'Separate the terms with a semicolon.', 'Séparez les trimestres par un point-virgule.'),
    C('is_current', 0, 'Current year', 'Année courante', 'yes', 'no', 'yes / no. Only one year can be current.', 'oui / non. Une seule année peut être courante.')] });
def('classes', { updatable: true, title: ['Classes and sections', 'Classes et sections'], existing: 'skip', existingNote: ['Existing classes can get a new capacity or class teacher.', 'Les classes existantes peuvent recevoir une nouvelle capacité ou un titulaire.'],
  cols: [C('class_name', 1, 'Class', 'Classe', 'Form 1', 'Form 1', 'Example: Form 1, Class 6, Lower Sixth.', 'Exemple : 6ème, Form 1, Lower Sixth.'), C('section', 0, 'Section', 'Section', 'A', 'B', 'Example: A, B, Science, Arts.', 'Exemple : A, B, Scientifique, Littéraire.'),
    C('academic_year', 0, 'Academic year', 'Année scolaire', '2025-2026', '2025-2026', ...YEAR_HINT), C('capacity', 0, 'Capacity', 'Effectif maximum', '60', '60', 'Maximum number of students.', 'Nombre maximal d’élèves.'),
    C('teacher_email', 0, 'Class teacher e-mail', 'E-mail du titulaire', 'teacher@school.cm', '', 'Must be an existing teacher.', 'Doit être un enseignant existant.')] });
def('subjects', { updatable: true, title: ['Subjects and subject codes', 'Matières et codes de matières'], existing: 'skip', existingNote: ['Existing subjects (same code) can be updated.', 'Les matières existantes (même code) peuvent être mises à jour.'],
  cols: [C('code', 1, 'Subject code', 'Code matière', 'MATH', 'ENG', 'Letters, digits, - or _. Not case sensitive.', 'Lettres, chiffres, - ou _. Insensible à la casse.'), C('name', 1, 'Subject name', 'Nom de la matière', 'Mathematics', 'English Language'),
    C('description', 0, 'Description', 'Description', '', ''), C('default_coefficient', 0, 'Default coefficient', 'Coefficient par défaut', '4', '3', 'Used when a class has no coefficient of its own.', 'Utilisé si une classe n’a pas de coefficient propre.'),
    C('active', 0, 'Active', 'Actif', 'yes', 'yes', 'yes / no.', 'oui / non.')] });
def('coefficients', { updatable: true, title: ['Subject coefficients (per class and year)', 'Coefficients des matières (par classe et année)'], existing: 'update', existingNote: ['Existing coefficients are updated.', 'Les coefficients existants sont mis à jour.'],
  cols: [C('academic_year', 0, 'Academic year', 'Année scolaire', '2025-2026', '2025-2026', ...YEAR_HINT), C('class_name', 1, 'Class', 'Classe', 'Form 1', 'Form 1'), C('section', 0, 'Section', 'Section', 'A', 'A'),
    C('subject_code', 1, 'Subject code', 'Code matière', 'MATH', 'ENG', 'Must already exist.', 'Doit déjà exister.'), C('coefficient', 1, 'Coefficient', 'Coefficient', '4', '3', 'A number above 0, up to 100.', 'Un nombre supérieur à 0, jusqu’à 100.'),
    C('teacher_email', 0, 'Subject teacher e-mail', 'E-mail de l’enseignant', '', '', 'Optional. Existing teacher.', 'Facultatif. Enseignant existant.')] });
def('teachers', { title: ['Teachers', 'Enseignants'], existing: 'skip', existingNote: ['Existing teachers are never changed.', 'Les enseignants existants ne sont jamais modifiés.'], secret: true,
  cols: [C('full_name', 1, 'Full name', 'Nom complet', 'Paul Mbarga', 'Grace Tabi'), C('email', 1, 'E-mail', 'E-mail', 'paul@school.cm', 'grace@school.cm', 'Used to sign in. A temporary password is created.', 'Sert à se connecter. Un mot de passe temporaire est créé.')] });
def('students', { title: ['Student records', 'Dossiers des élèves'], existing: 'skip', existingNote: ['Existing students (same name and date of birth) are never changed.', 'Les élèves existants (même nom et date de naissance) ne sont jamais modifiés.'],
  cols: [C('full_name', 1, 'Full name', 'Nom complet', 'Mary Ngu', 'Peter Fon'), C('dob', 1, 'Date of birth', 'Date de naissance', '2012-03-15', '15/08/2011', 'YYYY-MM-DD or DD/MM/YYYY.', 'AAAA-MM-JJ ou JJ/MM/AAAA.'),
    C('gender', 0, 'Gender', 'Genre', 'female', 'male', 'male / female / other.', 'masculin / féminin / autre.', ['male', 'female', 'other']), C('birthplace', 0, 'Place of birth', 'Lieu de naissance', 'Yaoundé', 'Douala'),
    C('class_name', 1, 'Class', 'Classe', 'Form 1', 'Form 1', 'Must exist.', 'Doit exister.'), C('section', 0, 'Section', 'Section', 'A', 'A'), C('academic_year', 0, 'Academic year', 'Année scolaire', '2025-2026', '2025-2026', ...YEAR_HINT),
    C('enrolled_on', 0, 'Enrolment date', 'Date d’inscription', '2025-09-01', '2025-09-01', 'Leave empty to use today.', 'Laissez vide pour utiliser aujourd’hui.'), C('address', 0, 'Address', 'Adresse', 'Bastos, Yaoundé', ''),
    C('stream', 0, 'Stream', 'Filière', '', ''), C('previous_school', 0, 'Previous school', 'École précédente', '', 'GBHS Douala'), C('status', 0, 'Status', 'Statut', 'active', 'active', 'active / transferred / graduated.', 'actif / transféré / diplômé.', ['active', 'transferred', 'graduated']),
    C('guardian_name', 1, 'Guardian name', 'Nom du tuteur', 'Anne Ngu', 'John Fon'), C('guardian_phone', 1, 'Guardian phone', 'Téléphone du tuteur', '+237 677 00 00 01', '+237 699 00 00 02'),
    C('guardian_relationship', 0, 'Relationship', 'Lien de parenté', 'Mother', 'Father', 'Default: Guardian.', 'Défaut : Tuteur.'), C('guardian_email', 0, 'Guardian e-mail', 'E-mail du tuteur', '', 'john@mail.com')] });
def('grades', { updatable: true, title: ['Grades and examination marks', 'Notes et résultats d’examens'], existing: 'skip', existingNote: ['Existing marks are kept unless you choose to overwrite them.', 'Les notes existantes sont conservées sauf si vous choisissez de les remplacer.'], overwritable: true,
  cols: [C('academic_year', 0, 'Academic year', 'Année scolaire', '2025-2026', '2025-2026', ...YEAR_HINT), C('term', 1, 'Term', 'Trimestre', 'Term 1', 'Term 1'), C('subject_code', 1, 'Subject code', 'Code matière', 'MATH', 'MATH'),
    C('assessment', 1, 'Assessment / sequence', 'Évaluation / séquence', 'Sequence 1', 'Sequence 1', 'The assessment name inside the class.', 'Le nom de l’évaluation dans la classe.'), C('student_code', 1, 'Student ID', 'Matricule élève', '2025-0001', '2025-0002', 'The student’s ID shown in JAO.', 'Le matricule de l’élève dans JAO.'),
    C('score', 1, 'Mark', 'Note', '14.5', 'ABS', 'A number, or ABS (absent) / EXC (excused). Empty = skipped.', 'Un nombre, ou ABS (absent) / EXC (excusé). Vide = ignoré.'),
    C('max_score', 0, 'Maximum score', 'Note maximale', '20', '20', 'Only needed if the assessment does not exist yet.', 'Nécessaire seulement si l’évaluation n’existe pas encore.'), C('type', 0, 'Type', 'Type', 'exam', 'exam', 'quiz / test / assignment / oral / project / exam.', '', ['quiz', 'test', 'assignment', 'oral', 'project', 'exam']),
    C('date', 0, 'Assessment date', 'Date de l’évaluation', '2025-11-20', '2025-11-20', 'Only used when the assessment is created.', 'Utilisée seulement à la création de l’évaluation.')] });
def('settings', { updatable: true, title: ['School information and settings', 'Informations et paramètres de l’école'], existing: 'update', single: true, existingNote: ['Empty cells keep the current value.', 'Les cellules vides conservent la valeur actuelle.'],
  cols: [C('name', 0, 'School name', 'Nom de l’école', 'Seraphim International', ''), C('motto', 0, 'Motto', 'Devise', 'Learn • Excel • Succeed', ''), C('address', 0, 'Address', 'Adresse', '', ''), C('location', 0, 'Location', 'Localité', 'Yaoundé', ''),
    C('phone', 0, 'Phone', 'Téléphone', '', ''), C('email', 0, 'E-mail', 'E-mail', '', ''), C('pass_mark', 0, 'Pass mark', 'Moyenne de passage', '10', '', 'Out of the grade scale.', 'Sur l’échelle de notation.'), C('grade_scale', 0, 'Grade scale', 'Échelle de notation', '20', ''),
    C('rounding', 0, 'Decimals shown', 'Décimales affichées', '2', '', '0, 1, 2 or 3.', '0, 1, 2 ou 3.', ['0', '1', '2', '3']), C('ranking_enabled', 0, 'Show class ranking', 'Afficher le classement', 'no', '', 'yes / no.', 'oui / non.'),
    C('date_format', 0, 'Date format', 'Format de date', 'DD/MM/YYYY', '', '', '', ['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY']), C('shop_hours', 0, 'Shop opening hours', 'Horaires de la boutique', '', ''), C('shop_instructions', 0, 'Shop instructions', 'Consignes de la boutique', '', '')] });
const CAT_LIST = ['textbooks', 'notebooks', 'reading_books', 'school_supplies', 'school_uniforms'];
def('products', { updatable: true, title: ['School Shop products', 'Produits de la boutique scolaire'], existing: 'skip', existingNote: ['Existing products (same code) can be updated. Empty cells keep the current value.', 'Les produits existants (même code) peuvent être mis à jour. Les cellules vides conservent la valeur actuelle.'], overwritable: true, images: true,
  cols: [C('code', 1, 'Product code', 'Code produit', 'TB-MATH-F1', 'NB-96', 'Letters, digits, - or _.', 'Lettres, chiffres, - ou _.'), C('name', 1, 'Product name', 'Nom du produit', 'Mathematics Form 1', 'Exercise book 96 pages'),
    C('category', 1, 'Category', 'Catégorie', 'textbooks', 'notebooks', 'textbooks, notebooks, reading books, school supplies, school uniforms.', 'manuels, cahiers, livres de lecture, fournitures scolaires, uniformes scolaires.', CAT_LIST),
    C('description', 0, 'Description', 'Description', 'National syllabus textbook', ''), C('class_level', 0, 'Class level', 'Niveau', 'Form 1', ''), C('price', 1, 'Selling price (FCFA)', 'Prix de vente (FCFA)', '4500', '350', 'Whole francs.', 'Francs entiers.'),
    C('quantity', 0, 'Opening stock', 'Stock initial', '120', '800', 'For an existing product this sets the quantity.', 'Pour un produit existant, fixe la quantité.'), C('low_threshold', 0, 'Minimum stock level', 'Stock minimum', '10', '50'), C('variant', 0, 'Variant (size…)', 'Variante (taille…)', '', ''),
    C('active', 0, 'Active', 'Actif', 'yes', 'yes'), C('is_public', 0, 'Show in public shop', 'Visible dans la boutique publique', 'yes', 'yes'), C('image_file', 0, 'Image file name', 'Nom du fichier image', 'math-f1.jpg', '', 'Attach the images in the import screen.', 'Joignez les images dans l’écran d’import.')] });
def('product_stock', { updatable: true, title: ['Product prices and stock quantities', 'Prix et quantités en stock des produits'], existing: 'update', existingNote: ['Updates existing products only. Empty cells keep the current value.', 'Met à jour les produits existants seulement. Les cellules vides conservent la valeur actuelle.'],
  cols: [C('code', 1, 'Product code', 'Code produit', 'TB-MATH-F1', 'NB-96'), C('price', 0, 'New selling price (FCFA)', 'Nouveau prix de vente (FCFA)', '4800', ''), C('quantity', 0, 'Quantity in stock', 'Quantité en stock', '100', '900', 'The counted quantity. A stock movement is recorded.', 'La quantité comptée. Un mouvement de stock est enregistré.'), C('low_threshold', 0, 'Minimum stock level', 'Stock minimum', '', '60')] });
def('gce_candidates', { title: ['GCE candidate numbers', 'Numéros de candidats GCE'], existing: 'skip', existingNote: ['Registers each student’s candidate number so results can be matched with certainty.', 'Enregistre le numéro de candidat de chaque élève pour rapprocher les résultats avec certitude.'],
  cols: [C('student_code', 1, 'Student ID', 'Matricule élève', '2025-0001', '2025-0002'), C('exam_year', 1, 'Examination year', 'Année d’examen', '2026', '2026'), C('level', 1, 'Level', 'Niveau', 'Ordinary', 'Advanced', 'Ordinary Level or Advanced Level.', 'Niveau ordinaire ou avancé.', ['Ordinary', 'Advanced']),
    C('candidate_number', 1, 'GCE candidate number', 'Numéro de candidat GCE', '1234567', '7654321'), C('centre_number', 0, 'Centre number', 'Numéro de centre', '12345', '')] });

const label = (c, lang) => (lang === 'fr' ? c.fr : c.en);

// ---------- template (xlsx) ----------
function templateWorkbook(key, lang) {
  const d = DEFS[key]; const fr = lang === 'fr';
  const T = (en, f) => (fr ? f : en);
  const ins = [[T(`Template: ${d.title[0]}`, `Modèle : ${d.title[1]}`)], [''],
    [T('How to fill this template', 'Comment remplir ce modèle')],
    [T('1. Fill the sheet “Data”, one record per row, starting under the heading row. Do not rename or reorder the headings.', '1. Remplissez la feuille « Data », un enregistrement par ligne, sous la ligne d’en-têtes. Ne renommez pas et ne réordonnez pas les en-têtes.')],
    [T('2. Dark headings are REQUIRED. Light headings are optional.', '2. Les en-têtes foncés sont OBLIGATOIRES. Les en-têtes clairs sont facultatifs.')],
    [T('3. The rows marked EXAMPLE are only illustrations. Delete them (they are ignored if you forget).', '3. Les lignes marquées EXEMPLE sont de simples illustrations. Supprimez-les (elles sont ignorées si vous les oubliez).')],
    [T('4. Save as .xlsx or .csv and upload it in the Import Centre. You will see a preview and can correct errors before anything is saved.', '4. Enregistrez en .xlsx ou .csv et téléversez-le dans le Centre d’import. Vous verrez un aperçu et pourrez corriger les erreurs avant tout enregistrement.')],
    [fr ? d.existingNote[1] : d.existingNote[0]], [''],
    [T('Column', 'Colonne'), T('Required?', 'Obligatoire ?'), T('Help', 'Aide'), T('Example', 'Exemple')]];
  for (const c of d.cols) ins.push([label(c, lang), c.required ? T('REQUIRED', 'OBLIGATOIRE') : T('optional', 'facultatif'), (fr ? c.hint.fr : c.hint.en) || '', c.ex[0]]);
  const styleRows = { 0: 'title', 2: 'title', 9: 'heading' };
  const heading = d.cols.map((c) => label(c, lang));
  const ex = [0, 1].map((i) => d.cols.map((c, ci) => (ci === 0 ? `${T('EXAMPLE', 'EXEMPLE')} – ${c.ex[i]}` : c.ex[i])));
  const dataRows = [heading, ...(d.single ? [ex[0]] : ex)];
  const lists = d.cols.map((c, i) => (c.list ? { col: i, values: c.list } : null)).filter(Boolean);
  return X.writeXlsx([
    { name: 'Data', rows: dataRows, styleRows: { 0: 'heading', 1: 'example', 2: 'example' }, header: { required: d.cols.map((c) => c.required) }, widths: d.cols.map((c) => Math.max(14, Math.min(34, label(c, lang).length + 8))), lists, freeze: true },
    { name: T('Instructions', 'Instructions'), rows: ins, styleRows: { ...styleRows, 9: 'heading' }, header: { required: [true, true, true, true] }, widths: [34, 16, 60, 26] },
  ]);
}

// ---------- reading an uploaded table into rows keyed by column ----------
function mapRows(sheets, key) {
  const d = DEFS[key]; const best = { score: -1 };
  const names = d.cols.map((c) => new Set([norm(c.key), norm(c.en), norm(c.fr)]));
  for (const sh of sheets) {
    for (let r = 0; r < Math.min(12, sh.rows.length); r++) {
      const hdr = sh.rows[r]; const idx = {}; let score = 0;
      hdr.forEach((h, ci) => { const n = norm(h); if (!n) return; const k = names.findIndex((s) => s.has(n)); if (k >= 0 && idx[k] === undefined) { idx[k] = ci; score += d.cols[k].required ? 3 : 1; } });
      if (score > best.score) Object.assign(best, { score, sh, r, idx });
    }
  }
  if (best.score < 0) throw S.bad('empty_file');
  const missing = d.cols.map((c, i) => (c.required && best.idx[i] === undefined ? c : null)).filter(Boolean);
  if (missing.length) throw S.bad('missing_columns', { columns: missing.map((c) => c.en + ' / ' + c.fr) });
  const rows = []; let examples = 0;
  for (let i = best.r + 1; i < best.sh.rows.length; i++) {
    const src = best.sh.rows[i]; if (!src || src.every((v) => cell(v) === '')) continue;
    const first = norm(src.find((v) => cell(v) !== ''));
    if (/^(example|exemple)\b/.test(first)) { examples++; continue; }
    const values = {}; d.cols.forEach((c, k) => { values[c.key] = best.idx[k] === undefined ? '' : cell(src[best.idx[k]]); });
    rows.push({ n: i + 1, values });
    if (rows.length > MAX_ROWS) throw S.bad('too_many_rows', { max: MAX_ROWS });
  }
  return { rows, examples, sheet: best.sh.name };
}

// ---------- shared lookups ----------
async function baseCtx(h, schoolId, userId, lang, options) {
  const years = await h.all('SELECT id, name, is_current FROM academic_years WHERE school_id = ?', schoolId);
  const ctx = { h, schoolId, userId, lang, options: options || {}, items: [], credentials: [], yearByName: new Map(years.map((y) => [norm(y.name), y])), currentYear: years.find((y) => y.is_current) || null, seen: new Map(), imgBytes: new Map() };
  return ctx;
}
const yearOf = (ctx, v, errs) => {
  if (!cell(v)) { if (!ctx.currentYear) { errs.push(['academic_year', 'no_current_year']); return null; } return ctx.currentYear; }
  const y = ctx.yearByName.get(norm(v)); if (!y) { errs.push(['academic_year', 'year_not_found', cell(v)]); return null; } return y;
};
async function loadClasses(ctx) {
  const rows = await ctx.h.all('SELECT id, name, section, year_id, capacity, teacher_id, active FROM classes WHERE school_id = ?', ctx.schoolId);
  ctx.classes = new Map(rows.map((c) => [`${c.year_id}|${norm(c.name)}|${norm(c.section)}`, c]));
  ctx.classById = new Map(rows.map((c) => [c.id, c]));
}
const findClass = (ctx, year, name, section) => ctx.classes.get(`${year.id}|${norm(name)}|${norm(section)}`)
  || (!section ? [...ctx.classes.values()].find((c) => c.year_id === year.id && norm(classLabel(c.name, c.section)) === norm(name)) : null);
async function loadSubjects(ctx) { const rows = await ctx.h.all('SELECT id, code, name, default_coefficient, active FROM subjects WHERE school_id = ?', ctx.schoolId); ctx.subjects = new Map(rows.map((s) => [s.code.toUpperCase(), s])); }
async function loadTeachers(ctx) { const rows = await ctx.h.all("SELECT id, email, name FROM users WHERE school_id = ? AND role = 'teacher' AND active = 1", ctx.schoolId); ctx.teachers = new Map(rows.map((u) => [u.email.toLowerCase(), u])); }
const teacherOf = (ctx, v, errs, col = 'teacher_email') => { if (!cell(v)) return null; const t = ctx.teachers.get(cell(v).toLowerCase()); if (!t) { errs.push([col, 'teacher_not_found', cell(v)]); return null; } return t; };
const codeOk = (s) => /^[A-Z0-9_-]+$/.test(s);

// Password hashes are never copied into the import log (a fingerprint is enough to know whether the record changed).
const scrub = (table, row) => (table === 'users' && row ? { ...row, password_hash: crypto.createHash('sha256').update(String(row.password_hash)).digest('hex') } : row);
// ---------- tracked writes (so that a batch can be rolled back) ----------
async function snap(ctx, table, id) { return await ctx.h.get(`SELECT * FROM ${table} WHERE id = ? AND school_id = ?`, id, ctx.schoolId); }
async function ins(ctx, table, sql, ...params) {
  const id = await ctx.h.insert(sql, ...params);
  const after = await ctx.h.get(`SELECT * FROM ${table} WHERE id = ?`, id);
  await ctx.h.run('INSERT INTO import_items (school_id, batch_id, table_name, record_id, action, after_json) VALUES (?,?,?,?,?,?)', ctx.schoolId, ctx.batchId, table, id, 'insert', JSON.stringify(scrub(table, after)));
  return id;
}
async function upd(ctx, table, id, sql, ...params) {
  const before = scrub(table, table === 'schools' ? await ctx.h.get('SELECT * FROM schools WHERE id = ?', id) : await snap(ctx, table, id));
  await ctx.h.run(sql, ...params);
  const after = scrub(table, await ctx.h.get(`SELECT * FROM ${table} WHERE id = ?`, id));
  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  await ctx.h.run('INSERT INTO import_items (school_id, batch_id, table_name, record_id, action, before_json, after_json) VALUES (?,?,?,?,?,?,?)', ctx.schoolId, ctx.batchId, table, id, 'update', JSON.stringify(before), JSON.stringify(after));
  return true;
}

// ---------- checks + apply per category ----------
// check(values, ctx, n) -> { errors:[[col,code,v]], warnings:[...], norm, key, exists }   apply(norm, ctx) -> 'inserted'|'updated'|'unchanged'
const H = {};

H.academic_years = {
  async prepare(ctx) { ctx.termsOf = new Map((await ctx.h.all('SELECT year_id, name FROM terms WHERE school_id = ?', ctx.schoolId)).map((t) => [`${t.year_id}|${norm(t.name)}`, 1])); },
  check(v, ctx) {
    const errors = []; const name = cell(v.academic_year).slice(0, 40); if (!name) errors.push(['academic_year', 'required']);
    const terms = cell(v.terms) ? cell(v.terms).split(/[;|\n]/).map((x) => cell(x).slice(0, 40)).filter(Boolean) : [];
    let cur = null; if (cell(v.is_current)) { if (yes(v.is_current)) cur = true; else if (no(v.is_current)) cur = false; else errors.push(['is_current', 'bad_number']); }
    const exists = ctx.yearByName.has(norm(name));
    return { errors, norm: { name, terms, cur }, key: norm(name), exists };
  },
  async apply(n, ctx) {
    let y = ctx.yearByName.get(norm(n.name)); let did = false;
    if (!y) { const count = (await ctx.h.get('SELECT COUNT(*) c FROM academic_years WHERE school_id = ?', ctx.schoolId)).c;
      const id = await ins(ctx, 'academic_years', 'INSERT INTO academic_years (school_id, name, is_current) VALUES (?,?,?)', ctx.schoolId, n.name, count === 0 ? 1 : 0); y = { id, name: n.name }; ctx.yearByName.set(norm(n.name), y); did = 'inserted'; }
    let pos = (await ctx.h.get('SELECT COALESCE(MAX(position),0) p FROM terms WHERE year_id = ?', y.id)).p;
    for (const t of n.terms) { if (ctx.termsOf.has(`${y.id}|${norm(t)}`)) continue; await ins(ctx, 'terms', 'INSERT INTO terms (school_id, year_id, name, position) VALUES (?,?,?,?)', ctx.schoolId, y.id, t, ++pos); ctx.termsOf.set(`${y.id}|${norm(t)}`, 1); did = did || 'updated'; }
    if (n.cur === true) { for (const o of await ctx.h.all('SELECT id FROM academic_years WHERE school_id = ? AND is_current = 1 AND id <> ?', ctx.schoolId, y.id)) await upd(ctx, 'academic_years', o.id, 'UPDATE academic_years SET is_current = 0 WHERE id = ? AND school_id = ?', o.id, ctx.schoolId); await upd(ctx, 'academic_years', y.id, 'UPDATE academic_years SET is_current = 1 WHERE id = ? AND school_id = ?', y.id, ctx.schoolId); did = did || 'updated'; }
    return did || 'unchanged';
  },
};

H.classes = {
  async prepare(ctx) { await loadClasses(ctx); await loadTeachers(ctx); },
  check(v, ctx) {
    const errors = []; const name = cell(v.class_name).slice(0, 60); if (!name) errors.push(['class_name', 'required']);
    const section = cell(v.section).slice(0, 20); const year = yearOf(ctx, v.academic_year, errors);
    let cap = null; if (cell(v.capacity)) { cap = parseNum(v.capacity); if (!Number.isInteger(cap) || cap < 1 || cap > 10000) { errors.push(['capacity', 'bad_number']); cap = null; } }
    const t = teacherOf(ctx, v.teacher_email, errors);
    const ex = year && name ? ctx.classes.get(`${year.id}|${norm(name)}|${norm(section)}`) : null;
    return { errors, norm: { name, section, year, cap, teacher: t && t.id, existing: ex }, key: year ? `${year.id}|${norm(name)}|${norm(section)}` : null, exists: !!ex };
  },
  async apply(n, ctx) {
    if (n.existing) { if (ctx.options.existing !== 'update') return 'skipped';
      return (await upd(ctx, 'classes', n.existing.id, 'UPDATE classes SET capacity = COALESCE(?, capacity), teacher_id = COALESCE(?, teacher_id) WHERE id = ? AND school_id = ?', n.cap, n.teacher, n.existing.id, ctx.schoolId)) ? 'updated' : 'unchanged'; }
    await ins(ctx, 'classes', 'INSERT INTO classes (school_id, name, section, year_id, teacher_id, capacity, active) VALUES (?,?,?,?,?,?,1)', ctx.schoolId, n.name, n.section, n.year.id, n.teacher, n.cap);
    return 'inserted';
  },
};

H.subjects = {
  async prepare(ctx) { await loadSubjects(ctx); },
  check(v, ctx) {
    const errors = []; const code = cell(v.code).toUpperCase().slice(0, 20); const name = cell(v.name).slice(0, 80);
    if (!code) errors.push(['code', 'required']); else if (!codeOk(code)) errors.push(['code', 'code_format']); if (!name) errors.push(['name', 'required']);
    let coef = null; if (cell(v.default_coefficient)) { coef = parseNum(v.default_coefficient); if (!(coef > 0 && coef <= 100)) { errors.push(['default_coefficient', 'bad_coef']); coef = null; } }
    let active = null; if (cell(v.active)) { if (yes(v.active)) active = 1; else if (no(v.active)) active = 0; else errors.push(['active', 'bad_number']); }
    return { errors, norm: { code, name, description: cell(v.description).slice(0, 300) || null, coef, active, existing: ctx.subjects.get(code) }, key: code, exists: ctx.subjects.has(code) };
  },
  async apply(n, ctx) {
    if (n.existing) { if (ctx.options.existing !== 'update') return 'skipped';
      return (await upd(ctx, 'subjects', n.existing.id, 'UPDATE subjects SET name = ?, description = COALESCE(?, description), default_coefficient = COALESCE(?, default_coefficient), active = COALESCE(?, active) WHERE id = ? AND school_id = ?', n.name, n.description, n.coef, n.active, n.existing.id, ctx.schoolId)) ? 'updated' : 'unchanged'; }
    const id = await ins(ctx, 'subjects', 'INSERT INTO subjects (school_id, name, code, description, default_coefficient, active) VALUES (?,?,?,?,?,?)', ctx.schoolId, n.name, n.code, n.description, n.coef, n.active ?? 1);
    ctx.subjects.set(n.code, { id, code: n.code }); return 'inserted';
  },
};

H.coefficients = {
  async prepare(ctx) { await loadClasses(ctx); await loadSubjects(ctx); await loadTeachers(ctx);
    ctx.cs = new Map((await ctx.h.all('SELECT id, class_id, subject_id, coefficient, teacher_id FROM class_subjects WHERE school_id = ?', ctx.schoolId)).map((r) => [`${r.class_id}|${r.subject_id}`, r])); },
  check(v, ctx) {
    const errors = []; const year = yearOf(ctx, v.academic_year, errors); const name = cell(v.class_name), section = cell(v.section);
    if (!name) errors.push(['class_name', 'required']); const code = cell(v.subject_code).toUpperCase(); if (!code) errors.push(['subject_code', 'required']);
    const coef = parseNum(v.coefficient); if (cell(v.coefficient) === '') errors.push(['coefficient', 'required']); else if (!(coef > 0 && coef <= 100)) errors.push(['coefficient', 'bad_coef']);
    let cls = null; if (year && name) { cls = findClass(ctx, year, name, section); if (!cls) errors.push(['class_name', 'class_not_found', classLabel(name, section)]); }
    const sb = code ? ctx.subjects.get(code) : null; if (code && !sb) errors.push(['subject_code', 'subject_not_found', code]);
    const t = teacherOf(ctx, v.teacher_email, errors);
    const ex = cls && sb ? ctx.cs.get(`${cls.id}|${sb.id}`) : null;
    return { errors, norm: { cls, sb, coef, teacher: t && t.id, existing: ex }, key: cls && sb ? `${cls.id}|${sb.id}` : null, exists: !!ex };
  },
  async apply(n, ctx) {
    if (n.existing) { if (ctx.options.existing === 'skip') return 'skipped';
      return (await upd(ctx, 'class_subjects', n.existing.id, 'UPDATE class_subjects SET coefficient = ?, teacher_id = COALESCE(?, teacher_id) WHERE id = ? AND school_id = ?', n.coef, n.teacher, n.existing.id, ctx.schoolId)) ? 'updated' : 'unchanged'; }
    await ins(ctx, 'class_subjects', 'INSERT INTO class_subjects (school_id, class_id, subject_id, coefficient, teacher_id) VALUES (?,?,?,?,?)', ctx.schoolId, n.cls.id, n.sb.id, n.coef, n.teacher);
    return 'inserted';
  },
};

H.teachers = {
  async prepare(ctx) { ctx.emails = new Set((await ctx.h.all('SELECT email FROM users WHERE school_id = ?', ctx.schoolId)).map((u) => u.email.toLowerCase())); },
  check(v, ctx) {
    const errors = []; const name = cell(v.full_name).slice(0, 120); const email = cell(v.email).toLowerCase().slice(0, 200);
    if (!name) errors.push(['full_name', 'required']); if (!email) errors.push(['email', 'required']); else if (!S.isEmail(email)) errors.push(['email', 'bad_email']);
    return { errors, norm: { name, email }, key: email, exists: !!email && ctx.emails.has(email) };
  },
  async apply(n, ctx) {
    const temp = S.randomPassword(); const initials = n.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    await ins(ctx, 'users', 'INSERT INTO users (school_id, email, password_hash, name, initials, role, must_change_password) VALUES (?,?,?,?,?,?,1)', ctx.schoolId, n.email, S.hashPassword(temp), n.name, initials, 'teacher');
    ctx.credentials.push({ name: n.name, email: n.email, password: temp }); return 'inserted';
  },
};

H.students = {
  async prepare(ctx) {
    await loadClasses(ctx);
    const ex = await ctx.h.all('SELECT full_name, dob FROM students WHERE school_id = ?', ctx.schoolId);
    ctx.existingStudents = new Set(ex.map((s) => `${norm(s.full_name)}|${s.dob}`));
    ctx.classCount = new Map((await ctx.h.all("SELECT class_id, COUNT(*) n FROM students WHERE school_id = ? AND archived_at IS NULL AND status = 'active' AND class_id IS NOT NULL GROUP BY class_id", ctx.schoolId)).map((r) => [r.class_id, r.n]));
    ctx.seq = new Map(); for (const r of await ctx.h.all("SELECT substr(student_code,1,4) y, MAX(CAST(substr(student_code,6) AS INTEGER)) m FROM students WHERE school_id = ? AND student_code GLOB '[0-9][0-9][0-9][0-9]-*' GROUP BY substr(student_code,1,4)", ctx.schoolId)) ctx.seq.set(r.y, r.m || 0);
    ctx.guardians = new Map((await ctx.h.all('SELECT id, full_name, phone FROM guardians WHERE school_id = ?', ctx.schoolId)).map((g) => [`${norm(g.full_name)}|${g.phone.replace(/\D/g, '')}`, g.id]));
    ctx.pending = new Map();
  },
  check(v, ctx) {
    const errors = []; const name = cell(v.full_name).slice(0, 120); if (!name) errors.push(['full_name', 'required']);
    const dob = parseDate(v.dob); if (!cell(v.dob)) errors.push(['dob', 'required']); else if (!dob) errors.push(['dob', 'bad_date']); else if (dob > today()) errors.push(['dob', 'future_date']);
    let gender = null; if (cell(v.gender)) { gender = GENDERS[norm(v.gender)]; if (!gender) errors.push(['gender', 'bad_gender']); }
    let status = 'active'; if (cell(v.status)) { status = STATUS[norm(v.status)]; if (!status) { errors.push(['status', 'bad_status']); status = 'active'; } }
    let enrolled = today(); if (cell(v.enrolled_on)) { enrolled = parseDate(v.enrolled_on); if (!enrolled) { errors.push(['enrolled_on', 'bad_date']); enrolled = today(); } }
    const year = yearOf(ctx, v.academic_year, errors); const cn = cell(v.class_name); let cls = null;
    if (!cn) errors.push(['class_name', 'required']); else if (year) { cls = findClass(ctx, year, cn, cell(v.section)); if (!cls) errors.push(['class_name', 'class_not_found', classLabel(cn, cell(v.section))]); }
    const gname = cell(v.guardian_name).slice(0, 120), gphone = cell(v.guardian_phone).slice(0, 30), gemail = cell(v.guardian_email).slice(0, 200);
    if (!gname) errors.push(['guardian_name', 'required']); if (!gphone) errors.push(['guardian_phone', 'required']); else if (!S.isPhone(gphone)) errors.push(['guardian_phone', 'bad_phone']); if (gemail && !S.isEmail(gemail)) errors.push(['guardian_email', 'bad_email']);
    const key = dob ? `${norm(name)}|${dob}` : null; const exists = key ? ctx.existingStudents.has(key) : false;
    if (cls && !exists && !errors.length) { const cnt = ctx.classCount.get(cls.id) || 0; if (cls.capacity && cnt >= cls.capacity) errors.push(['class_name', 'class_full', cls.capacity]); else if (status === 'active') ctx.classCount.set(cls.id, cnt + 1); }
    return { errors, key, exists, norm: { name, dob, gender, birthplace: cell(v.birthplace).slice(0, 120) || null, address: cell(v.address).slice(0, 300) || null, enrolled, status, stream: cell(v.stream).slice(0, 60) || null,
      prev: cell(v.previous_school).slice(0, 120) || null, cls, year, gname, gphone, gemail: gemail || null, rel: cell(v.guardian_relationship).slice(0, 40) || (ctx.lang === 'fr' ? 'Tuteur' : 'Guardian') } };
  },
  async apply(n, ctx) {
    const y = n.enrolled.slice(0, 4); const seq = (ctx.seq.get(y) || 0) + 1; ctx.seq.set(y, seq); const code = `${y}-${String(seq).padStart(4, '0')}`;
    const sid = await ins(ctx, 'students', `INSERT INTO students (school_id, student_code, full_name, dob, gender, birthplace, address, enrolled_on, status, previous_school, stream, class_id, year_id, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ctx.schoolId, code, n.name, n.dob, n.gender, n.birthplace, n.address, n.enrolled, n.status, n.prev, n.stream, n.cls.id, n.cls.year_id, ctx.userId);
    const gkey = `${norm(n.gname)}|${n.gphone.replace(/\D/g, '')}`; let gid = ctx.guardians.get(gkey);
    if (!gid) { gid = await ins(ctx, 'guardians', 'INSERT INTO guardians (school_id, full_name, phone, email, address) VALUES (?,?,?,?,?)', ctx.schoolId, n.gname, n.gphone, n.gemail, null); ctx.guardians.set(gkey, gid); }
    const primary = (await ctx.h.get('SELECT 1 x FROM student_guardians WHERE guardian_id = ? AND student_id = ?', gid, sid)) ? 0 : 1;
    await ins(ctx, 'student_guardians', 'INSERT INTO student_guardians (school_id, student_id, guardian_id, relationship, is_primary, is_emergency) VALUES (?,?,?,?,?,0)', ctx.schoolId, sid, gid, n.rel, primary);
    await ins(ctx, 'student_history', 'INSERT INTO student_history (school_id, student_id, event, details, actor_id) VALUES (?,?,?,?,?)', ctx.schoolId, sid, 'registered', JSON.stringify({ class_id: n.cls.id, year_id: n.cls.year_id, code, import: true }), ctx.userId);
    return 'inserted';
  },
};

H.grades = {
  async prepare(ctx) {
    await loadSubjects(ctx); await loadClasses(ctx);
    ctx.students = new Map((await ctx.h.all('SELECT id, student_code, class_id, archived_at FROM students WHERE school_id = ?', ctx.schoolId)).map((s) => [s.student_code.toUpperCase(), s]));
    ctx.terms = new Map((await ctx.h.all('SELECT id, year_id, name FROM terms WHERE school_id = ?', ctx.schoolId)).map((t) => [`${t.year_id}|${norm(t.name)}`, t]));
    ctx.classSubj = new Set((await ctx.h.all('SELECT class_id, subject_id FROM class_subjects WHERE school_id = ?', ctx.schoolId)).map((r) => `${r.class_id}|${r.subject_id}`));
    ctx.assess = new Map((await ctx.h.all('SELECT id, class_id, subject_id, term_id, name, max_score FROM assessments WHERE school_id = ?', ctx.schoolId)).map((a) => [`${a.class_id}|${a.subject_id}|${a.term_id}|${norm(a.name)}`, a]));
    ctx.newAssess = new Map(); ctx.gradeCache = new Map();
  },
  async check(v, ctx) {
    const errors = [], warnings = []; const year = yearOf(ctx, v.academic_year, errors);
    const tname = cell(v.term); if (!tname) errors.push(['term', 'required']); const term = year && tname ? ctx.terms.get(`${year.id}|${norm(tname)}`) : null; if (year && tname && !term) errors.push(['term', 'term_not_found', tname]);
    const scode = cell(v.subject_code).toUpperCase(); if (!scode) errors.push(['subject_code', 'required']); const sb = scode ? ctx.subjects.get(scode) : null; if (scode && !sb) errors.push(['subject_code', 'subject_not_found', scode]);
    const aname = cell(v.assessment).slice(0, 80); if (!aname) errors.push(['assessment', 'required']);
    const stcode = cell(v.student_code).toUpperCase(); if (!stcode) errors.push(['student_code', 'required']); const st = stcode ? ctx.students.get(stcode) : null; if (stcode && !st) errors.push(['student_code', 'student_not_found', stcode]);
    let cls = null; if (st) { cls = st.class_id ? ctx.classById && ctx.classById.get(st.class_id) : null; if (!cls && st.class_id) { cls = await ctx.h.get('SELECT id, year_id FROM classes WHERE id = ? AND school_id = ?', st.class_id, ctx.schoolId); } }
    if (term && cls && cls.year_id !== term.year_id) errors.push(['term', 'student_year']);
    if (cls && sb && !ctx.classSubj.has(`${cls.id}|${sb.id}`)) errors.push(['subject_code', 'not_in_class']);
    // the mark
    let score = null, status = 'graded', blank = false; const raw = cell(v.score);
    if (raw === '') { blank = true; warnings.push(['score', 'blank_score']); }
    else if (['abs', 'absent', 'a', 'abs.'].includes(norm(raw))) status = 'absent'; else if (['exc', 'excused', 'excuse', 'dispense', 'e'].includes(norm(raw))) status = 'excused';
    else { score = parseNum(raw); if (!Number.isFinite(score) || score < 0) { errors.push(['score', 'bad_number']); score = null; } }
    // the assessment (existing, or created when a maximum score is given)
    let max = null, akey = null, willCreate = null, existingAssessment = null;
    if (term && cls && sb && aname) {
      akey = `${cls.id}|${sb.id}|${term.id}|${norm(aname)}`; existingAssessment = ctx.assess.get(akey) || null;
      if (existingAssessment) max = existingAssessment.max_score;
      else {
        const pending = ctx.newAssess.get(akey); const given = cell(v.max_score) ? parseNum(v.max_score) : null;
        if (pending) { max = pending.max; if (given !== null && given !== pending.max) errors.push(['max_score', 'max_conflict']); }
        else if (given === null) errors.push(['assessment', 'max_needed', aname]);
        else if (!(given > 0 && given <= 1000)) errors.push(['max_score', 'bad_max']);
        else { let type = 'exam'; if (cell(v.type)) { type = norm(v.type); if (!['quiz', 'test', 'assignment', 'oral', 'project', 'exam'].includes(type)) { errors.push(['type', 'bad_type']); type = 'exam'; } }
          let date = today(); if (cell(v.date)) { date = parseDate(v.date); if (!date) { errors.push(['date', 'bad_date']); date = today(); } }
          max = given; willCreate = { cls, sb, term, name: aname, type, date, max }; }
        if (!errors.length && !pending && willCreate) ctx.newAssess.set(akey, willCreate);
      }
    }
    if (max !== null && score !== null && score > max) errors.push(['score', 'score_range', max]);
    // is there already a mark?
    let exists = false, existingGrade = null;
    if (existingAssessment && st) {
      if (!ctx.gradeCache.has(existingAssessment.id)) ctx.gradeCache.set(existingAssessment.id, new Map((await ctx.h.all('SELECT id, student_id, score, status FROM grades WHERE assessment_id = ?', existingAssessment.id)).map((g) => [g.student_id, g])));
      existingGrade = ctx.gradeCache.get(existingAssessment.id).get(st.id) || null; exists = !!existingGrade;
    }
    return { errors, warnings, blank, key: akey && st ? `${akey}|${st.id}` : null, exists, norm: { st, score, status, akey, existingAssessment, existingGrade } };
  },
  async apply(n, ctx) {
    if (n.blank) return 'skipped';
    let a = n.existingAssessment;
    if (!a) {
      const pend = ctx.newAssess.get(n.akey);
      if (!pend.id) pend.id = await ins(ctx, 'assessments', 'INSERT INTO assessments (school_id, class_id, subject_id, term_id, name, type, max_score, date, created_by) VALUES (?,?,?,?,?,?,?,?,?)', ctx.schoolId, pend.cls.id, pend.sb.id, pend.term.id, pend.name, pend.type, pend.max, pend.date, ctx.userId);
      a = { id: pend.id };
    }
    if (n.existingGrade) { if (ctx.options.existing !== 'update') return 'skipped';
      return (await upd(ctx, 'grades', n.existingGrade.id, "UPDATE grades SET score = ?, status = ?, updated_by = ?, updated_at = NOW_TS WHERE id = ? AND school_id = ?", n.score, n.status, ctx.userId, n.existingGrade.id, ctx.schoolId)) ? 'updated' : 'unchanged'; }
    await ins(ctx, 'grades', 'INSERT INTO grades (school_id, assessment_id, student_id, score, status, updated_by) VALUES (?,?,?,?,?,?)', ctx.schoolId, a.id, n.st.id, n.score, n.status, ctx.userId);
    return 'inserted';
  },
};

H.settings = {
  async prepare() {},
  check(v, ctx) {
    const errors = []; const out = {}; const cur = ctx.school;
    for (const f of ['name', 'motto', 'address', 'location', 'phone', 'shop_hours', 'shop_instructions']) if (cell(v[f])) out[f] = cell(v[f]).slice(0, f.startsWith('shop_') ? 1000 : 200);
    if (cell(v.email)) { if (S.isEmail(cell(v.email))) out.email = cell(v.email); else errors.push(['email', 'bad_email']); }
    const scale = cell(v.grade_scale) ? parseNum(v.grade_scale) : cur.grade_scale; const pass = cell(v.pass_mark) ? parseNum(v.pass_mark) : cur.pass_mark; const rounding = cell(v.rounding) ? parseNum(v.rounding) : cur.rounding;
    if (!(scale > 0 && scale <= 1000)) errors.push(['grade_scale', 'setting_bad']); if (!(pass >= 0 && pass <= scale)) errors.push(['pass_mark', 'setting_bad']); if (![0, 1, 2, 3].includes(rounding)) errors.push(['rounding', 'setting_bad']);
    out.grade_scale = scale; out.pass_mark = pass; out.rounding = rounding;
    if (cell(v.ranking_enabled)) { if (yes(v.ranking_enabled)) out.ranking_enabled = 1; else if (no(v.ranking_enabled)) out.ranking_enabled = 0; else errors.push(['ranking_enabled', 'setting_bad']); }
    if (cell(v.date_format)) { const f = ['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'].find((x) => x === cell(v.date_format).toUpperCase()); if (f) out.date_format = f; else errors.push(['date_format', 'setting_bad']); }
    return { errors, norm: out, key: 'school', exists: true };
  },
  async apply(n, ctx) {
    const cols = Object.keys(n); const sql = `UPDATE schools SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;
    return (await upd(ctx, 'schools', ctx.schoolId, sql, ...cols.map((c) => n[c]), ctx.schoolId)) ? 'updated' : 'unchanged';
  },
};

const catOf = (s) => { const n = norm(s); return CAT_LIST.find((k) => SHOP_LABELS[k].some((l) => norm(l) === n)) || null; };
H.products = {
  async prepare(ctx) { ctx.products = new Map((await ctx.h.all('SELECT * FROM products WHERE school_id = ?', ctx.schoolId)).map((p) => [p.code.toUpperCase(), p])); },
  check(v, ctx) {
    const errors = []; const code = cell(v.code).toUpperCase().slice(0, 30); if (!code) errors.push(['code', 'required']); else if (!codeOk(code)) errors.push(['code', 'code_format']);
    const ex = ctx.products.get(code) || null; const name = cell(v.name).slice(0, 120); if (!name && !ex) errors.push(['name', 'required']);
    let category = null; if (cell(v.category)) { category = catOf(v.category); if (!category) errors.push(['category', 'bad_category']); } else if (!ex) errors.push(['category', 'required']);
    let price = null; if (cell(v.price) !== '') { price = parseNum(v.price); if (!Number.isInteger(price) || price < 0 || price > 100000000) { errors.push(['price', 'bad_price']); price = null; } } else if (!ex) errors.push(['price', 'required']);
    let qty = null; if (cell(v.quantity) !== '') { qty = parseNum(v.quantity); if (!Number.isInteger(qty) || qty < 0 || qty > 1000000) { errors.push(['quantity', 'bad_qty']); qty = null; } }
    let low = null; if (cell(v.low_threshold) !== '') { low = parseNum(v.low_threshold); if (!Number.isInteger(low) || low < 0 || low > 100000) { errors.push(['low_threshold', 'bad_qty']); low = null; } }
    const flag = (x) => (cell(x) === '' ? null : yes(x) ? 1 : no(x) ? 0 : undefined); const active = flag(v.active), pub = flag(v.is_public);
    if (active === undefined) errors.push(['active', 'bad_number']); if (pub === undefined) errors.push(['is_public', 'bad_number']);
    const img = cell(v.image_file); if (img && !(ctx.images && ctx.images[img])) errors.push(['image_file', 'bad_image', img]);
    return { errors, key: code, exists: !!ex, norm: { code, name, category, price, qty, low, active: active ?? null, pub: pub ?? null, desc: cell(v.description).slice(0, 1000) || null, level: cell(v.class_level).slice(0, 40) || null, variant: cell(v.variant).slice(0, 80) || null, img, existing: ex } };
  },
  async apply(n, ctx) {
    let fileId = null; if (n.img) fileId = await saveImageTracked(ctx, n.img);
    if (n.existing) { if (ctx.options.existing !== 'update') return 'skipped';
      const p = n.existing; const changed = await upd(ctx, 'products', p.id, `UPDATE products SET name = COALESCE(?, name), category = COALESCE(?, category), description = COALESCE(?, description), class_level = COALESCE(?, class_level), price = COALESCE(?, price),
        low_threshold = COALESCE(?, low_threshold), variant = COALESCE(?, variant), active = COALESCE(?, active), is_public = COALESCE(?, is_public), image_file_id = COALESCE(?, image_file_id) WHERE id = ? AND school_id = ?`,
        n.name || null, n.category, n.desc, n.level, n.price, n.low, n.variant, n.active, n.pub, fileId, p.id, ctx.schoolId);
      return (await setQuantity(ctx, p.id, p.quantity, n.qty)) || changed ? 'updated' : 'unchanged'; }
    const id = await ins(ctx, 'products', `INSERT INTO products (school_id, code, name, description, category, class_level, price, quantity, low_threshold, variant, image_file_id, active, is_public) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ctx.schoolId, n.code, n.name, n.desc, n.category, n.level, n.price, n.qty ?? 0, n.low ?? 5, n.variant, fileId, n.active ?? 1, n.pub ?? 1);
    if ((n.qty ?? 0) > 0) await ins(ctx, 'stock_movements', "INSERT INTO stock_movements (school_id, product_id, type, change, previous_qty, new_qty, reason, actor_id) VALUES (?,?, 'initial', ?, 0, ?, 'Bulk import', ?)", ctx.schoolId, id, n.qty, n.qty, ctx.userId);
    return 'inserted';
  },
};
async function setQuantity(ctx, productId, oldQty, newQty) {
  if (newQty === null || newQty === oldQty) return false;
  await upd(ctx, 'products', productId, 'UPDATE products SET quantity = ? WHERE id = ? AND school_id = ?', newQty, productId, ctx.schoolId);
  const diff = newQty - oldQty;
  await ins(ctx, 'stock_movements', 'INSERT INTO stock_movements (school_id, product_id, type, change, previous_qty, new_qty, reason, actor_id) VALUES (?,?,?,?,?,?,?,?)', ctx.schoolId, productId, diff > 0 ? 'adjustment_in' : 'adjustment_out', Math.abs(diff), oldQty, newQty, 'Bulk import', ctx.userId);
  return true;
}
async function saveImageTracked(ctx, name) {
  const fileId = await ctx.saveImage(ctx.schoolId, 'product_image', ctx.images[name], ctx.userId);
  const after = await ctx.h.get('SELECT * FROM files WHERE id = ?', fileId);
  await ctx.h.run('INSERT INTO import_items (school_id, batch_id, table_name, record_id, action, after_json) VALUES (?,?,?,?,?,?)', ctx.schoolId, ctx.batchId, 'files', fileId, 'insert', JSON.stringify(after));
  return fileId;
}

H.product_stock = {
  async prepare(ctx) { await H.products.prepare(ctx); },
  check(v, ctx) {
    const errors = []; const code = cell(v.code).toUpperCase(); if (!code) errors.push(['code', 'required']); const p = ctx.products.get(code) || null; if (code && !p) errors.push(['code', 'product_not_found', code]);
    const num = (x, col, code2) => { if (cell(x) === '') return null; const n = parseNum(x); if (!Number.isInteger(n) || n < 0) { errors.push([col, code2]); return null; } return n; };
    const price = num(v.price, 'price', 'bad_price'), qty = num(v.quantity, 'quantity', 'bad_qty'), low = num(v.low_threshold, 'low_threshold', 'bad_qty');
    if (!errors.length && price === null && qty === null && low === null) errors.push(['price', 'nothing_to_change']);
    return { errors, key: code, exists: !!p, norm: { price, qty, low, p } };
  },
  async apply(n, ctx) {
    const p = n.p; const a = await upd(ctx, 'products', p.id, 'UPDATE products SET price = COALESCE(?, price), low_threshold = COALESCE(?, low_threshold) WHERE id = ? AND school_id = ?', n.price, n.low, p.id, ctx.schoolId);
    const b = await setQuantity(ctx, p.id, p.quantity, n.qty); return a || b ? 'updated' : 'unchanged';
  },
};

H.gce_candidates = {
  async prepare(ctx) {
    ctx.students = new Map((await ctx.h.all('SELECT id, student_code FROM students WHERE school_id = ? AND archived_at IS NULL', ctx.schoolId)).map((s) => [s.student_code.toUpperCase(), s]));
    const rows = await ctx.h.all('SELECT student_id, exam_year, level, candidate_number FROM gce_candidates WHERE school_id = ?', ctx.schoolId);
    ctx.candByNumber = new Map(rows.map((r) => [`${r.exam_year}|${r.level}|${r.candidate_number}`, r.student_id])); ctx.candByStudent = new Map(rows.map((r) => [`${r.exam_year}|${r.level}|${r.student_id}`, r.candidate_number]));
  },
  check(v, ctx) {
    const errors = []; const sc = cell(v.student_code).toUpperCase(); const st = sc ? ctx.students.get(sc) : null; if (!sc) errors.push(['student_code', 'required']); else if (!st) errors.push(['student_code', 'student_not_found', sc]);
    const yr = parseNum(v.exam_year); if (!Number.isInteger(yr) || yr < 1990 || yr > 2100) errors.push(['exam_year', 'bad_year_num']);
    const level = parseLevel(v.level); if (!level) errors.push(['level', 'bad_level']);
    const cn = cell(v.candidate_number).toUpperCase().replace(/\s+/g, '').slice(0, 30); if (!cn) errors.push(['candidate_number', 'required']);
    let exists = false;
    if (!errors.length) {
      const owner = ctx.candByNumber.get(`${yr}|${level}|${cn}`); const mine = ctx.candByStudent.get(`${yr}|${level}|${st.id}`);
      if (owner && owner !== st.id) errors.push(['candidate_number', 'cand_taken']); else if (mine && mine !== cn) errors.push(['candidate_number', 'student_has_cand']); else exists = !!owner;
    }
    return { errors, key: st ? `${yr}|${level}|${cn}` : null, exists, norm: { st, yr, level, cn, centre: cell(v.centre_number).slice(0, 30) || null } };
  },
  async apply(n, ctx) { await ins(ctx, 'gce_candidates', 'INSERT INTO gce_candidates (school_id, student_id, exam_year, level, candidate_number, centre_number, created_by) VALUES (?,?,?,?,?,?,?)', ctx.schoolId, n.st.id, n.yr, n.level, n.cn, n.centre, ctx.userId); return 'inserted'; },
};

// ---------- run a validation pass ----------
async function validate(app, user, school, key, rowsIn, { lang, options, images }) {
  const d = DEFS[key]; if (!d) throw S.bad('unknown_category');
  const ctx = await baseCtx(app.h, user.school_id, user.id, lang, options); ctx.school = school; ctx.images = images || {}; ctx.saveImage = app.saveImage;
  await H[key].prepare(ctx);
  const out = []; let first = new Map();
  for (const r of rowsIn) {
    const res = await H[key].check(r.values, ctx, r.n);
    const errors = (res.errors || []).map(([col, code, v]) => ({ col, code, text: say(lang, code, v) }));
    const warnings = (res.warnings || []).map(([col, code, v]) => ({ col, code, text: say(lang, code, v) }));
    if (res.key && !errors.length) { if (first.has(res.key)) errors.push({ col: d.cols[0].key, code: 'dup_in_file', text: say(lang, 'dup_in_file', first.get(res.key)) }); else first.set(res.key, r.n); }
    const blank = !!res.blank;
    out.push({ n: r.n, values: r.values, errors, warnings, exists: !!res.exists && !errors.length, blank, norm: res.norm });
  }
  return { ctx, rows: out };
}
const summarize = (rows, d, options) => {
  const s = { total: rows.length, ok: 0, errors: 0, exists: 0, blank: 0, warnings: 0 };
  for (const r of rows) { if (r.errors.length) s.errors++; else if (r.blank) s.blank++; else { s.ok++; if (r.exists) s.exists++; } if (r.warnings.length) s.warnings++; }
  s.will_create = s.ok - s.exists; s.will_update = options.existing === 'update' ? s.exists : 0; s.will_skip = options.existing === 'update' ? s.blank : s.exists + s.blank;
  return s;
};
const publicRows = (rows) => rows.map(({ norm: _n, ...r }) => r);

// ---------- save (atomic) ----------
async function commit(app, user, school, key, rowsIn, { lang, options, images, sourceName }) {
  const d = DEFS[key]; const h = app.h;
  const v = await validate(app, user, school, key, rowsIn, { lang, options, images });
  const sum = summarize(v.rows, d, options);
  if (sum.errors > 0 && !options.skip_invalid) throw new S.HttpError(409, 'validation_failed', { summary: sum, rows: publicRows(v.rows) });
  if (sum.ok === 0) throw S.bad('nothing_to_import', { summary: sum });
  const good = v.rows.filter((r) => !r.errors.length && !r.blank);
  const result = await h.tx(async () => {
    const batchId = await h.insert('INSERT INTO import_batches (school_id, category, source_name, total_rows, imported_rows, error_rows, skipped_rows, created_by) VALUES (?,?,?,?,0,?,0,?)', user.school_id, key, String(sourceName || '').slice(0, 200) || null, sum.total, sum.errors, user.id);
    v.ctx.batchId = batchId; let inserted = 0, updated = 0, skipped = sum.blank;
    for (const r of good) { if (r.exists && !d.updatable) { skipped++; continue; } const how = await H[key].apply(r.norm, v.ctx); if (how === 'inserted') inserted++; else if (how === 'updated') updated++; else skipped++; }
    if (inserted + updated === 0) throw S.bad('nothing_to_import', { summary: sum }); // nothing new to save: undo the batch record too
    await h.run('UPDATE import_batches SET imported_rows = ?, skipped_rows = ? WHERE id = ? AND school_id = ?', inserted + updated, skipped, batchId, user.school_id);
    await h.audit(user.school_id, user.id, 'import_applied', `import:${batchId}`, { category: key, inserted, updated, skipped, errors: sum.errors });
    return { batch_id: batchId, inserted, updated, skipped, errors: sum.errors, credentials: d.secret ? v.ctx.credentials : undefined, total: sum.total };
  });
  return result;
}

// ---------- rollback ----------
// A record created by an import is removed only if it is still exactly as the import left it AND nothing newer depends on it.
// A record changed or used since is kept. Records that belong to a kept record (a student's guardian link and history, a product's
// opening stock movement) are kept with it, so nothing is left half-deleted.
const CHILD = { student_guardians: { parent: 'students', col: 'student_id' }, student_history: { parent: 'students', col: 'student_id' }, stock_movements: { parent: 'products', col: 'product_id' } };
async function rollback(app, user, batchId) {
  const h = app.h; const fs = require('node:fs');
  const b = await h.get('SELECT * FROM import_batches WHERE id = ? AND school_id = ?', batchId, user.school_id);
  if (!b) throw S.notFound(); if (b.status === 'rolled_back') throw S.bad('already_rolled_back');
  return await h.tx(async () => {
    const items = await h.all('SELECT * FROM import_items WHERE batch_id = ? AND school_id = ? AND state <> 1 ORDER BY id DESC', b.id, user.school_id);
    const mark = new Map(); for (const it of items) mark.set(`${it.table_name}|${it.record_id}`, it);
    const after = (it) => JSON.parse(it.after_json);
    const parentOf = (it) => { const m = CHILD[it.table_name]; if (!m || it.action !== 'insert') return null; const p = mark.get(`${m.parent}|${after(it)[m.col]}`); return p && p.action === 'insert' ? p : null; };
    const fetch = (it) => (it.table_name === 'schools' ? h.get('SELECT * FROM schools WHERE id = ?', it.record_id) : h.get(`SELECT * FROM ${it.table_name} WHERE id = ? AND school_id = ?`, it.record_id, user.school_id));
    const unchanged = (it, cur) => JSON.stringify(scrub(it.table_name, cur)) === it.after_json;
    const setState = async (it, st) => { await h.run('UPDATE import_items SET state = ? WHERE id = ? AND school_id = ?', st, it.id, user.school_id); };
    const own = (T) => (T === 'schools' ? '' : ' AND school_id = ?'); const ownP = (T) => (T === 'schools' ? [] : [user.school_id]);
    let reverted = 0, kept = 0;
    const done = async (it, st) => { await setState(it, st); if (st === 1) reverted++; else kept++; };
    const removeFile = (it, cur) => { if (it.table_name === 'files' && cur && cur.path) { try { fs.unlinkSync(cur.path); } catch { /* already gone */ } } };
    async function standalone(it) {
      const cur = await fetch(it);
      if (!cur) return done(it, 1);
      if (!unchanged(it, cur)) return done(it, 2);                      // changed since the import: leave it alone
      if (it.action === 'update') {
        const before = JSON.parse(it.before_json); const cols = Object.keys(before).filter((c) => c !== 'id');
        if (it.table_name === 'users') return done(it, 2);
        await h.run(`UPDATE ${it.table_name} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?${own(it.table_name)}`, ...cols.map((c) => before[c]), it.record_id, ...ownP(it.table_name)); return done(it, 1);
      }
      await h.run('SAVEPOINT rb');
      try { await h.run(`DELETE FROM ${it.table_name} WHERE id = ?${own(it.table_name)}`, it.record_id, ...ownP(it.table_name)); await h.run('RELEASE rb'); removeFile(it, cur); return done(it, 1); }
      catch { await h.run('ROLLBACK TO rb'); await h.run('RELEASE rb'); return done(it, 2); }   // in use by newer records: keep it
    }
    async function group(it) { // a parent record together with its children from the same import
      const kids = items.filter((k) => parentOf(k) === it);
      const cur = await fetch(it);
      if (!cur) { for (const k of kids) await standalone(k); return done(it, 1); }
      let ok = unchanged(it, cur);
      if (ok) {
        await h.run('SAVEPOINT rbg');
        try {
          for (const k of kids) { const kc = await fetch(k); if (!kc) continue; if (!unchanged(k, kc)) throw new Error('kid_changed'); await h.run(`DELETE FROM ${k.table_name} WHERE id = ?${own(k.table_name)}`, k.record_id, ...ownP(k.table_name)); }
          await h.run(`DELETE FROM ${it.table_name} WHERE id = ?${own(it.table_name)}`, it.record_id, ...ownP(it.table_name)); await h.run('RELEASE rbg');
          for (const k of kids) await done(k, 1); return done(it, 1);
        } catch { await h.run('ROLLBACK TO rbg'); await h.run('RELEASE rbg'); ok = false; }
      }
      for (const k of kids) await done(k, 2); return done(it, 2);
    }
    const parents = items.filter((it) => items.some((k) => parentOf(k) === it));
    for (const it of parents) await group(it);                          // parents first (with their children)...
    for (const it of items) if (!parentOf(it) && !parents.includes(it)) await standalone(it); // ...then everything else, newest first
    const status = kept === 0 ? 'rolled_back' : (reverted > 0 || b.status === 'partly_rolled_back' ? 'partly_rolled_back' : 'applied');
    await h.run('UPDATE import_batches SET status = ?, rolled_back_by = ?, rolled_back_at = NOW_TS, rollback_note = ? WHERE id = ? AND school_id = ?', status, user.id, `reverted ${reverted}, kept ${kept}`, b.id, user.school_id);
    await h.audit(user.school_id, user.id, 'import_rolled_back', `import:${b.id}`, { reverted, kept });
    return { status, reverted, kept };
  });
}

module.exports = { baseCtx, ins, upd, DEFS, H, templateWorkbook, mapRows, validate, summarize, publicRows, commit, rollback, MAX_ROWS, norm, cell, parseDate, parseNum, parseLevel, classLabel, say, MSG, yes, no };
