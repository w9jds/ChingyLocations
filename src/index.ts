import * as admin from 'firebase-admin';
import * as cert from './config/new-eden-admin.json';

import { Logger, Esi } from 'node-esi-stackdriver';
import { UserAgent, ProjectId } from './config/constants.js';
import Master from './master.js';

global.esi = new Esi(UserAgent, { projectId: ProjectId });
global.logger = new Logger('locations', { projectId: ProjectId });
global.firebase = admin.initializeApp({
    credential: admin.credential.cert(cert as admin.ServiceAccount),
    databaseURL: 'https://new-eden-storage-a5c23.firebaseio.com'
});

const master = new Master();

process.on('uncaughtException', e => {
    console.error(e);
    process.exit(2);
});

process.on('unhandledRejection', e => {
    console.error(e);
    process.exit(2);
});

const init = () => {
    master.startWorkers(init);
}

init();