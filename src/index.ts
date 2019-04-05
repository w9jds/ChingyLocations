import * as admin from 'firebase-admin';
import * as moment from 'moment';
import * as cert from './config/new-eden-admin.json';
import { Server, Request, ResponseToolkit } from 'hapi';

import Locations from './locations';
import { Logger, Severity } from 'node-esi-stackdriver';

const logger = new Logger('locations', { projectId: 'new-eden-storage-a5c23' });
const firebase = admin.initializeApp({
    credential: admin.credential.cert(cert as admin.ServiceAccount),
    databaseURL: 'https://new-eden-storage-a5c23.firebaseio.com'
});


const locations = new Locations(firebase.database(), logger);
const server: Server = new Server({
    port: process.env.PORT || 8000,
    host: '0.0.0.0'
});

async function init(): Promise<Server> {
    server.route({
        method: 'GET',
        path: '/_status/healthz',
        handler: (_: Request, h: ResponseToolkit) => {
            if (moment().subtract(15, 'seconds').isAfter(locations.lastRun)) {
                logger.log(Severity.INFO, {}, `Restarting Locations, Locations last ran: ${locations.lastRun.format('hh:mm:ss')}`);
                locations.start(moment());
            }
    
            return h.response();
        }
    });

    await server.start();

    return server;
}

init().then(server => {
    logger.log(Severity.INFO, {}, `Locations service started as: ${server.info.uri}`);
    locations.start(moment());
}).catch(error => {
    logger.log(Severity.ERROR, {}, error);
});