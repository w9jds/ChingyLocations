import * as admin from 'firebase-admin';
import * as cert from './config/neweden-admin.json';

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

process.on('uncaughtException', e => {
    logger.log(Severity.ERROR, {}, e);
    process.exit(2);
});

process.on('unhandledRejection', e => {
    logger.log(Severity.ERROR, {}, e);
    process.exit(2);
});

try {
    locations.start();
}
catch(error) {
    console.error(error);
    locations.start();
}