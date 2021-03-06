import * as browser from "webextension-polyfill";
import * as socket_io from "socket.io-client";
import * as url from "url";

import * as defaults from "../lib/defaults.json";
import {
	Storage,
	MessageType
} from "../lib/types";

const SUFFIX: string = " - YouTube";

let port: number;
let poll_interval: number;
let space: number;

let socket: SocketIOClient.Socket;
let timeout: number;

let last_poll: number;
let playing: boolean;
let song: string;

function send_connected() {
	browser.runtime.sendMessage({
		type: MessageType.Connected,
		payload: socket && socket.connected
	});
}

function send_playing() {
	if (playing) {
		browser.runtime.sendMessage({
			type: MessageType.Playing,
			payload: song
		});
	} else {
		browser.runtime.sendMessage({ type: MessageType.NotPlaying });
	}
}

function emit_playing() {
	if (playing) {
		socket.emit("playing", song);
	} else {
		socket.emit("not_playing");
	}
}

function update_disconnect() {
	browser.browserAction.setIcon({
		path: {
			64: "img/disconnected.png"
		}
	});
	browser.browserAction.setTitle({
		title: "Disconnected"
	});

	send_connected();
}

async function poll() {
	for (const window of await browser.windows.getAll({ populate: true })) {
		for (const tab of window.tabs) {
			if (
				tab.audible &&
				url.parse(tab.url).host == "www.youtube.com" &&
				tab.title.endsWith(SUFFIX)
			) {
				const current_song: string = tab.title.substring(0, tab.title.length - SUFFIX.length);

				if (!playing || song != current_song) {
					playing = true;
					song = current_song;

					console.log("Now playing: " + song);

					emit_playing();
					send_playing();
				}

				return;
			}
		}
	}

	if (playing) {
		playing = false;

		console.log("Not playing");

		emit_playing();
		send_playing();
	}
}

function polling_loop() {
	const now: number = Date.now();
	const since: number = now - last_poll;

	if (since >= poll_interval) {
		poll();

		const since: number = Date.now() - last_poll;

		timeout = setTimeout(polling_loop, Math.max(0, poll_interval * 2 - since));
		last_poll = now;
	} else {
		const d: number = poll_interval - since;
		timeout = setTimeout(polling_loop, d);
	}
}

function socket_listeners(socket: SocketIOClient.Socket) {
	socket.on("connect", () => {
		console.log("Connected to local server");

		browser.browserAction.setIcon({
			path: {
				64: "img/connected.png"
			}
		});
		browser.browserAction.setTitle({
			title: "Connected"
		});

		emit_playing();
		send_connected();
	});

	socket.on("disconnect", () => {
		console.log("Disconnected from local server");
		update_disconnect();
	});
}

async function restart() {
	const storage: Storage = <Storage>await browser.storage.local.get();

	port = storage.port || defaults.port;
	poll_interval = storage.poll_interval || defaults.poll_interval;
	space = storage.space || defaults.space;

	if (socket) {
		socket.removeAllListeners();
		socket.close();
	}

	socket = socket_io("http://localhost:" + port);
	clearTimeout(timeout);
	
	last_poll = 0;
	playing = false;
	song = "";
	
	polling_loop();
	update_disconnect();
	socket_listeners(socket);
}

restart();

// Restart when settings change
browser.storage.onChanged.addListener((changes, area_name) => {
	if (area_name == "local") {
		restart();
	}
});

browser.runtime.onMessage.addListener((message) => {
	switch (message.type) {
		case MessageType.Open:
			send_connected();
			send_playing();
			break;
	}
});