import * as admin from 'firebase-admin';
import * as cert from './config/new-eden-admin.json';
import { Server, Request, ResponseToolkit } from 'hapi';

import Locations from './lib/locations';
import { Logger, Esi, Severity } from 'node-esi-stackdriver';
import { UserAgent, ProjectId } from './config/constants.js';

global.esi = new Esi(UserAgent, { projectId: ProjectId });
global.logger = new Logger('locations', { projectId: ProjectId });
global.firebase = admin.initializeApp({
    credential: admin.credential.cert(cert as admin.ServiceAccount),
    databaseURL: 'https://new-eden-storage-a5c23.firebaseio.com'
});

const locations = new Locations();
const server = new Server({
    port: process.env.PORT || 8000,
    host: '0.0.0.0'
});

const init = async (): Promise<Server> => {
    server.route({
        method: 'GET',
        path: '/_status/healthz',
        handler: (_: Request, h: ResponseToolkit) => {
            const lastRun = locations.getLastRun();
            console.log(`Locations last run at ${lastRun}`);
            const now = Date.now();
            console.log(`It has been about ${(now - lastRun) / 1000} seconds since the last run`);

            // if last run is greater than 0.75 minutes
            if (now - lastRun >= 45000) {
                console.info(`Restarting locations`);
                locations.start();
                // return h.response(`Restarting Locations, Locations last ran: ${new Date(lastRun)}`).code(500);
            }
    
            return h.response('ok').code(200);
        }
    });

    await server.start();

    return server;
}

init().then(server => {
    logger.log(Severity.INFO, {}, `Locations service started as: ${server.info.uri}`);
    locations.start();
}).catch(error => {
    logger.log(Severity.ERROR, {}, error);
    process.exit(1);
});
