import { createServer } from 'net';
import { inherits } from 'util';
import { EventEmitter as _EventEmitter } from 'events';
import FtpConnection from './FtpConnection';
import { LOG_LEVELS } from './Constants';

let EventEmitter = _EventEmitter;

// Use LOG for brevity.
let LOG = LOG_LEVELS;

class FtpServer {
	constructor(host, options) {
		let self = this;
		EventEmitter.call(self);
		self.host = host;
		self.options = options;
		if (!self.options.maxStatsAtOnce) {
			self.options.maxStatsAtOnce = 5;
		}
		if (!options.getInitialCwd) {
			throw new Error("'getInitialCwd' option of FtpServer must be set");
		}
		if (!options.getRoot) {
			throw new Error("'getRoot' option of FtpServer must be set");
		}
		self.getInitialCwd = options.getInitialCwd;
		self.getRoot = options.getRoot;
		self.getUsernameFromUid = options.getUsernameFromUid || function (uid, c) {
			c(null, 'ftp');
		};
		self.getGroupFromGid = options.getGroupFromGid || function (gid, c) {
			c(null, 'ftp');
		};
		self.debugging = options.logLevel || 0;
		self.useWriteFile = options.useWriteFile;
		self.useReadFile = options.useReadFile;
		self.uploadMaxSlurpSize = options.uploadMaxSlurpSize || 0;
		self.server = createServer();
		self.server.on('connection', function (socket) {
			self._onConnection(socket);
		});
		self.server.on('error', function (err) {
			self.emit('error', err);
		});
		self.server.on('close', function () {
			self.emit('close');
		});
	}
	_onConnection(socket) {
		// build an index for the allowable commands for this server
		let allowedCommands = null;
		if (this.options.allowedCommands) {
			allowedCommands = {};
			this.options.allowedCommands.forEach(function (c) {
				allowedCommands[c.trim().toUpperCase()] = true;
			});
		}
		let conn = new FtpConnection({
			server: this,
			socket: socket,
			pasv: null,
			allowedCommands: allowedCommands,
			dataPort: 20,
			dataHost: null,
			dataListener: null,
			dataSocket: null,
			// True if the client has sent a PORT/PASV command, and
			// we haven't experienced a problem with the configuration
			// it specified. (This can therefore be true even if there
			// is not currently an open data connection.)
			dataConfigured: false,
			mode: 'ascii',
			filefrom: '',
			username: null,
			filename: '',
			fs: null,
			cwd: null,
			root: null,
			hasQuit: false,
			// State for handling TLS upgrades.
			secure: false,
			pbszReceived: false,
		});
		this.emit('client:connected', conn); // pass client info so they can listen for client-specific events
		socket.setTimeout(0);
		socket.setNoDelay();
		this._logIf(LOG.INFO, 'Accepted a new client connection');
		conn.respond('220 FTP server (nodeftpd) ready');
		socket.on('data', function (buf) {
			conn._onData(buf);
		});
		socket.on('end', function () {
			conn._onEnd();
		});
		socket.on('error', function (err) {
			conn._onError(err);
		});
		// `close` will always be called once (directly after `end` or `error`)
		socket.on('close', function (hadError) {
			conn._onClose(hadError);
		});
	}
	_logIf(verbosity, message, conn) {
		if (verbosity > this.debugging) {
			return;
		}
		// TODO: Move this to FtpConnection.prototype._logIf.
		var peerAddr = (conn && conn.socket && conn.socket.remoteAddress);
		if (peerAddr) {
			message = '<' + peerAddr + '> ' + message;
		}
		if (verbosity === LOG.ERROR) {
			message = 'ERROR: ' + message;
		}
		else if (verbosity === LOG.WARN) {
			message = 'WARNING: ' + message;
		}
		console.log(message);
		var isError = (verbosity === LOG.ERROR);
		if (isError && this.debugging === LOG.TRACE) {
			console.trace('Trace follows');
		}
	}
}
inherits(FtpServer, EventEmitter);

['listen', 'close'].forEach(function(fname) {
	FtpServer.prototype[fname] = function() {
		return this.server[fname].apply(this.server, arguments);
	};
});

export default FtpServer;