var util = require('util');
var tls = tls = require('tls');
var net = require('net');
var parse = require('url').parse;
var defs = require('./defs');
var EventEmitter = require('events').EventEmitter;

import { PDU } from './pdu';

//export var PDU = require('./pdu').PDU;

class Options{
    host:string;
    hostname:string;
    tls:boolean;
    protocol:string;
    slashes:boolean;
    port:number;
    socket;
    auto_enquire_link_period:number;
    command;
    id;
    tag;
    key;
    cert;
}


export class Session extends EventEmitter {
    
    options:Options;
    sequence:number;
    paused: boolean;
    _busy: boolean;
    _callbacks;
    _interval;
    socket;

    constructor(o:Options){
        super();
        EventEmitter.call(this);
        var self=this;
        this.options = o;
        var transport = net;
        this.sequence = 0;
        this.paused = false;
        this._busy = false;
        this._callbacks = [];
        this._interval = 0;

        if (this.options.socket) {
            this.socket = this.options.socket;
        }else{
            if (this.options.tls) {
                transport = tls;
            }
            this.socket = transport.connect(this.options);
            this.socket.on('connect', function() {
                self.emit('connect');
                if(self.options.auto_enquire_link_period!=null) {
                    self._interval = setInterval(function() {
                        self.enquire_link();
                    }, self.options.auto_enquire_link_period);
                }
            });
            this.socket.on('secureConnect', function() {
                self.emit('secureConnect');
            });
        }

        this.socket.on('readable', this._extractPDUs.bind(this));
	    this.socket.on('close', function() {
		self.emit('close');
		if(self._interval) {
			clearInterval(self._interval);
			self._interval = 0;
		}
	    });
	    this.socket.on('error', function(e) {
		self.emit('error', e);
		if(self._interval) {
			clearInterval(self._interval);
			self._interval = 0;
		}
	});
    };


    ////FUNCTIONS:

    _extractPDUs = ():void => {
        if (this._busy) {
            return;
        }
        this._busy = true;
        var pdu;
        while (!this.paused) {
            try {
                if (!(pdu = PDU.fromStream(this.socket))) {
                    break;
                }
            } catch (e) {
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

    connect = ():void => {
        this.sequence = 0;
        this.paused = false;
        this._busy = false;
        this._callbacks = [];
        this.socket.connect(this.options);
    };
    
    send = (pdu, responseCallback, sendCallback):boolean => {
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
        } else if (responseCallback && !sendCallback) {
            sendCallback = responseCallback;
        }
        this.socket.write(pdu.toBuffer(), function() {
            this.emit('send', pdu);
            if (sendCallback) {
                sendCallback(pdu);
            }
        }.bind(this));
        return true;
    };
    
    pause = ():void => {
        this.paused = true;
    };
    
    resume = ():void =>  {
        this.paused = false;
        this._extractPDUs();
    };
    
    close = (callback):void => {
        if (callback) {
            this.socket.once('close', callback);
        }
        this.socket.end();
    };
    
    destroy = (callback):void => {
        if (callback) {
            this.socket.once('close', callback);
        }
        this.socket.destroy();
    };
    
}

const createShortcut = (command) => {
	return function(options, responseCallback, sendCallback) {
		if (typeof options == 'function') {
			sendCallback = responseCallback;
			responseCallback = options;
			options = {};
		}
		var pdu:PDU = new PDU(command, options);
		return this.send(pdu, responseCallback, sendCallback);
	};
};

for (var command in defs.commands) {
	Session.prototype[command] = createShortcut(command);
}

export var connect=(url: string, listener?):Session => {
    let options = new Options();
    if(typeof url == 'string')
    {
        options = parse(url);
		options.host = options.slashes ? options.hostname : url;
		options.tls = options.protocol == 'ssmpp:';
    }else if (typeof url == 'function'){
		listener = url;
    }else{
        options=url
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
}

export var addCommand = (command, options:Options):void => {
	options.command = command;
	defs.commands[command] = options;
	defs.commandsById[options.id] = options;
	Session.prototype[command] = createShortcut(command);
};

export var addTLV = (tag, options:Options):void => {
	options.tag = tag;
	defs.tlvs[tag] = options;
	defs.tlvsById[options.id] = options;
};

/// Server

class Server extends net.Server{
    self:Server;
    sessions:Session[];
    options:Options;
    listener;
    tls:boolean;
    constructor(o:Options,listener?){
        super();
        let self=this;
        this.sessions=[];

        if (typeof o == 'function') {
            this.listener = o;
            var tempOption=new Options;
            this.options = tempOption;
        } else {
            this.options = o;
        }
       
        if(listener){
            this.on('session', listener);
        }

        this.tls = !(typeof this.options.key=="undefined") && !(typeof this.options.cert=="undefined");
        let transport = this.tls ? tls : net;
        
        transport.Server.call(this,this.options, function(socket) {
            var tempOption=new Options;
            tempOption.socket=socket;
            var session = new Session(tempOption);
            session.server = self;
            self.sessions.push(session);
            socket.on('close', function() {
                self.sessions.splice(self.sessions.indexOf(session), 1);
            });
            self.emit('session', session);
        });


    }

    //Function
    listen = (...argumentss) => {
        var args = [this.tls ? 3550 : 2775];
        if (typeof argumentss[0] == 'function') {
            args[1] = argumentss[0];
        } else if (argumentss.length > 0) {
            args = argumentss;
        }
        var transport = this.tls ? tls : net;
        return transport.Server.prototype.listen.apply(this, args);
    };



}



export var createServer=(o:Options,listener?):Server=>{
    var options:Options;
    var listener;
    if(typeof o=='function'){
        listener = o;
        var tempOptions=new Options();
		options = tempOptions;
    }else{
        options=o;
    }

    /*if (options.key && options.cert) {
		return new SecureServer(options, listener);
	}*/
    
    return new Server(options,listener);
}


for (var key in defs) {
	exports[key] = defs[key];
}
for (var error in defs.errors) {
	exports[error] = defs.errors[error];
}
for (var key in defs.consts) {
	exports[key] = defs.consts[key];
}
