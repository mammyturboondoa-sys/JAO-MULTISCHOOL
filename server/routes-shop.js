'use strict';
const S = require('./security');

const ADMIN = ['school_admin'];
const CATEGORIES = ['textbooks', 'notebooks', 'reading_books', 'school_supplies', 'school_uniforms'];
// Sign of each stock movement type. Quantities are always entered as positive whole numbers.
const MOVES = { restock: 1, return: 1, adjustment_in: 1, sale: -1, damaged: -1, adjustment_out: -1 };

module.exports = function (app) {
  const { h, route } = app;

  const availability = (p) => (p.quantity <= 0 ? 'out_of_stock' : p.quantity <= p.low_threshold ? 'low_stock' : 'in_stock');
  const imageUrl = (p) => (p.image_file_id ? `/api/public/image/${p.image_file_id}` : null);

  // ---------- PUBLIC catalogue (no login). Never exposes quantities, thresholds or any student data. ----------
  const publicProduct = (p) => ({ id: p.id, name: p.name, description: p.description, category: p.category, class_level: p.class_level,
    price: p.price, variant: p.variant, availability: availability(p), image: imageUrl(p) });
  const activeSchool = async (slug) => {
    const s = await h.get("SELECT * FROM schools WHERE slug = ? AND status = 'active' AND approval = 'approved'", slug);
    if (!s) throw S.notFound();
    return s;
  };

  route('GET', '/public/shop/:slug', 'public', async (c) => {
    const s = await activeSchool(c.params.slug);
    return { school: { name: s.name, slug: s.slug, motto: s.motto, address: s.address, phone: s.phone, email: s.email,
      shop_hours: s.shop_hours, shop_instructions: s.shop_instructions, logo: s.logo_file_id ? `/api/public/image/${s.logo_file_id}` : null }, categories: CATEGORIES };
  });
  route('GET', '/public/shop/:slug/products', 'public', async (c) => {
    const s = await activeSchool(c.params.slug);
    const where = ['school_id = ?', 'active = 1', 'is_public = 1'], p = [s.id];
    if (CATEGORIES.includes(c.query.category)) { where.push('category = ?'); p.push(c.query.category); }
    const q = S.str(c.query.q, 60);
    if (q) { where.push("(LOWER(name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(description) LIKE LOWER(?) ESCAPE '\\')"); const l = `%${q.replace(/[\\%_]/g, '\\$&')}%`; p.push(l, l); }
    const lvl = S.str(c.query.class_level, 40);
    if (lvl) { where.push('class_level = ?'); p.push(lvl); }
    return (await h.all(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY category, name LIMIT 200`, ...p)).map(publicProduct);
  });
  route('GET', '/public/shop/:slug/products/:id', 'public', async (c) => {
    const s = await activeSchool(c.params.slug);
    const p = await h.get('SELECT * FROM products WHERE id = ? AND school_id = ? AND active = 1 AND is_public = 1', Number(c.params.id), s.id);
    if (!p) throw S.notFound();
    return publicProduct(p);
  });

  // ---------- ADMIN: products & stock ----------
  const ownedProduct = async (c, id) => {
    const n = S.toInt(id);
    const p = n === null ? null : await h.get('SELECT * FROM products WHERE id = ? AND school_id = ?', n, c.schoolId);
    if (!p) throw S.notFound();
    return p;
  };
  const adminProduct = (p) => ({ id: p.id, code: p.code, name: p.name, description: p.description, category: p.category, class_level: p.class_level,
    price: p.price, quantity: p.quantity, low_threshold: p.low_threshold, variant: p.variant, active: !!p.active, is_public: !!p.is_public,
    availability: availability(p), image: imageUrl(p) });

  route('GET', '/products/summary', ADMIN, async (c) => ({
    total: (await h.get('SELECT COUNT(*) n FROM products WHERE school_id = ?', c.schoolId)).n,
    available: (await h.get('SELECT COUNT(*) n FROM products WHERE school_id = ? AND active = 1 AND quantity > 0', c.schoolId)).n,
    low_stock: (await h.get('SELECT COUNT(*) n FROM products WHERE school_id = ? AND active = 1 AND quantity > 0 AND quantity <= low_threshold', c.schoolId)).n,
    out_of_stock: (await h.get('SELECT COUNT(*) n FROM products WHERE school_id = ? AND active = 1 AND quantity = 0', c.schoolId)).n,
  }));
  route('GET', '/products', ADMIN, async (c) => {
    const where = ['school_id = ?'], p = [c.schoolId];
    if (CATEGORIES.includes(c.query.category)) { where.push('category = ?'); p.push(c.query.category); }
    if (c.query.active === '0' || c.query.active === '1') { where.push('active = ?'); p.push(Number(c.query.active)); }
    if (c.query.stock === 'low') where.push('quantity > 0 AND quantity <= low_threshold');
    if (c.query.stock === 'out') where.push('quantity = 0');
    const q = S.str(c.query.q, 60);
    if (q) { where.push("(LOWER(name) LIKE LOWER(?) ESCAPE '\\' OR LOWER(code) LIKE LOWER(?) ESCAPE '\\')"); const l = `%${q.replace(/[\\%_]/g, '\\$&')}%`; p.push(l, l); }
    return (await h.all(`SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY name`, ...p)).map(adminProduct);
  });

  function productBody(b, cur) {
    const code = S.req(b.code ?? cur?.code, 'code_required', 30).toUpperCase();
    if (!/^[A-Z0-9_-]+$/.test(code)) throw S.bad('invalid_code');
    const category = b.category ?? cur?.category;
    if (!CATEGORIES.includes(category)) throw S.bad('invalid_category');
    const price = b.price === undefined ? cur?.price : Number(b.price);
    if (!Number.isInteger(price) || price < 0 || price > 100000000) throw S.bad('invalid_price');
    const low = b.low_threshold === undefined ? cur?.low_threshold ?? 5 : Number(b.low_threshold);
    if (!Number.isInteger(low) || low < 0 || low > 100000) throw S.bad('invalid_threshold');
    return { code, name: S.req(b.name ?? cur?.name, 'name_required', 120), description: S.str(b.description ?? cur?.description ?? '', 1000) || null,
      category, class_level: S.str(b.class_level ?? cur?.class_level ?? '', 40) || null, price, low,
      variant: S.str(b.variant ?? cur?.variant ?? '', 80) || null,
      active: b.active === undefined ? (cur ? cur.active : 1) : (b.active ? 1 : 0),
      is_public: b.is_public === undefined ? (cur ? cur.is_public : 1) : (b.is_public ? 1 : 0) };
  }

  route('POST', '/products', ADMIN, async (c) => {
    const v = productBody(c.body, null);
    const qty = c.body.quantity === undefined || c.body.quantity === '' ? 0 : Number(c.body.quantity);
    if (!Number.isInteger(qty) || qty < 0 || qty > 1000000) throw S.bad('invalid_quantity');
    return await h.tx(async () => {
      const image = c.body.image ? await app.saveImage(c.schoolId, 'product_image', c.body.image, c.user.id) : null;
      const r = await h.insert(`INSERT INTO products (school_id, code, name, description, category, class_level, price, quantity, low_threshold, variant, image_file_id, active, is_public)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`, c.schoolId, v.code, v.name, v.description, v.category, v.class_level, v.price, qty, v.low, v.variant, image, v.active, v.is_public);
      const id = r;
      if (qty > 0) await h.run("INSERT INTO stock_movements (school_id, product_id, type, change, previous_qty, new_qty, reason, actor_id) VALUES (?,?, 'initial', ?, 0, ?, 'Initial quantity', ?)", c.schoolId, id, qty, qty, c.user.id);
      await h.audit(c.schoolId, c.user.id, 'product_created', `product:${id}`);
      return { id };
    });
  }).bodyLimit = 4 * 1024 * 1024;

  route('PUT', '/products/:id', ADMIN, async (c) => {
    const cur = await ownedProduct(c, c.params.id);
    const v = productBody(c.body, cur);
    let image = cur.image_file_id;
    if (c.body.image) image = await app.saveImage(c.schoolId, 'product_image', c.body.image, c.user.id);
    if (c.body.remove_image) image = null;
    await h.run(`UPDATE products SET code=?, name=?, description=?, category=?, class_level=?, price=?, low_threshold=?, variant=?, image_file_id=?, active=?, is_public=? WHERE id=? AND school_id=?`,
      v.code, v.name, v.description, v.category, v.class_level, v.price, v.low, v.variant, image, v.active, v.is_public, cur.id, c.schoolId);
    if (v.price !== cur.price) await h.audit(c.schoolId, c.user.id, 'product_price_changed', `product:${cur.id}`, { from: cur.price, to: v.price });
    await h.audit(c.schoolId, c.user.id, 'product_updated', `product:${cur.id}`);
  }).bodyLimit = 4 * 1024 * 1024;

  route('DELETE', '/products/:id', ADMIN, async (c) => { // deactivate (hides from catalogue, keeps stock history)
    const cur = await ownedProduct(c, c.params.id);
    await h.run('UPDATE products SET active = 0 WHERE id = ? AND school_id = ?', cur.id, c.schoolId);
    await h.audit(c.schoolId, c.user.id, 'product_deactivated', `product:${cur.id}`);
  });

  route('POST', '/products/:id/stock', ADMIN, async (c) => {
    const type = c.body.type;
    if (!(type in MOVES)) throw S.bad('invalid_movement_type');
    const qty = Number(c.body.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000000) throw S.bad('invalid_quantity');
    const reason = S.str(c.body.reason, 200);
    if (['adjustment_in', 'adjustment_out', 'damaged'].includes(type) && !reason) throw S.bad('reason_required');
    return await h.tx(async () => {
      const p = await ownedProduct(c, c.params.id);
      const change = MOVES[type] * qty, next = p.quantity + change;
      if (next < 0) throw S.bad('insufficient_stock');
      await h.run('UPDATE products SET quantity = ? WHERE id = ? AND school_id = ?', next, p.id, c.schoolId);
      await h.run('INSERT INTO stock_movements (school_id, product_id, type, change, previous_qty, new_qty, reason, actor_id) VALUES (?,?,?,?,?,?,?,?)',
        c.schoolId, p.id, type, change, p.quantity, next, reason || null, c.user.id);
      await h.audit(c.schoolId, c.user.id, 'stock_changed', `product:${p.id}`, { type, change });
      return { quantity: next };
    });
  });
  route('GET', '/products/:id/movements', ADMIN, async (c) => {
    const p = await ownedProduct(c, c.params.id);
    return await h.all(`SELECT m.type, m.change, m.previous_qty, m.new_qty, m.reason, m.at, u.name AS actor FROM stock_movements m LEFT JOIN users u ON u.id = m.actor_id
      WHERE m.product_id = ? AND m.school_id = ? ORDER BY m.id DESC LIMIT 100`, p.id, c.schoolId);
  });
};
