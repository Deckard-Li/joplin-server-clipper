import joplinEnv from './util/joplinEnv.mjs';
import getActiveTabs from './util/getActiveTabs.mjs';
import JoplinServer from './util/JoplinServer.mjs';

let browser_ = null;
if (typeof browser !== 'undefined') {
	browser_ = browser;
} else if (typeof chrome !== 'undefined') {
	browser_ = chrome;
}

async function browserCaptureVisibleTabs(windowId) {
	const options = {
		format: 'jpeg',

		// This is supposed to be the default quality, but in fact Firefox 82+
		// clearly uses a much lower quality, closer to 20 or 30, so we have to
		// set it here explicitly.
		// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/extensionTypes/ImageDetails
		// https://discourse.joplinapp.org/t/clip-screenshot-image-quality/12302/4
		quality: 92,
	};
	return browser_.tabs.captureVisibleTab(windowId, options);
}

browser_.runtime.onInstalled.addListener(() => {
	if (joplinEnv() === 'dev') {
		browser_.action.setIcon({
			path: 'icons/32-dev.png',
		});
	}
});

browser_.runtime.onMessage.addListener(async (command) => {
	if (command.name === 'uploadServerClip') {
		try {
			const { serverConnection } = await browser_.storage.local.get('serverConnection');
			if (!serverConnection) throw new Error('Sign in to Joplin Server before clipping.');
			const server = new JoplinServer(serverConnection.baseUrl, serverConnection.sessionId);
			const { folders, tags } = await server.notebooksAndTags();
			const { content, markupLanguage, resources } = command.clip;
			if (!folders.some(folder => folder.id === content.parent_id)) throw new Error('Select an available, unencrypted notebook before clipping.');
			let body = command.clip.body;
			for (const resource of resources) {
				const response = await fetch(resource.url, { credentials: 'omit', signal: AbortSignal.timeout(30000) });
				if (!response.ok) throw new Error(`Could not download a clipped resource: HTTP ${response.status}`);
				const id = await server.saveResource(await response.blob(), resource.title);
				body = body.split(resource.placeholder).join(`:/${id}`);
			}
			return await server.saveNote(content, body, markupLanguage, tags);
		} catch (error) {
			return { error: error.message };
		}
	}
	if (command.name === 'screenshotArea') {
		// The dimensions of the image returned by Firefox are the regular ones,
		// while the one returned by Chrome depend on the screen pixel ratio. So
		// it would return a 600*400 image if the window dimensions are 300x200
		// and the screen pixel ratio is 2.
		//
		// Normally we could rely on window.devicePixelRatio to tell us that but
		// since Firefox and Chrome handle this differently, we need to
		// calculate the ratio ourselves. It's simply the image dimensions
		// divided by the window inner width.
		//
		// The crop rectangle is always in real pixels, so we need to multiply
		// it by the ratio we've calculated.
		//
		// 8/3/2024: With manifest v3, we don't have access to DOM APIs in Chrome.
		// As a result, we can't easily calculate the size of the captured image.
		// We instead base the crop region exclusively on window.devicePixelRatio,
		// which seems to work in modern Firefox and Chrome.
		const imageDataUrl = await browserCaptureVisibleTabs(null);

		const content = { ...command.content };
		content.image_data_url = imageDataUrl;
		if ('url' in content) content.source_url = content.url;

		const ratio = content.devicePixelRatio;
		const newArea = { ...command.content.crop_rect };
		newArea.x *= ratio;
		newArea.y *= ratio;
		newArea.width *= ratio;
		newArea.height *= ratio;
		content.crop_rect = newArea;
		if (command.server_connection) {
			try {
				const { serverConnection } = await browser_.storage.local.get('serverConnection');
				if (!serverConnection) throw new Error('Sign in to Joplin Server before clipping.');
				const server = new JoplinServer(serverConnection.baseUrl, serverConnection.sessionId);
				const { folders, tags } = await server.notebooksAndTags();
				if (!folders.some(folder => folder.id === content.parent_id)) throw new Error('Select an available, unencrypted notebook before clipping.');
				const bitmap = await createImageBitmap(await (await fetch(imageDataUrl)).blob());
				const canvas = new OffscreenCanvas(Math.max(1, Math.round(newArea.width)), Math.max(1, Math.round(newArea.height)));
				canvas.getContext('2d').drawImage(bitmap, newArea.x, newArea.y, newArea.width, newArea.height, 0, 0, canvas.width, canvas.height);
				bitmap.close();
				const id = await server.saveResource(await canvas.convertToBlob({ type: 'image/png' }), 'Screenshot');
				await server.saveNote(content, `![Screenshot](:/${id})`, 1, tags);
				await browser_.storage.local.set({ serverClipResult: { success: true } });
			} catch (error) {
				await browser_.storage.local.set({ serverClipResult: { error: error.message } });
			}
			return;
		}

		fetch(`${command.api_base_url}/notes?token=${encodeURIComponent(command.token)}`, {
			method: 'POST',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify(content),
		});
	}
});

async function sendClipMessage(clipType) {
	const tabs = await getActiveTabs(browser_);
	if (!tabs || !tabs.length) {
		console.error('No active tabs');
		return;
	}
	const tabId = tabs[0].id;
	// send a message to the content script on the active tab (assuming it's there)
	const message = {
		shouldSendToJoplin: true,
	};
	switch (clipType) {
	case 'clipCompletePage':
		message.name = 'completePageHtml';
		message.preProcessFor = 'markdown';
		break;
	case 'clipCompletePageHtml':
		message.name = 'completePageHtml';
		message.preProcessFor = 'html';
		break;
	case 'clipSimplifiedPage':
		message.name = 'simplifiedPageHtml';
		break;
	case 'clipUrl':
		message.name = 'pageUrl';
		break;
	case 'clipSelection':
		message.name = 'selectedHtml';
		break;
	default:
		break;
	}
	if (message.name) {
		browser_.tabs.sendMessage(tabId, message);
	}
}

browser_.commands.onCommand.addListener((command) => {
	// We could enumerate these twice, but since we're in here first,
	// why not save ourselves the trouble with this convention
	if (command.startsWith('clip')) {
		sendClipMessage(command);
	}
});
