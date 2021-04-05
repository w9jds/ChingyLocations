import * as admin from 'firebase-admin';
import * as cert from './config/neweden-admin.json';

import Locations from './locations';
import { Logger, Esi } from 'node-esi-stackdriver';
import { UserAgent, ProjectId } from './config/constants.js';

global.esi = new Esi(UserAgent, { projectId: ProjectId });
global.logger = new Logger('locations', { projectId: ProjectId });
global.firebase = admin.initializeApp({
  credential: admin.credential.cert(cert as admin.ServiceAccount),
  databaseURL: 'https://new-eden-storage-a5c23.firebaseio.com'
});

const locations = new Locations();

const shutdown = (e) => {
  console.error(e);
  process.exit(1);
}

process.on('uncaughtException', shutdown);
process.on('unhandledRejection', shutdown);

const main = async () => {
  await locations.process();
  main();
}

try {
  main();
}
catch(error) {
  shutdown(error);
}