declare class Options {
    command_status: number;
    sequence_number: number;
}
export declare class PDU {
    options: Options;
    command: string;
    command_length: number;
    command_id: number;
    command_status: number;
    sequence_number: number;
    static maxLength: number;
    short_message: any;
    constructor(command: any, o?: Options);
    isResponse: () => boolean;
    response: (o: Options) => PDU;
    static fromStream: (stream: any) => boolean | PDU;
    static fromBuffer: (buffer: any) => boolean | PDU;
    fromBuffer: (buffer: any) => PDU;
    _filter: (func: any) => void;
    _initBuffer: () => any;
    toBuffer: () => any;
}
export {};
