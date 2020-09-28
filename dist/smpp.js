"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = exports.addTLV = exports.addCommand = exports.connect = exports.Session = void 0;
var util = require('util');
var tls = tls = require('tls');
var net = require('net');
var parse = require('url').parse;
var defs = require('./defs');
var EventEmitter = require('events').EventEmitter;
const pdu_1 = require("./pdu");
//export var PDU = require('./pdu').PDU;
class Options {
}
class Session extends EventEmitter {
    constructor(o) {
        super();
        ////FUNCTIONS:
        this._extractPDUs = () => {
            if (this._busy) {
                return;
            }
            this._busy = true;
            var pdu;
            while (!this.paused) {
                try {
                    if (!(pdu = pdu_1.PDU.fromStream(this.socket))) {
                        break;
                    }
                }
                catch (e) {
                    this.emit('error', e);
                    return;
                }
                this.emit('pdu', pdu);
                this.emit(pdu.command, pdu);
                if (pdu.isResponse() && this._callbacks[pdu.sequence_number]) {
                    this._callbacks[pdu.sequence_number](pdu);
                    delete this._callbacks[pdu.sequence_number];
                }
            }
            this._busy = false;
        };
        this.connect = () => {
            this.sequence = 0;
            this.paused = false;
            this._busy = false;
            this._callbacks = [];
            this.socket.connect(this.options);
        };
        this.send = (pdu, responseCallback, sendCallback) => {
            if (!this.socket.writable) {
                return false;
            }
            if (!pdu.isResponse()) {
                // when server/session pair is used to proxy smpp
                // traffic, the sequence_number will be provided by
                // client otherwise we generate it automatically
                if (!pdu.sequence_number) {
                    if (this.sequence == 0x7FFFFFFF) {
                        this.sequence = 0;
                    }
                    pdu.sequence_number = ++this.sequence;
                }
                if (responseCallback) {
                    this._callbacks[pdu.sequence_number] = responseCallback;
                }
            }
            else if (responseCallback && !sendCallback) {
                sendCallback = responseCallback;
            }
            this.socket.write(pdu.toBuffer(), function () {
                this.emit('send', pdu);
                if (sendCallback) {
                    sendCallback(pdu);
                }
            }.bind(this));
            return true;
        };
        this.pause = () => {
            this.paused = true;
        };
        this.resume = () => {
            this.paused = false;
            this._extractPDUs();
        };
        this.close = (callback) => {
            if (callback) {
                this.socket.once('close', callback);
            }
            this.socket.end();
        };
        this.destroy = (callback) => {
            if (callback) {
                this.socket.once('close', callback);
            }
            this.socket.destroy();
        };
        EventEmitter.call(this);
        var self = this;
        this.options = o;
        var transport = net;
        this.sequence = 0;
        this.paused = false;
        this._busy = false;
        this._callbacks = [];
        this._interval = 0;
        if (this.options.socket) {
            this.socket = this.options.socket;
        }
        else {
            if (this.options.tls) {
                transport = tls;
            }
            this.socket = transport.connect(this.options);
            this.socket.on('connect', function () {
                self.emit('connect');
                if (self.options.auto_enquire_link_period != null) {
                    self._interval = setInterval(function () {
                        self.enquire_link();
                    }, self.options.auto_enquire_link_period);
                }
            });
            this.socket.on('secureConnect', function () {
                self.emit('secureConnect');
            });
        }
        this.socket.on('readable', this._extractPDUs.bind(this));
        this.socket.on('close', function () {
            self.emit('close');
            if (self._interval) {
                clearInterval(self._interval);
                self._interval = 0;
            }
        });
        this.socket.on('error', function (e) {
            self.emit('error', e);
            if (self._interval) {
                clearInterval(self._interval);
                self._interval = 0;
            }
        });
    }
    ;
}
exports.Session = Session;
const createShortcut = (command) => {
    return function (options, responseCallback, sendCallback) {
        if (typeof options == 'function') {
            sendCallback = responseCallback;
            responseCallback = options;
            options = {};
        }
        var pdu = new pdu_1.PDU(command, options);
        return this.send(pdu, responseCallback, sendCallback);
    };
};
for (var command in defs.commands) {
    Session.prototype[command] = createShortcut(command);
}
exports.connect = (url, listener) => {
    let options = new Options();
    if (typeof url == 'string') {
        options = parse(url);
        options.host = options.slashes ? options.hostname : url;
        options.tls = options.protocol == 'ssmpp:';
    }
    else if (typeof url == 'function') {
        listener = url;
    }
    else {
        options = url;
        /*
        if (options.url) {
            url = parse(options.url);
            options.host = url.hostname;
            options.port = url.port;
            options.tls = url.protocol == 'ssmpp:';
        }
        */
    }
    options.port = options.port || (options.tls ? 3550 : 2775);
    const session = new Session(options);
    if (listener) {
        session.on(options.tls ? 'secureConnect' : 'connect', listener);
    }
    return session;
};
exports.addCommand = (command, options) => {
    options.command = command;
    defs.commands[command] = options;
    defs.commandsById[options.id] = options;
    Session.prototype[command] = createShortcut(command);
};
exports.addTLV = (tag, options) => {
    options.tag = tag;
    defs.tlvs[tag] = options;
    defs.tlvsById[options.id] = options;
};
/// Server
class Server extends net.Server {
    constructor(o, listener) {
        super();
        //Function
        this.listen = (...argumentss) => {
            var args = [this.tls ? 3550 : 2775];
            if (typeof argumentss[0] == 'function') {
                args[1] = argumentss[0];
            }
            else if (argumentss.length > 0) {
                args = argumentss;
            }
            var transport = this.tls ? tls : net;
            return transport.Server.prototype.listen.apply(this, args);
        };
        let self = this;
        this.sessions = [];
        if (typeof o == 'function') {
            this.listener = o;
            var tempOption = new Options;
            this.options = tempOption;
        }
        else {
            this.options = o;
        }
        if (listener) {
            this.on('session', listener);
        }
        this.tls = !(typeof this.options.key == "undefined") && !(typeof this.options.cert == "undefined");
        let transport = this.tls ? tls : net;
        transport.Server.call(this, this.options, function (socket) {
            var tempOption = new Options;
            tempOption.socket = socket;
            var session = new Session(tempOption);
            session.server = self;
            self.sessions.push(session);
            socket.on('close', function () {
                self.sessions.splice(self.sessions.indexOf(session), 1);
            });
            self.emit('session', session);
        });
    }
}
exports.createServer = (o, listener) => {
    var options;
    var listener;
    if (typeof o == 'function') {
        listener = o;
        var tempOptions = new Options();
        options = tempOptions;
    }
    else {
        options = o;
    }
    /*if (options.key && options.cert) {
        return new SecureServer(options, listener);
    }*/
    return new Server(options, listener);
};
for (var key in defs) {
    exports[key] = defs[key];
}
for (var error in defs.errors) {
    exports[error] = defs.errors[error];
}
for (var key in defs.consts) {
    exports[key] = defs.consts[key];
}
