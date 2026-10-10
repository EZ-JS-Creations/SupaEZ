/*!
 * SupaEZ v1.0.0
 * Lightweight browser helper for Supabase. MIT License.
 * NOTE: Use only a Supabase publishable key (or legacy anon key) in browser code.
 */
(function installSupaEZ(global) {
  'use strict';

  var doc = global && global.document;
  var scriptAtLoad = doc ? doc.currentScript : null;
  var scriptConfig = scriptAtLoad ? {
    url: scriptAtLoad.getAttribute('data-supaez-url') || scriptAtLoad.getAttribute('data-supabase-url'),
    key: scriptAtLoad.getAttribute('data-supaez-key') || scriptAtLoad.getAttribute('data-supabase-key')
  } : null;

  var client = null;
  var activeConfig = null;
  var activeFingerprint = null;
  var pendingPromise = null;
  var pendingFingerprint = null;
  var sdkPromise = null;
  var boundForms = typeof WeakSet === 'function' ? new WeakSet() : null;
  var boundDeleteButtons = typeof WeakSet === 'function' ? new WeakSet() : null;
  var currentConfig = null;
  var SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

  function makeError(message) {
    return new Error('[SupaEZ] ' + message);
  }

  function getMetaContent(names) {
    if (!doc) return '';
    for (var i = 0; i < names.length; i += 1) {
      var meta = doc.querySelector('meta[name="' + names[i] + '"]');
      if (meta && meta.content) return meta.content.trim();
    }
    return '';
  }

  function readConfig() {
    var fromGlobal = global.SUPAEZ_CONFIG || global.SupaEZConfig || null;
    if (fromGlobal && typeof fromGlobal === 'object') return fromGlobal;

    if (currentConfig) return currentConfig;

    if (scriptConfig && (scriptConfig.url || scriptConfig.key)) return scriptConfig;

    var metaUrl = getMetaContent(['supabase-url', 'supaez-url']);
    var metaKey = getMetaContent(['supabase-publishable-key', 'supabase-anon-key', 'supabase-key', 'supaez-key']);
    if (metaUrl || metaKey) return { url: metaUrl, key: metaKey };
    return null;
  }

  function normalizeConfig(input) {
    var source = input || readConfig();
    if (!source || typeof source !== 'object') {
      throw makeError('Missing configuration. Pass { url, key } to SupaEZ.connect(), or define window.SUPAEZ_CONFIG.');
    }

    var url = String(source.url || source.supabaseUrl || source.projectUrl || '').trim();
    var key = String(source.key || source.publishableKey || source.anonKey || source.supabaseKey || '').trim();

    if (!url) throw makeError('Missing Supabase project URL.');
    if (!key) throw makeError('Missing Supabase publishable key.');

    var parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      throw makeError('The Supabase project URL is not a valid URL.');
    }

    var isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
    if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
      throw makeError('Use an HTTPS URL, except for a local development project.');
    }

    assertBrowserSafeKey(key);

    return {
      url: url.replace(/\/$/, ''),
      key: key,
      clientOptions: source.clientOptions || source.options || {},
      autoBind: source.autoBind !== false
    };
  }

  function assertBrowserSafeKey(key) {
    var lowered = key.toLowerCase();
    if (lowered.indexOf('sb_secret_') === 0 || lowered.indexOf('service_role') !== -1 || lowered.indexOf('secret_key') !== -1) {
      throw makeError('That looks like a secret/service-role key. Frontend code must use a publishable key (sb_publishable_...) or legacy anon key.');
    }

    // Legacy Supabase keys are JWTs. Check the payload when it can be decoded so a
    // service_role token is rejected before the SDK is initialized.
    var parts = key.split('.');
    if (parts.length === 3 && typeof global.atob === 'function') {
      try {
        var payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        while (payload.length % 4) payload += '=';
        var claims = JSON.parse(global.atob(payload));
        if (String(claims.role || '').toLowerCase() === 'service_role') {
          throw makeError('A legacy service_role key cannot be used in browser code. Use a publishable or anon key.');
        }
      } catch (error) {
        if (error && String(error.message || '').indexOf('[SupaEZ]') === 0) throw error;
        // An opaque/malformed key will be rejected by Supabase itself.
      }
    }
  }

  function loadSupabaseSDK() {
    if (global.supabase && typeof global.supabase.createClient === 'function') {
      return Promise.resolve(global.supabase);
    }
    if (sdkPromise) return sdkPromise;
    if (!doc) return Promise.reject(makeError('The Supabase browser SDK is not available in this environment.'));

    sdkPromise = new Promise(function (resolve, reject) {
      var existing = doc.querySelector('script[data-supaez-supabase-sdk]');
      if (existing) {
        existing.addEventListener('load', function () {
          if (global.supabase && typeof global.supabase.createClient === 'function') resolve(global.supabase);
          else reject(makeError('The Supabase SDK loaded, but window.supabase.createClient was not found.'));
        }, { once: true });
        existing.addEventListener('error', function () {
          reject(makeError('Could not load the Supabase browser SDK. Check your connection or content-security policy.'));
        }, { once: true });
        return;
      }

      var tag = doc.createElement('script');
      tag.src = SDK_URL;
      tag.async = true;
      tag.setAttribute('data-supaez-supabase-sdk', '');
      tag.onload = function () {
        if (global.supabase && typeof global.supabase.createClient === 'function') resolve(global.supabase);
        else reject(makeError('The Supabase SDK loaded, but window.supabase.createClient was not found.'));
      };
      tag.onerror = function () {
        reject(makeError('Could not load the Supabase browser SDK. Check your connection or content-security policy.'));
      };
      (doc.head || doc.documentElement).appendChild(tag);
    }).catch(function (error) {
      sdkPromise = null;
      throw error;
    });

    return sdkPromise;
  }

  function dispatch(target, name, detail) {
    if (!target || typeof target.dispatchEvent !== 'function') return;
    var EventCtor = global.CustomEvent;
    if (typeof EventCtor !== 'function') return;
    try {
      target.dispatchEvent(new EventCtor(name, { detail: detail, bubbles: true }));
    } catch (error) {
      // Events are a convenience and should not interrupt database work.
    }
  }

  function setStatus(message, state) {
    if (!doc) return;
    var nodes = doc.querySelectorAll('[data-supaez-status]');
    Array.prototype.forEach.call(nodes, function (node) {
      node.textContent = message;
      node.setAttribute('data-state', state || '');
    });
  }

  function requireClient() {
    if (!client) throw makeError('No client yet. Call await SupaEZ.connect({ url, key }) first.');
    return client;
  }

  function connect(input) {
    var config;
    try {
      config = normalizeConfig(input);
    } catch (error) {
      setStatus(error.message, 'error');
      return Promise.reject(error);
    }

    var fingerprint = config.url + '|' + config.key;
    if (client && activeFingerprint === fingerprint) {
      return config.autoBind && doc ? bind(doc).then(function () { return client; }) : Promise.resolve(client);
    }
    if (pendingPromise && pendingFingerprint === fingerprint) return pendingPromise;

    currentConfig = config;
    pendingFingerprint = fingerprint;
    setStatus('Connecting Supabase client…', 'connecting');

    var task = loadSupabaseSDK().then(function (sdk) {
      var createdClient = sdk.createClient(config.url, config.key, config.clientOptions);
      client = createdClient;
      activeConfig = config;
      activeFingerprint = fingerprint;
      setStatus('SupaEZ client ready', 'ready');
      dispatch(doc, 'supaez:ready', { client: client, url: config.url });
      dispatch(global, 'supaez:ready', { client: client, url: config.url });
      if (config.autoBind && doc) {
        return bind(doc).then(function () { return client; });
      }
      return client;
    }).catch(function (error) {
      setStatus(error && error.message ? error.message : 'SupaEZ could not initialize.', 'error');
      dispatch(doc, 'supaez:error', { error: error });
      dispatch(global, 'supaez:error', { error: error });
      throw error;
    }).finally(function () {
      if (pendingPromise === task) {
        pendingPromise = null;
        pendingFingerprint = null;
      }
    });

    pendingPromise = task;
    return task;
  }

  function collect(root, selector) {
    if (!root) return [];
    var found = [];
    if (typeof root.matches === 'function' && root.matches(selector)) found.push(root);
    if (typeof root.querySelectorAll === 'function') {
      found = found.concat(Array.prototype.slice.call(root.querySelectorAll(selector)));
    }
    return found;
  }

  function getPath(object, path) {
    return path.split('.').reduce(function (value, part) {
      return value == null ? undefined : value[part];
    }, object);
  }

  function substituteText(root, row) {
    if (!doc || typeof doc.createTreeWalker !== 'function') return;
    var showText = global.NodeFilter ? global.NodeFilter.SHOW_TEXT : 4;
    var walker = doc.createTreeWalker(root, showText);
    var node;
    var matcher = /\{\{\s*([a-zA-Z0-9_$.-]+)\s*\}\}/g;
    while ((node = walker.nextNode())) {
      node.nodeValue = node.nodeValue.replace(matcher, function (_match, path) {
        var value = getPath(row, path);
        return value === undefined || value === null ? '' : String(value);
      });
    }
  }

  function parseOrder(value) {
    if (!value) return null;
    var pieces = value.split(':');
    var column = pieces[0].trim();
    var direction = String(pieces[1] || 'asc').trim().toLowerCase();
    if (!column) return null;
    return { column: column, ascending: direction !== 'desc' };
  }

  function parseMatch(value) {
    if (!value) return [];
    return value.split(';').map(function (part) {
      var index = part.indexOf('=');
      if (index <= 0) return null;
      return { column: part.slice(0, index).trim(), value: part.slice(index + 1).trim() };
    }).filter(function (item) { return item && item.column; });
  }

  function applyMatch(query, form) {
    var matches = parseMatch(form.getAttribute('data-supaez-match'));
    matches.forEach(function (match) {
      query = query.eq(match.column, match.value);
    });
    return query;
  }

  function setFormMessage(form, text, state) {
    var node = form.querySelector('[data-supaez-message]');
    if (node) {
      node.textContent = text;
      node.setAttribute('data-state', state || '');
    }
  }

  function formPayload(form) {
    var payload = {};
    Array.prototype.forEach.call(form.elements || [], function (element) {
      if (!element.name || element.disabled) return;
      var type = String(element.type || '').toLowerCase();
      if (['submit', 'button', 'reset', 'file', 'image'].indexOf(type) !== -1) return;
      if (type === 'radio' && !element.checked) return;
      if (type === 'checkbox') {
        payload[element.name] = Boolean(element.checked);
      } else {
        payload[element.name] = element.value;
      }
    });
    return payload;
  }

  function setSubmitting(form, isSubmitting) {
    Array.prototype.forEach.call(form.querySelectorAll('button:not([type]), button[type="submit"], input[type="submit"]'), function (button) {
      button.disabled = isSubmitting;
    });
    form.setAttribute('aria-busy', isSubmitting ? 'true' : 'false');
  }

  function bindForms(root) {
    collect(root, 'form[data-supaez-form]').forEach(function (form) {
      if (boundForms && boundForms.has(form)) return;
      if (!boundForms && form.getAttribute('data-supaez-bound') === 'true') return;
      if (boundForms) boundForms.add(form);
      form.setAttribute('data-supaez-bound', 'true');

      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        var table = form.getAttribute('data-supaez-form');
        var action = String(form.getAttribute('data-supaez-action') || 'insert').toLowerCase();
        if (!table) {
          setFormMessage(form, 'Missing table name in data-supaez-form.', 'error');
          return;
        }
        var payload = formPayload(form);
        var db;
        setSubmitting(form, true);
        setFormMessage(form, 'Saving…', 'pending');

        try {
          db = requireClient();
          var query;
          if (action === 'insert') {
            query = db.from(table).insert(payload);
          } else if (action === 'upsert') {
            query = db.from(table).upsert(payload);
          } else if (action === 'update') {
            var match = parseMatch(form.getAttribute('data-supaez-match'));
            if (!match.length) throw makeError('An update form requires data-supaez-match, such as data-supaez-match="id=42".');
            query = applyMatch(db.from(table).update(payload), form);
          } else {
            throw makeError('Unsupported form action "' + action + '". Use insert, update, or upsert.');
          }

          var result = await query;
          if (result && result.error) throw result.error;
          setFormMessage(form, form.getAttribute('data-supaez-success') || 'Saved successfully.', 'success');
          dispatch(form, 'supaez:success', { table: table, action: action, payload: payload, result: result });
          if (action !== 'update' && form.getAttribute('data-supaez-reset') !== 'false') form.reset();
          await refreshLists(doc || root);
        } catch (error) {
          var message = error && error.message ? error.message : 'The save failed.';
          setFormMessage(form, message, 'error');
          dispatch(form, 'supaez:error', { table: table, action: action, error: error });
        } finally {
          setSubmitting(form, false);
        }
      });
    });
  }

  async function renderList(container, rows, table) {
    var template = container.querySelector('template[data-supaez-template]') || container.querySelector('template');
    if (!template) {
      throw makeError('A [data-supaez-list="' + table + '"] element needs a child <template data-supaez-template>…</template>.');
    }

    container.replaceChildren(template);
    if (!rows.length) {
      var emptyText = container.getAttribute('data-supaez-empty');
      if (emptyText) {
        var empty = doc.createElement('span');
        empty.setAttribute('data-supaez-empty-state', '');
        empty.textContent = emptyText;
        container.appendChild(empty);
      }
      return;
    }

    rows.forEach(function (row) {
      var fragment = template.content.cloneNode(true);
      substituteText(fragment, row);
      container.appendChild(fragment);
      var deleteButtons = collect(container, '[data-supaez-delete]');
      deleteButtons.forEach(function (button) {
        if (boundDeleteButtons && boundDeleteButtons.has(button)) return;
        if (!boundDeleteButtons && button.getAttribute('data-supaez-bound') === 'true') return;
        if (boundDeleteButtons) boundDeleteButtons.add(button);
        button.setAttribute('data-supaez-bound', 'true');
        button.addEventListener('click', async function (event) {
          event.preventDefault();
          var primaryKey = button.getAttribute('data-supaez-id-key') || container.getAttribute('data-supaez-id-key') || 'id';
          var id = getPath(row, primaryKey);
          if (id === undefined || id === null) {
            setStatus('Cannot delete: row has no "' + primaryKey + '" value.', 'error');
            return;
          }
          button.disabled = true;
          try {
            var deletion = await requireClient().from(table).delete().eq(primaryKey, id);
            if (deletion && deletion.error) throw deletion.error;
            await refreshLists(doc || container);
            dispatch(container, 'supaez:deleted', { table: table, row: row });
          } catch (error) {
            setStatus(error && error.message ? error.message : 'Delete failed.', 'error');
          } finally {
            button.disabled = false;
          }
        });
      });
    });
  }

  async function refreshList(container) {
    var table = container.getAttribute('data-supaez-list');
    if (!table) return;
    var query = requireClient().from(table).select(container.getAttribute('data-supaez-select') || '*');
    var order = parseOrder(container.getAttribute('data-supaez-order'));
    if (order) query = query.order(order.column, { ascending: order.ascending });
    var limitRaw = container.getAttribute('data-supaez-limit');
    if (limitRaw) {
      var limit = Number.parseInt(limitRaw, 10);
      if (Number.isFinite(limit) && limit > 0) query = query.limit(limit);
    }
    var result = await query;
    if (result && result.error) throw result.error;
    await renderList(container, Array.isArray(result && result.data) ? result.data : [], table);
    container.setAttribute('data-state', 'loaded');
    dispatch(container, 'supaez:list-loaded', { table: table, data: result.data || [] });
  }

  async function refreshLists(root) {
    if (!client || !doc) return;
    var lists = collect(root || doc, '[data-supaez-list]');
    var outcomes = await Promise.all(lists.map(async function (list) {
      try {
        await refreshList(list);
        list.removeAttribute('data-supaez-error');
      } catch (error) {
        list.setAttribute('data-state', 'error');
        list.setAttribute('data-supaez-error', error && error.message ? error.message : 'Query failed');
        dispatch(list, 'supaez:error', { error: error, table: list.getAttribute('data-supaez-list') });
      }
    }));
    return outcomes;
  }

  function bind(root) {
    requireClient();
    var target = root || doc;
    bindForms(target);
    return refreshLists(target).then(function () { return api; });
  }

  function auto() {
    var found = readConfig();
    if (!found) return Promise.resolve(null);
    return connect(found);
  }

  function configure(input) {
    if (!input || typeof input !== 'object') throw makeError('configure() expects an object with url and key.');
    currentConfig = input;
    global.SUPAEZ_CONFIG = input;
    return api;
  }

  var api = {
    version: '1.0.0',
    connect: connect,
    configure: configure,
    auto: auto,
    bind: bind,
    refresh: function (root) { requireClient(); return refreshLists(root || doc); },
    from: function (table) { return requireClient().from(table); },
    getClient: function () { return client; },
    getConfig: function () { return activeConfig ? { url: activeConfig.url } : null; }
  };

  Object.defineProperty(api, 'client', { enumerable: true, get: function () { return client; } });
  Object.defineProperty(api, 'auth', { enumerable: true, get: function () { return client ? client.auth : null; } });

  global.SupaEZ = api;

  // The DOMContentLoaded timing lets a configuration object in the next script tag
  // be defined before auto-setup runs.
  if (doc) {
    var boot = function () {
      auto().catch(function (error) {
        if (global.console && typeof global.console.error === 'function') global.console.error(error.message || error);
      });
    };
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot, { once: true });
    else if (typeof global.setTimeout === 'function') global.setTimeout(boot, 0);
  }
})(typeof window !== 'undefined' ? window : globalThis);
