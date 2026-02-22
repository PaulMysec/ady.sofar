/* jslint node: true */

'use strict';

const { Driver } = require('homey');

class LanDriver extends Driver {

	async getLanDevices(Type) {
		const inverters = this.homey.app.getDiscoveredInverters();
		this.homey.app.updateLog(`Inverters: ${this.homey.app.varToString(inverters)}`, 2);

		if (inverters.length > 0) {
			const devices = [];

			// Create an array of devices
			for (const device of inverters) {
				for (const group of device.inverter.parameter_definition.parameters) {
					if (group.group === Type) {
						let data = {};
						data = {
							id: device.inverter_sn,
							type: Type,
						};

						// Add this device to the table
						devices.push(
							{
								name: device.inverter_sn.toString(),
								data,
							},
						);
					}
				}
			}
			return devices;
		}

		throw (new Error('Nothing returned'));
	}

}

module.exports = LanDriver;
