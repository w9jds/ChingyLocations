import * as admin from 'firebase-admin';
import * as moment from 'moment';
import * as cert from './config/neweden-admin.json';

import Locations from './locations';
import { Server, Request, ResponseToolkit } from 'hapi';

let firebase = admin.initializeApp({
    credential: admin.credential.cert(cert as admin.ServiceAccount),
    databaseURL: 'https://new-eden-storage-a5c23.firebaseio.com'
});

const locations = new Locations(firebase.database());

const server: Server = new Server({
    port: process.env.PORT || 8000,
    host: '0.0.0.0'
});

async function init(): Promise<Server> {
    createHealthRoutes();

    await server.start();

    return server;
}

const createHealthRoutes = () => {
    server.route({
        method: 'GET',
        path: '/_status/healthz',
        handler: (request: Request, h: ResponseToolkit) => {
            if (moment().subtract(15, 'seconds').isAfter(locations.lastRun)) {
                console.info(`Restarting Locations, Locations last ran: ${locations.lastRun.format('hh:mm:ss')}`);
                locations.start(moment());
            }

            return h.response();
        }
    });
}

init().then(server => {
    console.log('Server running at:', server.info.uri);
    console.log('Locations service started');
    locations.start(moment());
}).catch(error => {
    console.log(error);  
});