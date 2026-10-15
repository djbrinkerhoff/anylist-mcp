// Stand-in for `ws` and `reconnecting-websocket`. anylist-js defines a WebSocket
// subclass at module load, so this must be a class, but the Worker always logs in
// with connectWebSocket=false and never constructs one.

class UnsupportedWebSocket {
	constructor() {
		throw new Error('AnyList realtime WebSockets are not supported in the Workers build');
	}
}

module.exports = UnsupportedWebSocket;
