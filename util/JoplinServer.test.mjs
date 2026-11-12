import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import JoplinServer, { loadServerCatalog } from './JoplinServer.mjs';

const originalFetch = globalThis.fetch;
const originalBrowser = globalThis.browser;
const folderId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('Direct Joplin Server clipping', () => {
	test('rechecks expanded content visibility after earlier complete-page clipping', async () => {
		const source = await readFile(new URL('../content_scripts/index.js', import.meta.url), 'utf8');
		const start = source.indexOf('function preProcessDocument(');
		const end = source.indexOf('\n\t// This sets the PRE', start);
		const preprocess = runInNewContext(`(${source.slice(start, end).trim()})`, { window: { getComputedStyle: node => node.computedStyle } });
		const createElement = children => {
			const classes = new Set();
			const element = { nodeName: 'DIV', nodeType: 1, childNodes: children, computedStyle: { display: 'block', visibility: 'visible' }, classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) } };
			for (const child of children) child.parentNode = element;
			return element;
		};
		const nested = createElement([]);
		const expanded = createElement([nested]);
		const document = createElement([expanded]);
		expanded.computedStyle.display = 'none';
		preprocess(document);
		assert.equal(expanded.classList.contains('joplin-clipper-hidden'), true);
		expanded.computedStyle.display = 'block';
		nested.computedStyle.visibility = 'hidden';
		preprocess(document);
		assert.equal(expanded.classList.contains('joplin-clipper-hidden'), false);
		assert.equal(nested.classList.contains('joplin-clipper-hidden'), true);
		nested.computedStyle.visibility = 'visible';
		preprocess(document);
		assert.equal(nested.classList.contains('joplin-clipper-hidden'), false);
		expanded.computedStyle.display = 'none';
		preprocess(document);
		assert.equal(expanded.classList.contains('joplin-clipper-hidden'), true);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		if (originalBrowser === undefined) delete globalThis.browser;
		else globalThis.browser = originalBrowser;
	});

	test('validates server URLs and keeps reverse-proxy prefixes', () => {
		for (const url of ['ftp://example.org', 'https://user:password@example.org', 'https://example.org/?token=secret', 'https://example.org/#fragment']) {
			assert.throws(() => new JoplinServer(url));
		}
		assert.equal(new JoplinServer('https://example.org/joplin/').baseUrl, 'https://example.org/joplin');
		for (const url of ['http://127.0.0.1:22300', 'http://192.168.1.20:22300', 'http://10.0.0.20:22300', 'http://joplin.local:22300', 'http://[fd00::1]:22300', 'http://example.org']) {
			assert.equal(new JoplinServer(`${url}/joplin/`).baseUrl, `${url}/joplin`);
		}
	});

	test('restores the saved account and catalog after restart and refreshes it explicitly', async () => {
		const connection = { baseUrl: 'https://example.org', sessionId: 'session' };
		let cached = { serverConnection: connection };
		let loads = 0;
		const createStorage = () => ({
			get: async () => cached,
			set: async value => { cached = { ...cached, ...value }; },
			remove: async key => { delete cached[key]; },
		});
		const storage = createStorage();
		const createServer = () => {
			const server = new JoplinServer('https://example.org', 'session');
			server.notebooksAndTags = async () => ({ folders: [{ id: `${++loads}` }], tags: [] });
			return server;
		};
		assert.equal((await loadServerCatalog(createServer(), storage)).folders[0].id, '1');
		assert.equal((await loadServerCatalog(createServer(), storage)).folders[0].id, '1');
		assert.equal(loads, 1);
		assert.equal((await loadServerCatalog(createServer(), storage, true)).folders[0].id, '2');
		assert.equal((await loadServerCatalog(createServer(), storage)).folders[0].id, '2');
		const persisted = JSON.stringify(cached);
		cached = JSON.parse(persisted);
		assert.equal((await loadServerCatalog(createServer(), createStorage())).folders[0].id, '2');
		assert.equal(loads, 2);
		assert.deepEqual(cached.serverConnection, connection);
		await storage.remove('serverCatalog');
		assert.equal((await loadServerCatalog(createServer(), storage)).folders[0].id, '3');
	});

	test('never reuses another server or session catalog and falls back when storage is unavailable', async () => {
		const server = new JoplinServer('https://example.org', 'session');
		let loads = 0;
		server.notebooksAndTags = async () => { loads++; return { folders: [], tags: [] }; };
		for (const cached of [
			{ baseUrl: 'https://other.example.org', sessionId: 'session' },
			{ baseUrl: server.baseUrl, sessionId: 'other-session' },
			{ baseUrl: server.baseUrl, sessionId: 'session', folders: null },
		]) {
			const storage = { get: async () => ({ serverCatalog: { folders: [{ id: 'foreign' }], tags: [], ...cached } }), set: async () => {} };
			assert.deepEqual(await loadServerCatalog(server, storage), { folders: [], tags: [] });
		}
		assert.equal(loads, 3);
		const unavailable = { get: async () => { throw new Error('Unavailable'); }, set: async () => { throw new Error('Unavailable'); } };
		assert.deepEqual(await loadServerCatalog(server, unavailable), { folders: [], tags: [] });
		assert.deepEqual(await loadServerCatalog(server), { folders: [], tags: [] });
		assert.equal(loads, 5);
	});

	test('invalidates a forced refresh before propagating discovery failures', async () => {
		const server = new JoplinServer('https://example.org', 'session');
		let cached = { serverCatalog: { baseUrl: server.baseUrl, sessionId: server.sessionId, folders: [], tags: [] } };
		const storage = { get: async () => cached, remove: async () => { cached = {}; } };
		server.notebooksAndTags = async () => { throw new Error('Session expired'); };
		await assert.rejects(loadServerCatalog(server, storage, true), /Session expired/);
		assert.deepEqual(cached, {});
		await assert.rejects(loadServerCatalog(server, storage), /Session expired/);
	});

	test('authenticates to an HTTP server with JSON and uses the session header', async () => {
		const server = new JoplinServer('http://192.168.1.20:22300/joplin');
		let requestCount = 0;
		globalThis.fetch = async (url, options) => {
			requestCount++;
			assert.equal(options.redirect, 'error');
			if (requestCount === 1) {
				assert.equal(url, 'http://192.168.1.20:22300/joplin/api/sessions');
				assert.deepEqual(JSON.parse(options.body), { email: 'user@example.org', password: 'test-password' });
				return new Response(JSON.stringify({ id: 'test-session' }));
			}
			assert.equal(options.headers['X-API-AUTH'], 'test-session');
			assert.ok(!url.includes('test-session'));
			return new Response(JSON.stringify({ items: [], has_more: false }));
		};
		await server.signIn('user@example.org', 'test-password');
		assert.deepEqual(await server.items(), []);
	});

	test('paginates and discovers notebooks from serialized metadata', async () => {
		const server = new JoplinServer('https://example.org');
		const requests = [];
		globalThis.fetch = async url => {
			requests.push(url);
			if (url.endsWith('page=1')) return new Response(JSON.stringify({ items: [{ name: `${folderId}.md` }], has_more: true }));
			if (url.endsWith('page=2')) return new Response(JSON.stringify({ items: [{ name: '.resource/blob' }], has_more: false }));
			assert.ok(decodeURIComponent(url).endsWith(`/root:/${folderId}.md:/content`));
			return new Response(`Notebook\n\nid: ${folderId}\nparent_id: \nencryption_applied: 0\ntype_: 2`);
		};
		const { folders } = await server.notebooksAndTags();
		assert.equal(folders[0].title, 'Notebook');
		assert.equal(folders[0].id, folderId);
		assert.equal(requests.length, 3);
	});

	test('rejects encrypted accounts and excludes shared notebook descendants', async () => {
		const server = new JoplinServer('https://example.org');
		server.items = async () => [{ name: `${folderId}.md` }];
		for (const metadata of ['encryption_applied: 1\ntype_: 2', 'encryption_applied: 0\ntype_: 9']) {
			globalThis.fetch = async () => new Response(`Encrypted\n\nid: ${folderId}\n${metadata}`);
			await assert.rejects(server.notebooksAndTags(), /encrypted/);
		}
		globalThis.fetch = async () => new Response('JEDencrypted-content');
		await assert.rejects(server.notebooksAndTags(), /encrypted/);
		server.items = async () => [{ name: `${folderId}.md` }, { name: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.md' }];
		server.loadItem = async name => name.startsWith(folderId) ? { id: folderId, title: 'Shared', type_: '2', share_id: 'share' } : { id: 'child', title: 'Child', type_: '2', parent_id: folderId };
		assert.deepEqual((await server.notebooksAndTags()).folders, []);
	});

	test('checks encryption in sync info before creating any items', async () => {
		const server = new JoplinServer('https://example.org');
		server.items = async () => [{ name: 'info.json' }];
		for (const info of [{ e2ee: { value: true } }, { masterKeys: [{ id: 'key' }] }, { activeMasterKeyId: { value: 'key' } }]) {
			globalThis.fetch = async (url, options) => {
				assert.ok(decodeURIComponent(url).endsWith('/root:/info.json:/content'));
				assert.ok(!options.method);
				return new Response(JSON.stringify({ version: 3, ...info }));
			};
			await assert.rejects(server.notebooksAndTags(), /encrypted/);
		}
		globalThis.fetch = async () => new Response(JSON.stringify({ version: 3, e2ee: { value: false }, masterKeys: [] }));
		assert.deepEqual(await server.notebooksAndTags(), { folders: [], tags: [] });
	});

	test('uploads valid sync notes, including empty titles and escaped metadata', async () => {
		const server = new JoplinServer('https://example.org', 'session');
		const bodies = [];
		globalThis.fetch = async (url, options) => {
			assert.match(decodeURIComponent(url), /\/root:\/[a-f0-9]{32}\.md:\/content$/);
			assert.equal(options.method, 'PUT');
			assert.equal(options.headers['X-API-AUTH'], 'session');
			assert.ok(!options.headers['Content-Type']);
			bodies.push(await options.body.get('file').text());
			return new Response('{}');
		};
		for (const title of ['Title', '']) {
			const result = await server.saveItem(1, { title, parent_id: folderId, source_url: 'https://example.org/\npath' }, 'Body\n\nSecond paragraph');
			assert.match(result.id, /^[a-f0-9]{32}$/);
		}
		assert.ok(bodies[0].startsWith('Title\n\nBody\n\nSecond paragraph\n\n'));
		assert.ok(bodies[1].startsWith('\n\nBody\n\nSecond paragraph\n\n'));
		assert.ok(bodies[0].includes('source_url: https://example.org/\\npath'));
		assert.match(bodies[0], /created_time: \d{4}-\d\d-\d\dT/);
		assert.match(bodies[0], /type_: 1$/);
	});

	test('creates tag associations without duplicating existing tags', async () => {
		const server = new JoplinServer('https://example.org');
		server.notebooksAndTags = async () => ({ folders: [{ id: folderId }] });
		const saved = [];
		server.saveItem = async (type, properties, body) => {
			saved.push({ type, properties, body });
			return { id: `item-${saved.length}` };
		};
		await server.saveNote({ title: 'Note', parent_id: folderId, tags: 'Existing, new, NEW' }, 'Body', 1, [{ id: 'existing', title: 'existing' }]);
		assert.deepEqual(saved.map(item => item.type), [1, 6, 5, 6]);
		assert.equal(saved[1].properties.tag_id, 'existing');
		await assert.rejects(server.saveNote({ parent_id: 'missing' }, '', 1, []), /Select an available/);
	});

	test('uploads resources as a blob and a resource metadata item', async () => {
		const server = new JoplinServer('https://example.org');
		const requests = [];
		globalThis.fetch = async (url, options) => {
			requests.push({ path: decodeURIComponent(url), file: options.body.get('file') });
			return new Response('{}');
		};
		const id = await server.saveResource(new Blob(['image'], { type: 'image/png' }), 'Screenshot');
		assert.ok(requests[0].path.endsWith(`/root:/.resource/${id}:/content`));
		assert.equal(await requests[0].file.text(), 'image');
		assert.match(await requests[1].file.text(), /mime: image\/png/);
		assert.match(await requests[1].file.text(), /type_: 4$/);
	});

	test('surfaces server and reverse-proxy failures', async () => {
		const server = new JoplinServer('https://example.org');
		globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Session expired' }), { status: 403 });
		await assert.rejects(server.items(), /Session expired/);
		globalThis.fetch = async () => new Response('<html>Bad gateway</html>', { status: 502 });
		await assert.rejects(server.items(), /HTTP 502/);
	});

	test('background uploads rewrite resource references and reject encrypted accounts before uploading', async () => {
		let handler;
		globalThis.browser = {
			runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(listener) { handler = listener; } } },
			commands: { onCommand: { addListener() {} } },
			storage: { local: { get: async () => ({ serverConnection: { baseUrl: 'https://example.org', sessionId: 'session' } }) } },
		};
		await import('../service_worker.mjs');
		const uploads = [];
		let encrypted = false;
		globalThis.fetch = async (url, options) => {
			if (url === 'https://images.example.org/test.png') return new Response('image', { headers: { 'Content-Type': 'image/png' } });
			assert.equal(options.headers['X-API-AUTH'], 'session');
			if (url.includes('/children?')) return new Response(JSON.stringify({ items: [{ name: `${folderId}.md` }], has_more: false }));
			if (options.method === 'PUT') {
				uploads.push(await options.body.get('file').text());
				return new Response('{}');
			}
			return new Response(`Notebook\n\nid: ${folderId}\nencryption_applied: ${encrypted ? 1 : 0}\ntype_: 2`);
		};
		const command = {
			name: 'uploadServerClip',
			clip: { content: { title: 'Page', parent_id: folderId }, markupLanguage: 1, body: '![Image](placeholder)', resources: [{ url: 'https://images.example.org/test.png', placeholder: 'placeholder', title: 'Image' }] },
		};
		assert.match((await handler(command)).id, /^[a-f0-9]{32}$/);
		assert.equal(uploads.length, 3);
		assert.match(uploads[2], /!\[Image\]\(:\/[a-f0-9]{32}\)/);
		encrypted = true;
		assert.match((await handler(command)).error, /encrypted/);
		assert.equal(uploads.length, 3);
	});
});