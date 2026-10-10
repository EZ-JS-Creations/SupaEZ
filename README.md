# SupaEZ

**SupaEZ** is a lightweight browser helper for connecting a web app to Supabase and wiring HTML elements to database tables without building a whole frontend integration from scratch.

It is designed to be hosted as an npm package and served through jsDelivr. jsDelivr cannot store an unpublished local folder; first publish this package to npm (or push it to GitHub), then reference that hosted package through the CDN.

## 1. Fastest setup

After publishing a package named `supae-z`, add the library and then put your project settings right after it:

```html
<script src="https://cdn.jsdelivr.net/npm/supae-z@1.0.0/dist/supaez.global.js"></script>
<script>
  window.SUPAEZ_CONFIG = {
    url: "https://YOUR_PROJECT_REF.supabase.co",
    key: "sb_publishable_YOUR_KEY"
  };
</script>
```

SupaEZ automatically reads `window.SUPAEZ_CONFIG` once the HTML document is ready and creates a Supabase client. It loads the Supabase browser SDK from jsDelivr if that SDK isn't already present.

The client is available as `SupaEZ.client`. You can also call `await SupaEZ.connect({ url, key })` directly. `connect()` returns the Supabase client, so the full Supabase JS API remains available:

```html
<script>
  async function loadTasks() {
    const supabase = await SupaEZ.connect({
      url: "https://YOUR_PROJECT_REF.supabase.co",
      key: "sb_publishable_YOUR_KEY"
    });

    const { data, error } = await supabase
      .from("tasks")
      .select("id, title")
      .order("id", { ascending: true });

    if (error) throw error;
    console.log(data);
  }

  // Run this after the SupaEZ library has loaded.
  loadTasks().catch(console.error);
</script>
```

You only need to call `connect()` once for a project. Repeated calls with the same URL and key reuse the client.

## 2. Use HTML to read rows

Create a table called `tasks` in Supabase, add safe grants and Row Level Security (RLS) policies, then add:

```html
<p data-supaez-status>Waiting for SupaEZ…</p>

<ul
  data-supaez-list="tasks"
  data-supaez-select="id,title"
  data-supaez-order="id:desc"
  data-supaez-limit="20"
  data-supaez-empty="No tasks yet."
>
  <template data-supaez-template>
    <li>
      <span>{{title}}</span>
      <button type="button" data-supaez-delete>Delete</button>
    </li>
  </template>
</ul>
```

Supported list attributes:

- `data-supaez-list="table_name"` — table to read.
- `data-supaez-select="id,title"` — optional selected columns; defaults to `*`.
- `data-supaez-order="column:desc"` — optional ordering; use `asc` or `desc`.
- `data-supaez-limit="20"` — optional positive row limit.
- `data-supaez-empty="No rows."` — optional message for empty results.
- `data-supaez-id-key="id"` — primary-key field for delete buttons; defaults to `id`.

Inside the template, text placeholders like `{{title}}` or `{{owner.name}}` are replaced with row values as **text**, not parsed HTML. This is intentional for safer rendering. A delete button deletes the matching row by its primary key, subject to the permissions and RLS policies in your Supabase project.

## 3. Use a form to insert, update, or upsert

```html
<form data-supaez-form="tasks" data-supaez-action="insert">
  <label>
    Task title
    <input name="title" required maxlength="200">
  </label>
  <button type="submit">Add task</button>
  <span data-supaez-message role="status"></span>
</form>
```

The `name` attribute on each input becomes the database column name. Supported action values are:

- `data-supaez-action="insert"` — default; inserts one row.
- `data-supaez-action="upsert"` — inserts or updates based on your table's conflict rules.
- `data-supaez-action="update"` — updates rows matching `data-supaez-match`; for example, `data-supaez-match="id=42"`.

Example update form:

```html
<form
  data-supaez-form="tasks"
  data-supaez-action="update"
  data-supaez-match="id=42"
>
  <input name="title" value="Updated title" required>
  <button type="submit">Save changes</button>
  <span data-supaez-message role="status"></span>
</form>
```

After a successful insert, update, or upsert, SupaEZ refreshes lists on the page. Forms can listen for the `supaez:success` or `supaez:error` custom events. Lists emit `supaez:list-loaded`, and the document emits `supaez:ready` when the client has been initialized.

## 4. Alternative configuration styles

### Configure directly on the script element

```html
<script
  src="https://cdn.jsdelivr.net/npm/supae-z@1.0.0/dist/supaez.global.js"
  data-supaez-url="https://YOUR_PROJECT_REF.supabase.co"
  data-supaez-key="sb_publishable_YOUR_KEY"
></script>
```

### Use meta tags

```html
<meta name="supabase-url" content="https://YOUR_PROJECT_REF.supabase.co">
<meta name="supabase-publishable-key" content="sb_publishable_YOUR_KEY">
<script src="https://cdn.jsdelivr.net/npm/supae-z@1.0.0/dist/supaez.global.js"></script>
```

### Bind elements added later

SupaEZ automatically binds elements found when it connects. If your app adds more forms or lists later, call:

```js
await SupaEZ.bind(document.querySelector("#new-section"));
```

To refresh existing lists after a change made by your own app code:

```js
await SupaEZ.refresh();
```

## 5. Publish and put it on jsDelivr

1. Install Node.js and npm if they are not installed.
2. In this folder, run `npm test` and `npm pack --dry-run`.
3. Sign in to npm with `npm login`.
4. Confirm the package name `supae-z` is available. If it is taken, choose an available lowercase npm name and change `name` in `package.json` and the CDN URLs in this README.
5. Publish with `npm publish --access public`.
6. Use the versioned CDN URL in your app: `https://cdn.jsdelivr.net/npm/supae-z@1.0.0/dist/supaez.global.js`.

You can also publish the source to a public GitHub repository and use a URL shaped like `https://cdn.jsdelivr.net/gh/USERNAME/REPOSITORY@TAG/dist/supaez.global.js`. Replace the placeholders with your actual GitHub username/repository and a release tag.

**I have not published this package to npm or created a GitHub repository for you.** The files in this folder are the ready-to-publish package source. Once the package is hosted publicly, jsDelivr can serve it.

## Security checklist

- Use a Supabase **publishable** key (starts `sb_publishable_`) or the legacy **anon** key only in browser code.
- Never place `sb_secret_...` or `service_role` keys in HTML, client JavaScript, or a public repository. SupaEZ rejects recognizable secret/service-role keys, but that check is only a guardrail, not a security boundary.
- Enable RLS on tables exposed to browser clients and create the narrowest policies that your app needs. SupaEZ does not bypass or replace Supabase permissions.
- Validate user input on the server/database side too. Frontend validation is not a security control.
- `SupaEZ.client` being available means the client was initialized, not that every table is reachable. The first database request can still fail if the table, grants, RLS policies, project URL, or key are wrong.

## API quick reference

- `await SupaEZ.connect({ url, key, clientOptions?, autoBind? })` — create/reuse the client and bind HTML elements.
- `SupaEZ.configure({ url, key })` — store config for automatic setup.
- `await SupaEZ.auto()` — read supported config locations and connect.
- `await SupaEZ.bind(root?)` — bind forms and load list elements in a root node.
- `await SupaEZ.refresh(root?)` — refresh list elements.
- `SupaEZ.from(table)` — shorthand for `SupaEZ.client.from(table)` after connecting.
- `SupaEZ.client` — the full Supabase JS client.
- `SupaEZ.auth` — shortcut for `SupaEZ.client.auth` after connecting.

`data-supaez-status` elements show basic initialization status via text and a `data-state` attribute. Values include `connecting`, `ready`, and `error`.
