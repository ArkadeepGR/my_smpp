var defs = require('./defs');
var commands = defs.commands;
var commandsById = defs.commandsById;
var tlvs = defs.tlvs;
var tlvsById = defs.tlvsById;
var Buff = require('safer-buffer').Buffer;

class Options{
    command_status:number;
    sequence_number:number;
}

let pduHeadParams = [
	'command_length',
	'command_id',
	'command_status',
	'sequence_number'
];


export class PDU{
    options:Options;
    command:string;
	command_length:number;
	command_id:number;
	command_status:number;
    sequence_number:number;
    static maxLength = 16384;
    short_message;
  
    
    constructor(command,o?:Options){
        if (Buff.isBuffer(command)) {
            return this.fromBuffer(command);
        }
        this.options=o;
        this.command = command;
        this.command_length = 0;
        this.command_id = commands[command].id;
        this.command_status = this.options.command_status || 0;
        this.sequence_number = this.options.sequence_number || 0;
        if (this.command_status) {
            return;
        }

        let params = commands[command].params || {};
        for (let key in params) {
            if (key in this.options) {
                this[key] = this.options[key];
            } else if ('default' in params[key]) {
                this[key] = params[key].default;
            } else {
                this[key] = params[key].type.default;
            }
        }
        for (let key in this.options) if (key in tlvs) {
            this[key] = this.options[key];
        }
    }

    //Functions:




    isResponse = ():boolean => {
        return !!(this.command_id & 0x80000000);
    };

    response = (o:Options) => {
        this.options = o;
        this.options.sequence_number = this.sequence_number;
        if (this.command == 'unknown') {
            if ('command_status'==undefined) {
                this.options.command_status = defs.errors.ESME_RINVCMDID;
            }
            return new PDU('generic_nack',this.options);
        }
        return new PDU(this.command + '_resp',this.options);
    };


    static fromStream = (stream):boolean|PDU => {
        let buffer = stream.read(4);
        if (!buffer) {
            return false;
        }
        let command_length:number = buffer.readUInt32BE(0);
        if (command_length > PDU.maxLength) {
            throw Error('PDU length was too large (' + command_length +
                ', maximum is ' + PDU.maxLength + ').');
        }
        stream.unshift(buffer);
        buffer = stream.read(command_length);
        if (!buffer) {
            return false;
        }
        return new PDU(buffer);
    };

    static fromBuffer = (buffer):boolean|PDU => {
        if (buffer.length < 16 || buffer.length < buffer.readUInt32BE(0)) {
            return false;
        }
        return new PDU(buffer);
    };

    fromBuffer = (buffer):PDU => {
       
        pduHeadParams.forEach(function(key, i) {
            this[key] = buffer.readUInt32BE(i * 4);
        }.bind(this));
        //Since each pduHeaderParam is 4 bytes/octets, the offset is equal to the total length of the
        //pduHeadParams*4, its better to use that basis for maintainance.
        let params, offset:number = pduHeadParams.length * 4;
        if (this.command_length > PDU.maxLength) {
            throw Error('PDU length was too large (' + this.command_length +
                ', maximum is ' + PDU.maxLength + ').');
        }
        if (commandsById[this.command_id]) {
            this.command = commandsById[this.command_id].command;
            params = commands[this.command].params || {};
        } else {
            this.command = 'unknown';
            return;
        }
        for (let key in params) {
            if (offset >= this.command_length) {
                break;
            }
            this[key] = params[key].type.read(buffer, offset);
            offset += params[key].type.size(this[key]);
        }
        while (offset + 4 <= this.command_length) {
            let tlvId = buffer.readUInt16BE(offset);
            let length:number = buffer.readUInt16BE(offset + 2);
            offset += 4;
            let tlv = tlvsById[tlvId];
            if (!tlv) {
                this[tlvId] = buffer.slice(offset, offset + length);
                offset += length;
                continue;
            }
            var tag = (commands[this.command].tlvMap || {})[tlv.tag] || tlv.tag;
            if (tlv.multiple) {
                if (!this[tag]) {
                    this[tag] = [];
                }
                this[tag].push(tlv.type.read(buffer, offset, length));
            } else {
                this[tag] = tlv.type.read(buffer, offset, length);
            }
            offset += length;
        }
        this._filter('decode');
    };



    _filter = (func) => {
        let params = commands[this.command].params || {};
        for (var key in this) {
            if (params[key] && params[key].filter) {
                this[key] = params[key].filter[func].call(this, this[key]);
            } else if (tlvs[key] && tlvs[key].filter) {
                if (tlvs[key].multiple) {
                        console.log(this[key])
                        //const arr =[...this[key]];
                         const arr =[this[key]];
                         arr.forEach(function(value, i) {
                         this[key][i] = tlvs[key].filter[func].call(this, value, true);
                    }.bind(this));
                } else {
                    if (key === 'message_payload') {
                        let skipUdh = this.short_message && this.short_message.message && this.short_message.message.length;
                        this[key] = tlvs[key].filter[func].call(this, this[key], skipUdh);
                    } else {
                        this[key] = tlvs[key].filter[func].call(this, this[key], true);
                    }
                }
            }
        }
    };

    _initBuffer = () => {
        let buffer = Buff.alloc(this.command_length);
        pduHeadParams.forEach(function(key, i) {
            buffer.writeUInt32BE(this[key], i * 4);
        }.bind(this));
        return buffer;
    };


    toBuffer = () => {
        //Since each pduHeaderParam is 4 bytes/octets, the offset is equal to the total length of the
        //pduHeadParams*4, its better to use that basis for maintainance.
        this.command_length = pduHeadParams.length * 4 ;
        if (this.command_status) {
            return this._initBuffer();
        }
        this._filter('encode');
        var params = commands[this.command].params || {};
        for (var key in this) {
            if (params[key]) {
                this.command_length += params[key].type.size(this[key]);
            } else if (tlvs[key]) {
                let values = tlvs[key].multiple ? [this[key]] : [this[key]];
                
                values.forEach(function(value) {
                    this.command_length += tlvs[key].type.size(value) + 4;
                }.bind(this));
            }
        }
        var buffer = this._initBuffer();
        //Since each pduHeaderParam is 4 bytes/octets, the offset is equal to the total length of the
        //pduHeadParams*4, its better to use that basis for maintainance.
        var offset = pduHeadParams.length * 4;
        for (let key in params) {
            params[key].type.write(this[key], buffer, offset);
            offset += params[key].type.size(this[key]);
        }
        for (var key in this) if (tlvs[key]) {
            var values = tlvs[key].multiple ? [this[key]] : [this[key]];
            values.forEach(function(value) {
                buffer.writeUInt16BE(tlvs[key].id, offset);
                var length = tlvs[key].type.size(value);
                buffer.writeUInt16BE(length, offset + 2);
                offset += 4;
                tlvs[key].type.write(value, buffer, offset);
                offset += length;
            });
        }
        return buffer;
    };
}





