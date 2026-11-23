'use strict';
const S = require('./security');
const HELP = require('./help');
const MATHCHAT = require('./mathchat');
const SCHCHAT = require('./dudus-scholarships');

const ADMIN = ['school_admin'];
const ANY = ['school_admin', 'teacher', 'parent', 'student'];
const CATEGORIES = ['history', 'identity', 'development', 'achievements', 'leadership', 'traditions', 'general'];

const STOP = new Set('the a an of to is are was were do does did how what when who why where which in on for and or my me i you your it this that can with from de la le les un une des du et ou est sont que qui quoi comment quand pourquoi où dans pour sur mon ma mes je vous votre ce cette peut avec l d s'.split(' '));
const GENERIC = new Set(['school', 'ecole', 'jao', 'dudus', 'square', 'please', 'tell', 'about', 'show', 'information']);
const tokens = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w));
const score = (qTokens, text) => { const t = new Set(tokens(text)); return qTokens.reduce((n, w) => n + (t.has(w) ? 1 : 0), 0); };

// Questions asking for a named person's private data are refused. DOUDOUS² never has such data anyway.
const PRIVATE = /\b(grades?|marks?|scores?|results?|report cards?|notes?|r[ée]sultats?|bulletins?|phone|t[ée]l[ée]phone|address|adresse|guardian|parent|tuteur|email|e-mail)\b.*\b(of|for|about|de|d'|pour|sur)\s+[A-ZÉÈÀÂ]/;

const MSG = {
  en: { none: 'I do not have confirmed information about that in the school knowledge base. Please ask the school administrator.',
        private: 'I can’t share private student, guardian or staff information. If you are allowed to see it, open the relevant page in JAO (for example Students or Results & Reports).',
        steps: 'Here is how:', page: 'Page', source: 'From the school knowledge base' },
  fr: { none: 'Je n’ai pas d’information confirmée à ce sujet dans la base de connaissances de l’école. Veuillez demander à l’administrateur de l’école.',
        private: 'Je ne peux pas partager d’informations privées sur les élèves, tuteurs ou membres du personnel. Si vous y avez droit, ouvrez la page concernée dans JAO (par exemple Élèves ou Résultats et rapports).',
        steps: 'Voici comment faire :', page: 'Page', source: 'Extrait de la base de connaissances de l’école' },
};

module.exports = function (app) {
  const { h, route } = app;

  const aiConfigured = () => !!(app.env.OPENAI_API_KEY && app.env.OPENAI_MODEL);

  // Find approved content for a question. Only PUBLISHED school entries are ever used.
  async function retrieve(schoolId, role, lang, question) {
    const q = tokens(question).filter((w) => !GENERIC.has(w));
    const need = Math.min(2, q.length) || 99; // short questions need 1 matching word, longer ones need 2
    const help = HELP.filter((t) => t.roles.includes(role))
      .map((t) => ({ t, s: score(q, `${t.keywords} ${t.en.title} ${t.fr.title}`) })).filter((x) => x.s >= need).sort((a, b) => b.s - a.s).slice(0, 2);
    const kb = (await h.all("SELECT * FROM knowledge_items WHERE school_id = ? AND status = 'published'", schoolId))
      .map((k) => ({ k, s: score(q, `${k.title} ${k.category} ${k.body}`) })).filter((x) => x.s >= need).sort((a, b) => b.s - a.s || (b.k.language === lang) - (a.k.language === lang)).slice(0, 2);
    return { help, kb };
  }

  async function answer({ schoolId, role, lang, text, user }) {
    const m = MSG[lang];
    const calc = MATHCHAT.solve(text, lang); // basic arithmetic and logic are answered exactly, locally
    if (calc) return { text: calc, source: null };
    if (PRIVATE.test(text)) return { text: m.private, source: null };
    const sch = await SCHCHAT.answer(h, { user, lang, text }); // real scholarship records only
    if (sch) return { text: sch, source: 'Scholarships' };
    const { help, kb } = await retrieve(schoolId, role, lang, text);
    if (!help.length && !kb.length) return { text: m.none, source: null };
    // Optional: let an AI model phrase the answer, but ONLY from the retrieved approved snippets.
    if (aiConfigured()) {
      try {
        const context = [...help.map((x) => `${x.t[lang].title}: ${x.t[lang].steps.join(' ')}`), ...kb.map((x) => `${x.k.title}: ${x.k.body}`)].join('\n---\n');
        const r = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST', signal: AbortSignal.timeout(20000),
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${app.env.OPENAI_API_KEY}` },
          body: JSON.stringify({ model: app.env.OPENAI_MODEL, instructions:
            `You are DOUDOUS², the assistant of the JAO school management app. Reply in ${lang === 'fr' ? 'French' : 'English'}. Use ONLY the approved context below. ` +
            'If it does not contain the answer, say you have no confirmed information. Never invent dates, names, buttons or policies. Use numbered steps for procedures.\n\nCONTEXT:\n' + context, input: text }),
        });
        if (r.ok) {
          const data = await r.json();
          const out = data.output_text || (data.output || []).flatMap((o) => o.content || []).map((c) => c.text || '').join('');
          if (out.trim()) return { text: out.trim(), source: null, ai: true };
        }
      } catch { /* fall back to the knowledge-base answer below */ }
    }
    const parts = [];
    for (const { t } of help) parts.push(`${t[lang].title}\n${m.steps}\n${t[lang].steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n(${m.page}: ${t.page})`);
    for (const { k } of kb) parts.push(`${k.title}\n${k.body}${k.period ? `\n(${k.period})` : ''}\n— ${m.source}`);
    return { text: parts.join('\n\n'), source: help[0] ? help[0].t.page : 'School knowledge' };
  }

  const clean = (b) => {
    const text = S.str(b.message, 1000);
    if (!text) throw S.bad('message_required');
    return { text, lang: b.language === 'fr' ? 'fr' : 'en' };
  };

  route('GET', '/dudus/status', ANY, () => ({ ai_configured: aiConfigured(), mode: aiConfigured() ? 'ai' : 'knowledge_base' }));

  route('POST', '/dudus/chat', ANY, async (c) => {
    const { text, lang } = clean(c.body);
    if (!S.rateLimit(`chat:${c.user.id}`, 30, 60 * 1000)) throw new S.HttpError(429, 'too_many_attempts');
    const ans = await answer({ schoolId: c.schoolId, role: c.user.role, lang, text, user: c.user });
    await h.tx(async () => {
      await h.run('INSERT INTO chat_history (school_id, user_id, role, content) VALUES (?,?,?,?)', c.schoolId, c.user.id, 'user', text);
      await h.run('INSERT INTO chat_history (school_id, user_id, role, content) VALUES (?,?,?,?)', c.schoolId, c.user.id, 'assistant', ans.text);
      await h.run('DELETE FROM chat_history WHERE user_id = ? AND school_id = ? AND id NOT IN (SELECT id FROM chat_history WHERE user_id = ? AND school_id = ? ORDER BY id DESC LIMIT 200)', c.user.id, c.schoolId, c.user.id, c.schoolId);
    });
    return ans;
  });
  route('GET', '/dudus/history', ANY, async (c) => (await h.all('SELECT role, content, at FROM chat_history WHERE user_id = ? AND school_id = ? ORDER BY id DESC LIMIT 40', c.user.id, c.schoolId)).reverse());
  route('DELETE', '/dudus/history', ANY, async (c) => { await h.run('DELETE FROM chat_history WHERE user_id = ? AND school_id = ?', c.user.id, c.schoolId); });

  // Public visitors: answers only from the public help topics and PUBLISHED school knowledge.
  route('POST', '/public/dudus/:slug', 'public', async (c) => {
    const school = await h.get("SELECT id FROM schools WHERE slug = ? AND status = 'active' AND approval = 'approved'", c.params.slug);
    if (!school) throw S.notFound();
    const ip = app.clientIp(c.req);
    if (!S.rateLimit(`pchat:${ip}`, 20, 60 * 1000)) throw new S.HttpError(429, 'too_many_attempts');
    const { text, lang } = clean(c.body);
    return await answer({ schoolId: school.id, role: 'public', lang, text });
  });

  // ---------- School Knowledge Management (administrator only) ----------
  const item = async (c, id) => {
    const n = S.toInt(id);
    const k = n === null ? null : await h.get('SELECT * FROM knowledge_items WHERE id = ? AND school_id = ?', n, c.schoolId);
    if (!k) throw S.notFound();
    return k;
  };
  function body(b, cur) {
    const category = b.category ?? cur?.category;
    if (!CATEGORIES.includes(category)) throw S.bad('invalid_category');
    const language = b.language ?? cur?.language ?? 'en';
    if (!['en', 'fr'].includes(language)) throw S.bad('invalid_language');
    return { title: S.req(b.title ?? cur?.title, 'title_required', 150), category, language, period: S.str(b.period ?? cur?.period ?? '', 60) || null,
      body: S.req(b.body ?? cur?.body, 'text_required', 5000), source: S.str(b.source_note ?? cur?.source_note ?? '', 300) || null };
  }
  route('GET', '/knowledge', ADMIN, async (c) => await h.all('SELECT k.*, u.name AS author FROM knowledge_items k LEFT JOIN users u ON u.id = k.author_id WHERE k.school_id = ? ORDER BY k.updated_at DESC', c.schoolId));
  route('POST', '/knowledge', ADMIN, async (c) => {
    const v = body(c.body, null);
    const r = await h.insert('INSERT INTO knowledge_items (school_id, title, category, language, period, body, source_note, author_id) VALUES (?,?,?,?,?,?,?,?)', c.schoolId, v.title, v.category, v.language, v.period, v.body, v.source, c.user.id);
    await h.audit(c.schoolId, c.user.id, 'knowledge_created', `knowledge:${r}`);
    return { id: r };
  });
  route('PUT', '/knowledge/:id', ADMIN, async (c) => {
    const k = await item(c, c.params.id);
    const v = body(c.body, k);
    await h.run("UPDATE knowledge_items SET title=?, category=?, language=?, period=?, body=?, source_note=?, author_id=?, updated_at=NOW_TS, version=version+1 WHERE id=? AND school_id=?", v.title, v.category, v.language, v.period, v.body, v.source, c.user.id, k.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'knowledge_updated', `knowledge:${k.id}`);
  });
  route('POST', '/knowledge/:id/status', ADMIN, async (c) => {
    const k = await item(c, c.params.id);
    if (!['draft', 'published', 'archived'].includes(c.body.status)) throw S.bad('invalid_status');
    await h.run("UPDATE knowledge_items SET status = ?, updated_at = NOW_TS WHERE id = ? AND school_id = ?", c.body.status, k.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, `knowledge_${c.body.status}`, `knowledge:${k.id}`);
  });
  route('DELETE', '/knowledge/:id', ADMIN, async (c) => {
    const k = await item(c, c.params.id);
    await h.run('DELETE FROM knowledge_items WHERE id = ? AND school_id = ?', k.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'knowledge_deleted', `knowledge:${k.id}`, { title: k.title });
  });
  // Preview what DOUDOUS² would answer, using only published entries.
  route('POST', '/knowledge/preview', ADMIN, async (c) => {
    const { text, lang } = clean(c.body);
    return await answer({ schoolId: c.schoolId, role: 'public', lang, text });
  });
};
