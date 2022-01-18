

//Javascript implementation for the HEG peanut USB data stream  (AGPLv3.0)
//Adapted from HEGstudio made in python 2 by Jonathan Toomim (LGPL)
export class Peanut {
    constructor() {
        this.codes = { //bytecode struct formats
            0x02: {type: 'POOR_SIGNAL',   format:'<B',                byteLength:1},
            0x90: {type: 'unfilteredHEG', format:'<i',                byteLength:4},
            0x91: {type: 'filteredHEG',   format:'<i',                byteLength:4},
            0x93: {type: 'rawdata4',      format:'<i',                byteLength:4},
            0x94: {type: 'rawdata6',      format:'<iiii',             byteLength:4*4},
            0xA0: {type: 'sampleNumber',  format:'<i',                byteLength:4},
            0xB0: {type: 'debug0',        format:'<i',                byteLength:4},
            0xB1: {type: 'debug1',        format:'<i',                byteLength:4},
            0xB2: {type: 'debug2',        format:'<i',                byteLength:4},
            0xB3: {type: 'debug3',        format:'<i',                byteLength:4},
            0xB4: {type: 'debug4',        format:'<iiiiii',           byteLength:4*6},
            0xB5: {type: 'debug4',        format:'<iiiiii',           byteLength:4*6},
            0xB6: {type: 'rawdata27',     format:'<B'+'i'.repeat(26), byteLength:1+4*26}
        }

        this.data = {
            count:0,
            startms:0,
            ms:[],
            'unfilteredHEG':[],
            'filteredHEG':[],
            'rawdata4':[],
            'rawdata6':[],
            'debug0':[],
            'debug1':[],
            'debug2':[],
            'debug3':[],
            'debug4':[],
            'rawdata27':[]
        }

        this.buffer = []; //byte buffer
        
        this.baudrate = 38400;
        this.sps = 10.101;
        this.updateMs = 1000/this.sps; //ms between updates (even spacing)

        this.searchBytes = new Uint8Array([170,170]); //start of packet
        this.readRate = 1000/this.sps;
        this.readBufferSize = 200;

        this.maxBufferedSamples = this.sps*60*20; //max samples in buffer this.sps*60*nMinutes = max minutes of data
	
        this.resetDataBuffers();

    }

    resetDataBuffers(){
		this.data.count = 0;
		this.data.startms = 0;
		for(const prop in this.data) {
			if(typeof this.data[prop] === "object"){
				this.data[prop] = new Array(this.maxBufferedSamples).fill(0);
			}
		}
	}

    getLatestData(channel="filteredHEG",count=1) { //Return slice of specified size of the latest data from the specified channel
		let ct = count;
		if(ct <= 1) {
			return [this.data[channel][this.data.count-1]];
		}
		else {
			if(ct > this.data.count) {
				ct = this.data.count;
			}
			return this.data[channel].slice(this.data.count-ct,this.data.count);
		}
	}


    decode(buffer = this.buffer) { //returns true if successful, returns false if not

		var needle = this.searchString
		var haystack = buffer;
		var search = this.boyerMoore(needle);
		var skip = search.byteLength;
		var indices = [];
		let newLines = 0;

		for (var i = search(haystack); i !== -1; i = search(haystack, i + skip)) {
			indices.push(i);
		}
		//console.log(indices);
		if(indices.length >= 2){
			for(let k = 1; k < indices.length; k++) {
				if(indices[k] - indices[k-1] !== this.byteLength) {
					
				} //This is not a valid sequence going by size, drop sequence and return
				else {
					var line = buffer.slice(indices[k-1],indices[k]+1); //Splice out this line to be decoded
					
					// line[0] = stop byte, line[1] = start byte, line[2] = counter, line[3:99] = ADC data 32x3 bytes, line[100-104] = Accelerometer data 3x2 bytes

					//line found, decode.
					if(this.data.count < this.maxBufferedSamples){
						this.data.count++;
					}

					if(this.data.count-1 === 0) {this.data.ms[this.data.count-1]= Date.now(); this.data.startms = this.data.ms[0];}
					else {
						this.data.ms[this.data.count-1]=this.data.ms[this.data.count-2]+this.updateMs;
						
						if(this.data.count >= this.maxBufferedSamples) {
							this.data.ms.splice(0,5120);
							this.data.ms.push(new Array(5120).fill(0));
						}
					}//Assume no dropped samples
				
                    let i = 2;
					while(i < 200) { //packet length should be 200 bytes
						
                        if(this.codes[line[i]]) {
                            let unpacked =  
                                struct(this.codes[line[i]].format).unpack(
                                    new UInt8Array(
                                        line.slice(i+1,this.codes[line[i]].byteLength)).buffer
                                    );
                            let code = this.codes[line[i]].type;

                            if(code === 'unfilteredHEG' || code === 'filteredHEG') 
                                unpacked = unpacked[0]/256;
                            else if (code === 'POOR_SIGNAL' || code === 'sampleNumber' || code === 'debug0' || code === 'debug1' || code === 'debug2' || code === 'debug3') 
                                unpacked = unpacked[0];

                            this.data[this.codes[line[i]].type][this.data.count-1](unpacked);
                               
                            i += this.codes[line[i]].byteLength;

                            if(this.data.count >= this.maxBufferedSamples) { 
                                this.data[channel].splice(0,5120);
                                this.data[channel].push(new Array(5120).fill(0));//shave off the last 10 seconds of data if buffer full (don't use shift())
                            }
                            
                        } else i++; //probably junk in this byte, skip it

                        	//console.log(this.data[channel][this.data.count-1],indices[k], channel)
					}

					if(this.data.count >= this.maxBufferedSamples) { 
						this.data.count -= 5120;
					}
					//console.log(this.data)
					newLines++;
					//console.log(indices[k-1],indices[k])
					//console.log(buffer[indices[k-1],buffer[indices[k]]])
					//indices.shift();
				}
				
			}
			if(newLines > 0) buffer.splice(0,indices[indices.length-1]);
			return newLines;
			//Continue
		}
		//else {this.buffer = []; return false;}
	}

	//Callbacks
	onDecodedCallback(newLinesInt){
		//console.log("new samples:", newLinesInt);
	}

	onConnectedCallback() {
		console.log("port connected!");
	}

	onDisconnectedCallback() {
		console.log("port disconnected!");
	}

	onReceive(value){
		this.buffer.push(...value);

		let newLines = this.decode(this.buffer);
		//console.log(this.data)
		//console.log("decoding... ", this.buffer.length)
		if(newLines !== false && newLines !== 0 && !isNaN(newLines) ) this.onDecodedCallback(newLines);
	}

	async subscribe(port){
		if (this.port.readable && this.subscribed === true) {
			this.reader = port.readable.getReader();
			const streamData = async () => {
				try {
					const { value, done } = await this.reader.read();
					if (done || this.subscribed === false) {
						// Allow the serial port to be closed later.
						await this.reader.releaseLock();
						
					}
					if (value) {
						//console.log(value.length);
						try{
							this.onReceive(value);
						}
						catch (err) {console.log(err)}
						//console.log("new Read");
						//console.log(this.decoder.decode(value));
					}
					if(this.subscribed === true) {
						setTimeout(()=>{streamData();}, this.readRate);//Throttled read 1/512sps = 1.953ms/sample @ 103 bytes / line or 1030bytes every 20ms
					}
				} catch (error) {
					console.log(error);// TODO: Handle non-fatal read error.
                    if(error.message.includes('framing') || error.message.includes('overflow') || error.message.includes('Overflow') || error.message.includes('break')) {
                        this.subscribed = false;
                        setTimeout(async ()=>{
							try{
                            if (this.reader) {
                                await this.reader.releaseLock();
                                this.reader = null;
                            }
							} catch (er){ console.error(er);}
                            this.subscribed = true; 
                            this.subscribe(port);
                            //if that fails then close port and reopen it
                        },30); //try to resubscribe 
                    } else if (error.message.includes('parity') || error.message.includes('Parity') || error.message.includes('overrun') ) {
                        if(this.port){
                            this.subscribed = false;
                            setTimeout(async () => {
								try{
                                if (this.reader) {
                                    await this.reader.releaseLock();
                                    this.reader = null;
                                }
                                await port.close();
								} catch (er){ console.error(er);}
                                //this.port = null;
                                this.connected = false;
                                setTimeout(()=>{this.onPortSelected(this.port)},100); //close the port and reopen
                            }, 50);
                        }
                    }
                     else {
                        this.closePort();	
                    }	
				}
			}
			streamData();
		}
	}


	async onPortSelected(port,baud=this.baudrate) {
		try{
            let encoder = new TextEncoder();
			try {
				await port.open({ baudRate: baud, bufferSize: this.readBufferSize });
                port.write('protocol 3\n');
				this.onConnectedCallback();
				this.connected = true;
				this.subscribed = true;
				this.subscribe(port);//this.subscribeSafe(port);
		
			} //API inconsistency in syntax between linux and windows
			catch {
				await port.open({ baudrate: baud, buffersize: this.readBufferSize });
                port.write('protocol 3\n');
				this.onConnectedCallback();
				this.connected = true;
				this.subscribed = true;
				this.subscribe(port);//this.subscribeSafe(port);
			}
		}
		catch(err){
			console.log(err);
			this.connected = false;
		}
	}

    async close(port=this.port) {
		//if(this.reader) {this.reader.releaseLock();}
		if(this.port){
			this.subscribed = false;
			setTimeout(async () => {
				if (this.reader) {
					await this.reader.releaseLock();
					this.reader = null;
				}
				await port.close();
				this.port = null;
				this.connected = false;
				this.onDisconnectedCallback();
			}, 100);
		}
	}

	async connect(baudrate=this.baudrate) { //You can specify baudrate just in case

		const filters = [
			{ usbVendorId: 0x10c4, usbProductId: 0x0043 } //CP2102 filter (e.g. for UART via ESP32)
		];

		this.port = await navigator.serial.requestPort();
		navigator.serial.addEventListener("disconnect",(e) => {
			this.closePort(this.port);
		});
		this.onPortSelected(this.port,baudrate);

		//navigator.serial.addEventListener("onReceive", (e) => {console.log(e)});//this.onReceive(e));

	}

    
	//Boyer Moore fast byte search method copied from https://codereview.stackexchange.com/questions/20136/uint8array-indexof-method-that-allows-to-search-for-byte-sequences
	asUint8Array(input) {
		if (input instanceof Uint8Array) {
			return input;
		} else if (typeof(input) === 'string') {
			// This naive transform only supports ASCII patterns. UTF-8 support
			// not necessary for the intended use case here.
			var arr = new Uint8Array(input.length);
			for (var i = 0; i < input.length; i++) {
			var c = input.charCodeAt(i);
			if (c > 127) {
				throw new TypeError("Only ASCII patterns are supported");
			}
			arr[i] = c;
			}
			return arr;
		} else {
			// Assume that it's already something that can be coerced.
			return new Uint8Array(input);
		}
	}

	boyerMoore(patternBuffer) {
		// Implementation of Boyer-Moore substring search ported from page 772 of
		// Algorithms Fourth Edition (Sedgewick, Wayne)
		// http://algs4.cs.princeton.edu/53substring/BoyerMoore.java.html
		/*
		USAGE:
			// needle should be ASCII string, ArrayBuffer, or Uint8Array
			// haystack should be an ArrayBuffer or Uint8Array
			var search = boyerMoore(needle);
			var skip = search.byteLength;
			var indices = [];
			for (var i = search(haystack); i !== -1; i = search(haystack, i + skip)) {
				indices.push(i);
			}
		*/
		var pattern = this.asUint8Array(patternBuffer);
		var M = pattern.length;
		if (M === 0) {
			throw new TypeError("patternBuffer must be at least 1 byte long");
		}
		// radix
		var R = 256;
		var rightmost_positions = new Int32Array(R);
		// position of the rightmost occurrence of the byte c in the pattern
		for (var c = 0; c < R; c++) {
			// -1 for bytes not in pattern
			rightmost_positions[c] = -1;
		}
		for (var j = 0; j < M; j++) {
			// rightmost position for bytes in pattern
			rightmost_positions[pattern[j]] = j;
		}
		var boyerMooreSearch = (txtBuffer, start, end) => {
			// Return offset of first match, -1 if no match.
			var txt = this.asUint8Array(txtBuffer);
			if (start === undefined) start = 0;
			if (end === undefined) end = txt.length;
			var pat = pattern;
			var right = rightmost_positions;
			var lastIndex = end - pat.length;
			var lastPatIndex = pat.length - 1;
			var skip;
			for (var i = start; i <= lastIndex; i += skip) {
				skip = 0;
				for (var j = lastPatIndex; j >= 0; j--) {
				var c = txt[i + j];
				if (pat[j] !== c) {
					skip = Math.max(1, j - right[c]);
					break;
				}
				}
				if (skip === 0) {
				return i;
				}
			}
			return -1;
		};
		boyerMooreSearch.byteLength = pattern.byteLength;
		return boyerMooreSearch;
	}
	//---------------------end copy/pasted solution------------------------


}

//struct packing/unpacking by https://github.com/lyngklip/structjs (MIT License)
/*eslint-env es6*/
const rechk = /^([<>])?(([1-9]\d*)?([xcbB?hHiIfdsp]))*$/
const refmt = /([1-9]\d*)?([xcbB?hHiIfdsp])/g
const str = (v,o,c) => String.fromCharCode(
    ...new Uint8Array(v.buffer, v.byteOffset + o, c))
const rts = (v,o,c,s) => new Uint8Array(v.buffer, v.byteOffset + o, c)
    .set(s.split('').map(str => str.charCodeAt(0)))
const pst = (v,o,c) => str(v, o + 1, Math.min(v.getUint8(o), c - 1))
const tsp = (v,o,c,s) => { v.setUint8(o, s.length); rts(v, o + 1, c - 1, s) }
const lut = le => ({
    x: c=>[1,c,0],
    c: c=>[c,1,o=>({u:v=>str(v, o, 1)      , p:(v,c)=>rts(v, o, 1, c)     })],
    '?': c=>[c,1,o=>({u:v=>Boolean(v.getUint8(o)),p:(v,B)=>v.setUint8(o,B)})],
    b: c=>[c,1,o=>({u:v=>v.getInt8(   o   ), p:(v,b)=>v.setInt8(   o,b   )})],
    B: c=>[c,1,o=>({u:v=>v.getUint8(  o   ), p:(v,B)=>v.setUint8(  o,B   )})],
    h: c=>[c,2,o=>({u:v=>v.getInt16(  o,le), p:(v,h)=>v.setInt16(  o,h,le)})],
    H: c=>[c,2,o=>({u:v=>v.getUint16( o,le), p:(v,H)=>v.setUint16( o,H,le)})],
    i: c=>[c,4,o=>({u:v=>v.getInt32(  o,le), p:(v,i)=>v.setInt32(  o,i,le)})],
    I: c=>[c,4,o=>({u:v=>v.getUint32( o,le), p:(v,I)=>v.setUint32( o,I,le)})],
    f: c=>[c,4,o=>({u:v=>v.getFloat32(o,le), p:(v,f)=>v.setFloat32(o,f,le)})],
    d: c=>[c,8,o=>({u:v=>v.getFloat64(o,le), p:(v,d)=>v.setFloat64(o,d,le)})],
    s: c=>[1,c,o=>({u:v=>str(v,o,c), p:(v,s)=>rts(v,o,c,s.slice(0,c    ) )})],
    p: c=>[1,c,o=>({u:v=>pst(v,o,c), p:(v,s)=>tsp(v,o,c,s.slice(0,c - 1) )})]
})
const errbuf = new RangeError("Structure larger than remaining buffer")
const errval = new RangeError("Not enough values for structure")
export function struct(format) {
    let fns = [], size = 0, m = rechk.exec(format)
    if (!m) { throw new RangeError("Invalid format string") }
    const t = lut('<' === m[1]), lu = (n, c) => t[c](n ? parseInt(n, 10) : 1)
    while ((m = refmt.exec(format))) { ((r, s, f) => {
        for (let i = 0; i < r; ++i, size += s) { if (f) {fns.push(f(size))} }
    })(...lu(...m.slice(1)))}
    const unpack_from = (arrb, offs) => {
        if (arrb.byteLength < (offs|0) + size) { throw errbuf }
        let v = new DataView(arrb, offs|0)
        return fns.map(f => f.u(v))
    }
    const pack_into = (arrb, offs, ...values) => {
        if (values.length < fns.length) { throw errval }
        if (arrb.byteLength < offs + size) { throw errbuf }
        const v = new DataView(arrb, offs)
        new Uint8Array(arrb, offs, size).fill(0)
        fns.forEach((f, i) => f.p(v, values[i]))
    }
    const pack = (...values) => {
        let b = new ArrayBuffer(size)
        pack_into(b, 0, ...values)
        return b
    }
    const unpack = arrb => unpack_from(arrb, 0)
    function* iter_unpack(arrb) { 
        for (let offs = 0; offs + size <= arrb.byteLength; offs += size) {
            yield unpack_from(arrb, offs);
        }
    }
    return Object.freeze({
        unpack, pack, unpack_from, pack_into, iter_unpack, format, size})
}
/*
const pack = (format, ...values) => struct(format).pack(...values)
const unpack = (format, buffer) => struct(format).unpack(buffer)
const pack_into = (format, arrb, offs, ...values) =>
    struct(format).pack_into(arrb, offs, ...values)
const unpack_from = (format, arrb, offset) =>
    struct(format).unpack_from(arrb, offset)
const iter_unpack = (format, arrb) => struct(format).iter_unpack(arrb)
const calcsize = format => struct(format).size
module.exports = {
    struct, pack, unpack, pack_into, unpack_from, iter_unpack, calcsize }
*/