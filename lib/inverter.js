/* eslint-disable camelcase */
/* eslint-disable no-console */
/* jslint node: true */

'use strict';

// Code based on https://github.com/StephanJoubert/home_assistant_solarman
// From solarman.py

const net = require('node:net');
const ParameterParser = require('./parse');

const sofar_lsw3 = require('./sofar_lsw3.json');
const sofar_g3hyd = require('./sofar_g3hyd.json');
const solis_hybrid = require('./solis_hybrid.json');
const deye_hybrid = require('./deye_hybrid.json');
const sofar_hy_es = require('./sofar_hy_es.json');
const sofar_se1es = require('./sofar_se1es.json');

const START_OF_MESSAGE = 0xA5;
const END_OF_MESSAGE = 0x15;
const CONTROL_CODE = [0x10, 0x45];
const SERIAL_NO = [0x00, 0x00];
const SEND_DATA_FIELD = [0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
const BIG = false;
const LITTLE = true;

class Inverter {

	constructor(serial, host, port, mb_slaveid, lookup_file) {
		this.busy = false;
		this._serial = serial;
		this._host = host;
		this._port = port;
		this._mb_slaveid = mb_slaveid;
		this._current_val = null;
		this.status_connection = 'Disconnected';
		this.status_lastUpdate = 'N/A';

		if (lookup_file === 'sofar_g3hyd') {
			this.parameter_definition = sofar_g3hyd;
		}
		else if (lookup_file === 'solis_hybrid') {
			this.parameter_definition = solis_hybrid;
		}
		else if (lookup_file === 'deye_hybrid') {
			this.parameter_definition = deye_hybrid;
		}
		else if (lookup_file === 'sofar_hy_es') {
			this.parameter_definition = sofar_hy_es;
		}
		else if (lookup_file === 'sofar_se1es') {
			this.parameter_definition = sofar_se1es;
		}
		else {
			this.parameter_definition = sofar_lsw3;
		}

		this.retryRequest = new Uint8Array([165, 23, 0, 16, 69, 0, 0, 101, 120, 45, 138, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 2, 0, 0, 1, 133, 178, 64, 21]);
	}

	setHost(host) {
		this._host = host;
	}

	getModbusChksum(data) {
		let crc = 0xFFFF;
		for (let i = 0; i < data.length; i++) {
			crc ^= data[i];
			for (let j = 0; j < 8; j++) {
				if (crc & 1) {
					crc = (crc >>> 1) ^ 0xA001;
				} else {
					crc >>>= 1;
				}
			}
		}
		return crc & 0xFFFF;
	}

	intToArray(value, size, littleEndian) {
		const serial_hex = value.toString(16).padStart(size, 0);
		const serial_bytes = [];
		for (let c = 0; c < serial_hex.length; c += 2) {
			serial_bytes.push(parseInt(serial_hex.substr(c, 2), 16));
		}

		if (littleEndian) {
			serial_bytes.reverse();
		}

		return serial_bytes;
	}

	get_serial_hex() {
		return this.intToArray(this._serial, 4, LITTLE);
	}

	get_read_business_field(start, length, mb_fc) {
		let request_data = [];
		request_data = request_data.concat(this.intToArray(this._mb_slaveid, 2, BIG));
		request_data = request_data.concat(this.intToArray(mb_fc, 2, BIG));
		request_data = request_data.concat(this.intToArray(start, 4, BIG));
		request_data = request_data.concat(this.intToArray(length, 4, BIG));
		const crc = this.getModbusChksum(request_data);
		request_data = request_data.concat(this.intToArray(crc, 4, LITTLE));

		// request_data = bytearray([this._mb_slaveid, mb_fc]); // Function Code
		// request_data.extend(start.to_bytes(2, 'big'));
		// request_data.extend(length.to_bytes(2, 'big'));
		// crc = this.modbus(request_data);
		// request_data.extend(crc.to_bytes(2, 'little'));
		return request_data;
	}

	// Switched to generate standard Modbus RTU over TCP packet
	generate_request(start, length, mb_fc) {
		const request_data = Buffer.alloc(6);
		request_data.writeUInt8(this._mb_slaveid, 0);
		request_data.writeUInt8(mb_fc, 1);
		request_data.writeUInt16BE(start, 2);
		request_data.writeUInt16BE(length, 4);

		let crc = 0xFFFF;
		for (let i = 0; i < request_data.length; i++) {
			crc ^= request_data[i];
			for (let j = 0; j < 8; j++) {
				if (crc & 1) {
					crc = (crc >>> 1) ^ 0xA001;
				} else {
					crc >>>= 1;
				}
			}
		}

		const crcBuffer = Buffer.alloc(2);
		crcBuffer.writeUInt16LE(crc, 0); // Modbus CRC is Little Endian

		return Buffer.concat([request_data, crcBuffer]);
	}

	validate_checksum(packet) {
		return true; // Not used for transparent Modbus
	}

	// Returns -1 if the data is corrupted, 0 if the data is incomplete or the number of bytes to be processed
	// Returns -1 if the data is corrupted, 0 if the data is incomplete or the number of bytes to be processed
	validateMODBUSData(MODBUSPacket, mb_functioncode) {
		if (MODBUSPacket.length < 3) {
			// Not enough data so try to collect some more
			return 0;
		}

		// Now validate the MODBUS data
		if ((MODBUSPacket[0] === this._mb_slaveid) && (MODBUSPacket[1] === mb_functioncode)) {
			// Found a valid MODBUS start so extract the transmitted number of MODBUS data bytes
			const byteCountRequired = MODBUSPacket[2];
			const byteCountReceived = MODBUSPacket.length - 5;
			if (byteCountRequired > byteCountReceived) {
				// Not enough data so try to collect some more
				return 0;
			}

			const modbusData = MODBUSPacket.subarray(0, 3 + byteCountRequired); // Get the MODBUSS packet (without the checksum)
			const chkSumCalc = this.getModbusChksum(modbusData); // Calculate the checksum
			const chkSumRx = MODBUSPacket.readUInt16LE(3 + byteCountRequired); // Extract the packet checksum
			if (chkSumCalc === chkSumRx) {
				// Valid checksum so return the number of bytes to process
				return byteCountRequired;
			}
		}

		// Bad data
		return -1;
	}

	async send_request(start, end, mb_fc, retries = 3) {
		console.log(`send_request: start = ${start}, end = ${end}, fc = ${mb_fc}, retries=${retries}`);

		const length = end - start + 1;
		const requestData = this.generate_request(start, length, mb_fc);

		// Wait if busy, but don't get stuck forever
		let busyWaitCount = 0;
		while (this.busy && busyWaitCount < 50) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			busyWaitCount++;
		}

		this.busy = true;

		return new Promise((resolve, reject) => {
			let returnData = [];
			const writeBuffer = Buffer.from(requestData);

			const conn = new net.Socket();
			conn.setTimeout(5000);

			conn.on('error', (err) => {
				console.log(`[ADY.SOFAR] TCP Error: ${err.message}`);
				conn.destroy();
				this.busy = false;
				if (retries > 0) {
					console.log(`[ADY.SOFAR] Retrying... (${retries - 1} left)`);
					setTimeout(() => {
						resolve(this.send_request(start, end, mb_fc, retries - 1));
					}, 1000);
				} else {
					reject(err);
				}
			});

			conn.on('timeout', () => {
				console.log('[ADY.SOFAR] TCP Timeout');
				conn.destroy();
				this.busy = false;
				if (retries > 0) {
					console.log(`[ADY.SOFAR] Retrying... (${retries - 1} left)`);
					setTimeout(() => {
						resolve(this.send_request(start, end, mb_fc, retries - 1));
					}, 1000);
				} else {
					reject(new Error('TCP Timeout'));
				}
			});

			conn.connect(this._port, this._host, () => {
				console.log(`[ADY.SOFAR] SENT:`, writeBuffer.toString('hex'));
				conn.write(writeBuffer);
			});

			let receiveBuffer = Buffer.alloc(0);

			conn.on('data', (data) => {
				// Wait for at least 5 bytes (SlaveID, FC, ByteCount, CRC1, CRC2)
				if (data.length < 5 || data[0] !== this._mb_slaveid || data[1] !== mb_fc) {
					conn.destroy();
					this.busy = false;
					if (retries > 0) {
						setTimeout(() => { resolve(this.send_request(start, end, mb_fc, retries - 1)); }, 1000);
					} else {
						reject(new Error('Invalid Modbus response'));
					}
					return;
				}

				const byteCount = data[2];
				const expectedLength = 3 + byteCount + 2; // header(3) + data + crc(2)

				// Accumulate data if fragmented
				returnData.push(data);
				const combinedData = Buffer.concat(returnData);

				if (combinedData.length >= expectedLength) {
					// We have a full packet.
					const modbusPacket = combinedData.subarray(0, expectedLength);
					const bytesToProcess = this.validateMODBUSData(modbusPacket, mb_fc);

					if (bytesToProcess < 0) {
						conn.destroy();
						this.busy = false;
						if (retries > 0) {
							setTimeout(() => { resolve(this.send_request(start, end, mb_fc, retries - 1)); }, 1000);
						} else {
							reject(new Error('Modbus CRC check failed'));
						}
						return;
					}

					// Extract just the data portion (ignoring SlaveID, FC, Length byte, and CRC)
					const modbusData = modbusPacket.subarray(3, 3 + bytesToProcess);
					conn.destroy();
					resolve(modbusData);
					return;
				}
			});
			conn.on('end', () => {
				this.busy = false;
			});
			conn.on('close', () => {
				this.busy = false;
			});
			conn.on('error', (err) => {
				// console.log(`Connection error: ${err}`);
				reject(new Error(`Send Error: ${err}`));
			});
			conn.on('timeout', () => {
				console.log('Connection timeout');
				conn.destroy();
				resolve(Buffer.concat(returnData));
			});
		});
	}

	update() {
		this.get_statistics();
	}

	async get_statistics() {
		let result = false;
		let error = false;
		const params = new ParameterParser(this.parameter_definition);
		for (const request of this.parameter_definition.requests) {
			try {
				this._current_val = await this.send_request(request.start, request.end, request.mb_functioncode);
				params.parse(this._current_val, request.start, (request.end - request.start + 1));
				result = true;
			}
			catch (err) {
				console.log('send_request error', err.message);
				error = true;
			}
		}
		if (result && !error) {
			this.status_lastUpdate = new Date(Date.now()).toLocaleString();
			this.status_connection = 'Connected';
			this._current_val = params.get_result();
			return this._current_val;
		}

		if (!result) {
			this.status_connection = 'Disconnected';
		}
		return null;
	}

	get_current_val() {
		return this._current_val;
	}

	get_sensors() {
		const params = new ParameterParser(this.parameter_definition);
		return params.get_sensors();
	}

}

module.exports = Inverter;
