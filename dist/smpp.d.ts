declare var EventEmitter: any;
declare class Options {
    host: string;
    hostname: string;
    tls: boolean;
    protocol: string;
    slashes: boolean;
    port: number;
    socket: any;
    auto_enquire_link_period: number;
    command: any;
    id: any;
    tag: any;
}
export declare class Session extends EventEmitter {
    options: Options;
    sequence: number;
    paused: boolean;
    _busy: boolean;
    _callbacks: any;
    _interval: any;
    socket: any;
    constructor(o: Options);
    _extractPDUs: () => void;
    connect: () => void;
    send: (pdu: any, responseCallback: any, sendCallback: any) => boolean;
    pause: () => void;
    resume: () => void;
    close: (callback: any) => void;
    destroy: (callback: any) => void;
}
export declare var connect: (url: string, listener?: any) => Session;
export declare var addCommand: (command: any, options: Options) => void;
export declare var addTLV: (tag: any, options: Options) => void;
export {};
