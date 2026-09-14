// Preload for offline-only tests. Workers inherit this through NODE_OPTIONS.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
const deny = () => { throw new Error('Network disabled: offline tests must mock external services.'); };
globalThis.fetch = deny;
http.request = http.get = https.request = https.get = deny;
net.connect = net.createConnection = net.Socket.prototype.connect = deny;
syncBuiltinESMExports();
