/* sidecar/credit/template.js — a tiny deterministic template renderer.
   Supports {{path}}, {{#each list}}…{{/each}} with {{this}} and 1-based {{@number}},
   and one partial {{> name}}. No helpers, no HTML escaping, no evaluation of expressions.
   Unknown paths render as an empty string so a missing fact cannot be invented by the template. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; (root.SK.credit = root.SK.credit || {}).template = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function lookup(ctx, path) {
    path = String(path || '').trim();
    if (!path) return '';
    if (path === 'this') return ctx && ctx.this != null ? ctx.this : '';
    if (path === '@number') return ctx && ctx['@number'] != null ? ctx['@number'] : '';
    let cur = ctx;
    while (cur) {
      const parts = path.split('.');
      if (Object.prototype.hasOwnProperty.call(cur, parts[0])) {
        let v = cur;
        let ok = true;
        for (const p of parts) {
          if (v != null && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, p)) v = v[p];
          else { ok = false; break; }
        }
        if (ok) return v == null ? '' : v;
      }
      cur = cur.parent;
    }
    return '';
  }

  function childContext(parent, item, number) {
    const ctx = { parent: parent, this: item, '@number': number };
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      for (const k of Object.keys(item)) ctx[k] = item[k];
    }
    return ctx;
  }

  function findEndEach(tpl, from) {
    let depth = 1;
    let i = from;
    while (i < tpl.length) {
      const open = tpl.indexOf('{{#each', i);
      const close = tpl.indexOf('{{/each}}', i);
      if (close < 0) return -1;
      if (open >= 0 && open < close) { depth++; i = open + 7; continue; }
      depth--;
      if (depth === 0) return close;
      i = close + 9;
    }
    return -1;
  }

  function render(tpl, ctx, partials) {
    tpl = String(tpl == null ? '' : tpl);
    ctx = ctx || {};
    partials = partials || {};
    let out = '';
    let i = 0;
    while (i < tpl.length) {
      const at = tpl.indexOf('{{', i);
      if (at < 0) { out += tpl.slice(i); break; }
      out += tpl.slice(i, at);
      if (tpl.slice(at, at + 7) === '{{#each') {
        const headEnd = tpl.indexOf('}}', at);
        if (headEnd < 0) { out += tpl.slice(at); break; }
        const path = tpl.slice(at + 7, headEnd).trim();
        const innerStart = headEnd + 2;
        const close = findEndEach(tpl, innerStart);
        if (close < 0) { out += tpl.slice(at); break; }
        const inner = tpl.slice(innerStart, close);
        const list = lookup(ctx, path);
        const arr = Array.isArray(list) ? list : [];
        for (let n = 0; n < arr.length; n++) out += render(inner, childContext(ctx, arr[n], n + 1), partials);
        i = close + '{{/each}}'.length;
        continue;
      }
      if (tpl.slice(at, at + 3) === '{{>') {
        const headEnd = tpl.indexOf('}}', at);
        if (headEnd < 0) { out += tpl.slice(at); break; }
        const name = tpl.slice(at + 3, headEnd).trim();
        const partial = partials[name];
        if (partial != null) out += render(partial, ctx, partials);
        i = headEnd + 2;
        continue;
      }
      const headEnd = tpl.indexOf('}}', at);
      if (headEnd < 0) { out += tpl.slice(at); break; }
      const path = tpl.slice(at + 2, headEnd).trim();
      if (path.charAt(0) === '#' || path.charAt(0) === '/') { i = headEnd + 2; continue; }
      out += lookup(ctx, path);
      i = headEnd + 2;
    }
    return out;
  }

  return { render, lookup };
});
