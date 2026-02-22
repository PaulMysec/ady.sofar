# Solarman

Configured Transparent Mode: The inverter logger manually switched to Transparent Mode via its hidden configuration portal (http://[LOGGER_IP]/config_hide.html). This instructed the logger to stop encapsulating local traffic in V5 headers and prioritize local TCP Modbus RTU traffic.

Rewrote Protocol Layer (inverter.js): The application's connection layer was simplified to discard the SolarmanV5 wrappers entirely. 

Repaired CRC Logic: Fixed the 16-bit shift logic in Javascript to ensure perfectly signed 0xA001 XOR polynomials during CRC generation.

Integrated and tuned a correct mapping format specifically for the SE1ES430. While initial values populated, metrics like Battery Voltage, Current, and Temperature originally displayed as 0 due to incorrect register offsets. A full raw memory scan was executed to correlate live snapshot values to the user dashboard. The configuration was successfully repaired to accurately decode the exact Modbus address block:

Battery Voltage (Reg 526)
Battery Current (Reg 527)
Battery Charge SOC (Reg 528)
Internal Temperature (Reg 529)

Manual Device Linking / Network Discovery Override: **Due to the user's data logger operating in "Transparent Mode", the inverter inherently ignores all UDP network discovery broadcasts**. To completely eradicate the failed discovery system natively within Homey, the application was thoroughly refactored:

**Built an explicit "Manual IP" and "Manual Serial" configuration UI directly inside the Homey App Settings page.**
