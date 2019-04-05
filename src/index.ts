import * as admin from 'firebase-admin';
import * as cert from './config/new-eden-admin.json';

import Locations from './locations';
import { Logger } from 'node-esi-stackdriver';

const logger = new Logger('locations', { projectId: 'new-eden-storage-a5c23' });
const firebase = admin.initializeApp({
    credential: admin.credential.cert(cert as admin.ServiceAccount),
    databaseURL: 'https://new-eden-storage-a5c23.firebaseio.com'
});

new Locations(firebase.database(), logger).start();