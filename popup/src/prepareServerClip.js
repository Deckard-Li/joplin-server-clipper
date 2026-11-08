import TurndownService from 'turndown';

export default function prepareServerClip(content) {
	const document = new DOMParser().parseFromString(content.body_html || '', 'text/html');
	for (const element of document.querySelectorAll('script, iframe, form, object, base, meta, link')) element.remove();
	const resources = [];
	const resourceUrls = new Map();
	for (const element of document.body.querySelectorAll('*')) {
		for (const attribute of [...element.attributes]) {
			if (attribute.name.startsWith('on') || ['srcset', 'action', 'formaction'].includes(attribute.name)) element.removeAttribute(attribute.name);
		}
		for (const attribute of ['href', 'src']) {
			const value = element.getAttribute(attribute);
			if (!value || value.startsWith('#')) continue;
			let url;
			try {
				url = new URL(value, content.base_url || content.source_url);
			} catch (error) {
				element.removeAttribute(attribute);
				continue;
			}
			if (!['http:', 'https:', 'mailto:'].includes(url.protocol) && !(attribute === 'src' && url.protocol === 'data:' && value.startsWith('data:image/'))) {
				element.removeAttribute(attribute);
				continue;
			}
			if (attribute === 'src' && ['IMG', 'EMBED'].includes(element.tagName)) {
				let placeholder = resourceUrls.get(url.href);
				if (!placeholder) {
					placeholder = `joplin-resource-${crypto.randomUUID()}`;
					resourceUrls.set(url.href, placeholder);
					resources.push({ url: url.href, placeholder, title: element.getAttribute('alt') || 'Clipped resource' });
				}
				element.setAttribute(attribute, placeholder);
			} else {
				element.setAttribute(attribute, url.href);
			}
		}
	}
	const markupLanguage = content.convert_to === 'html' ? 2 : 1;
	const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
	converter.addRule('embeddedResource', {
		filter: 'embed',
		replacement: (text, node) => `[Attachment](${node.getAttribute('src') || ''})`,
	});
	const body = markupLanguage === 2 ? document.body.innerHTML : converter.turndown(document.body);
	return { content, body, markupLanguage, resources };
}