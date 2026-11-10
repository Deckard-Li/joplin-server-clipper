export async function loadServerCatalog(server, sessionStorage, refresh = false) {
	if (sessionStorage) {
		try {
			if (refresh) await sessionStorage.remove('serverCatalog');
			else {
				const { serverCatalog } = await sessionStorage.get('serverCatalog');
				if (serverCatalog?.baseUrl === server.baseUrl && serverCatalog.sessionId === server.sessionId && Array.isArray(serverCatalog.folders) && Array.isArray(serverCatalog.tags)) return { folders: serverCatalog.folders, tags: serverCatalog.tags };
			}
		} catch {}
	}
	const catalog = await server.notebooksAndTags();
	if (sessionStorage) {
		try { await sessionStorage.set({ serverCatalog: { ...catalog, baseUrl: server.baseUrl, sessionId: server.sessionId } }); } catch {}
	}
	return catalog;
}

export default class JoplinServer {
	constructor(baseUrl, sessionId = '') {
		const url = new URL(baseUrl);
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Enter an HTTP or HTTPS server URL without credentials, query, or fragment.');
		this.baseUrl = url.href.replace(/\/$/, '');
		this.sessionId = sessionId;
	}

	async request(path, options = {}, asText = false) {
		const response = await fetch(`${this.baseUrl}/api/${path}`, {
			...options,
			redirect: 'error',
			headers: { ...options.headers, 'X-API-AUTH': this.sessionId },
		});
		if (!response.ok) {
			let message = `Joplin Server returned HTTP ${response.status}`;
			try {
				const error = await response.json();
				message = error.error?.message || error.error || message;
			} catch (error) {
				// Reverse proxies may return HTML instead of a JSON error.
			}
			throw new Error(message);
		}
		return asText ? response.text() : response.json();
	}

	async signIn(email, password) {
		const session = await this.request('sessions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password }),
		});
		this.sessionId = session.id;
	}

	async items() {
		const items = [];
		for (let page = 1; ; page++) {
			const result = await this.request(`items/root/children?page=${page}`);
			items.push(...result.items);
			if (!result.has_more) return items;
		}
	}

	async loadItem(name) {
		const content = await this.request(`items/${encodeURIComponent(`root:/${name}:`)}/content`, {}, true);
		if (content.startsWith('JED')) throw new Error('Direct server clipping does not support end-to-end encrypted accounts. Use the desktop connection instead.');
		const separator = content.lastIndexOf('\n\n');
		const properties = {};
		for (const line of (separator < 0 ? content : content.slice(separator + 2)).split('\n')) {
			const colon = line.indexOf(': ');
			if (colon >= 0) properties[line.slice(0, colon)] = line.slice(colon + 2).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\n/g, '\\n').replace(/\\\r/g, '\\r');
		}
		properties.title = separator < 0 ? '' : content.split('\n')[0];
		return properties;
	}

	async notebooksAndTags() {
		const folders = [];
		const tags = [];
		const items = await this.items();
		if (items.some(item => item.name === 'info.json')) {
			const info = await this.request(`items/${encodeURIComponent('root:/info.json:')}/content`);
			if (info.e2ee?.value || info.activeMasterKeyId?.value || info.masterKeys?.length) throw new Error('Direct server clipping does not support end-to-end encrypted accounts. Use the desktop connection instead.');
			if (info.version !== 3) throw new Error('Direct server clipping requires sync format version 3.');
		}
		for (const item of items) {
			if (!/^[a-f0-9]{32}\.md$/.test(item.name)) continue;
			const properties = await this.loadItem(item.name);
			if (properties.encryption_applied === '1' || properties.type_ === '9') throw new Error('Direct server clipping does not support end-to-end encrypted accounts. Use the desktop connection instead.');
			if (!['2', '5'].includes(properties.type_)) continue;
			if (properties.type_ === '2') folders.push(properties);
			else if (!properties.share_id) tags.push(properties);
		}
		const sharedFolderIds = new Set();
		for (const folder of folders) {
			if (folder.share_id) sharedFolderIds.add(folder.id);
		}
		for (let pass = 0; pass < folders.length; pass++) {
			for (const folder of folders) {
				if (sharedFolderIds.has(folder.parent_id)) sharedFolderIds.add(folder.id);
			}
		}
		folders.sort((left, right) => left.title.localeCompare(right.title));
		tags.sort((left, right) => left.title.localeCompare(right.title));
		return { folders: folders.filter(folder => !sharedFolderIds.has(folder.id)), tags };
	}

	async saveNote(content, body, markupLanguage, tags) {
		const { folders } = await this.notebooksAndTags();
		if (!folders.some(folder => folder.id === content.parent_id)) throw new Error('Select an available, unencrypted notebook before clipping.');
		const note = await this.saveItem(1, {
			title: (content.title || '').replace(/[\r\n]/g, ' '),
			parent_id: content.parent_id,
			source_url: content.source_url || '',
			source: 'web.clip',
			markup_language: markupLanguage,
			is_todo: 0,
			is_conflict: 0,
		}, body);
		for (const title of [...new Set((content.tags || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean))]) {
			let tag = tags.find(item => item.title.toLowerCase() === title);
			if (!tag) {
				tag = { ...await this.saveItem(5, { title }), title };
				tags.push(tag);
			}
			await this.saveItem(6, { note_id: note.id, tag_id: tag.id });
		}
		return note;
	}

	async saveResource(blob, title) {
		if (blob.size > 20 * 1024 * 1024) throw new Error('Clipped resources must be smaller than 20 MB.');
		const id = crypto.randomUUID().replace(/-/g, '');
		const form = new FormData();
		form.append('file', blob, id);
		await this.request(`items/${encodeURIComponent(`root:/.resource/${id}:`)}/content`, { method: 'PUT', body: form });
		await this.saveItem(4, {
			id,
			title,
			mime: blob.type || 'application/octet-stream',
			size: blob.size,
			encryption_blob_encrypted: 0,
		});
		return id;
	}

	async saveItem(type, properties, body = '') {
		const id = properties.id || crypto.randomUUID().replace(/-/g, '');
		const timestamp = new Date().toISOString();
		const metadata = {
			id,
			created_time: timestamp,
			updated_time: timestamp,
			user_created_time: timestamp,
			user_updated_time: timestamp,
			encryption_applied: 0,
			...properties,
			type_: type,
		};
		const escape = value => String(value).replace(/\\n/g, '\\\\n').replace(/\\r/g, '\\\\r').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
		const fields = Object.entries(metadata).filter(([key]) => key !== 'title').map(([key, value]) => `${key}: ${escape(value)}`);
		const sections = [];
		if (properties.title !== undefined) sections.push(properties.title);
		if (body) sections.push(body);
		sections.push(fields.join('\n'));
		const content = sections.join('\n\n');
		const form = new FormData();
		form.append('file', new Blob([content], { type: 'text/plain' }), `${id}.md`);
		await this.request(`items/${encodeURIComponent(`root:/${id}.md:`)}/content`, { method: 'PUT', body: form });
		return { id };
	}
}