import * as admin from 'firebase-admin';
import * as cert from './config/new-eden-admin.json';

import Authentication from './lib/auth';
import { UserAgent, ProjectId } from './config/constants.js';
import { 
    Esi, Character, ErrorResponse, Ship, 
    Location, Permissions, Reference, Logger, Severity 
} from 'node-esi-stackdriver';

export type CharacterBase = Pick<Character, "id" | "name" | "accountId" | "corpId" | "allianceId" | "sso">;
console.log(`Starting child process ${process.pid}`)

global.esi = new Esi(UserAgent, { projectId: ProjectId });
global.logger = new Logger('locations', { projectId: ProjectId });
global.firebase = admin.initializeApp({
    credential: admin.credential.cert(cert as admin.ServiceAccount),
    databaseURL: 'https://new-eden-storage-a5c23.firebaseio.com'
});

const auth = new Authentication();
const database = firebase.database();

process.on('uncaughtException', e => {
    logger.log(Severity.ERROR, {}, e);
    process.exit(2);
});

process.on('unhandledRejection', e => {
    logger.log(Severity.ERROR, {}, e);
    process.exit(2);
});

process.on('message', async users => {
    const response = await esi.status();
    
    try {
        if (users.size < 1) {
            process.send({ error: true, backoff: 6 })
        }
        else if ('players' in response) {
            await Promise.all( users.map(user => processUser(user)) );
            process.send({ error: false, backoff: 0})
        }
        else {
            logger.log(Severity.INFO, {}, 'ESI is offline, waiting 35 seconds to check again');
            process.send({ error: true, backoff: 35 })
        }
    } catch(error) {
        logger.log(Severity.ERROR, {}, error);
        process.send({ error: true, backoff: 16 })
    }
})

const processUser = (user: CharacterBase) => new Promise(async (resolve, reject) => {
    const login = await auth.validate(user);

    if ('error' in login) {
        resolve();
    }
    else if ('id' in login && login.sso && hasLocationScopes(login.sso)) {
        await processOnlineCharacter(login);
        resolve();
    }
    else {
        resolve();
    }
});

const hasLocationScopes = (permissions: Permissions): boolean => {
    if (permissions.scope.indexOf('read_location') < 0) {
        return false;
    }
    if (permissions.scope.indexOf('read_ship_type') < 0) {
        return false;
    }
    if (permissions.scope.indexOf('read_online') < 0) {
        return false;
    }

    return true;
}

const processOnlineCharacter = async (character: CharacterBase): Promise<void> => {
    const online = await esi.getCharacterOnline(character as Character);

    if ('error' in online || online.online === false) {
        database.ref(`locations/${character.id}`).remove();
        return;
    }

    if (online.online === true) {
        const results = await Promise.all([
            esi.getCharacterLocation(character as Character), 
            esi.getCharacterShip(character as Character)
        ]);

        return await setCharacterLocation(character, results);
    }
}

const getNames = async (location: Location, ship: Ship): Promise<Record<string, Reference>> => {
    const responses = await esi.getNames([location.solar_system_id, ship.ship_type_id]);

    if ('error' in responses) {
        console.log(JSON.stringify(responses));
        return;
    }

    return responses.reduce((end, item) => {
        end[item.id] = item;
        return end;
    }, {});
}

const setCharacterLocation = async (character: CharacterBase, results: (Location | Ship | ErrorResponse)[]): Promise<void> => {
    let ship: Ship;
    let location: Location;

    for (let result of results) {
        if ('error' in result) {
            console.log(JSON.stringify(result.content));
            continue;
        }

        if ('solar_system_id' in result) {
            location = result;
            continue;
        }

        if ('ship_type_id' in result) {
            ship = result;
            continue;
        }
    }

    if (!ship || !location) {
        database.ref(`locations/${character.id}`).remove();
        return;
    }

    const names = await getNames(location, ship);

    if (names && location && ship) {
        await database.ref(`locations/${character.id}`).update({
            id: character.id,
            name: character.name,
            corpId: character.corpId ? character.corpId : null,
            allianceId: character.allianceId ? character.allianceId : null,
            ship: {
                typeId: ship.ship_type_id,
                name: ship.ship_name,
                itemId: ship.ship_item_id,
                type: names[ship.ship_type_id].name
            },
            location: {
                system: {
                    id: location.solar_system_id,
                    name: names[location.solar_system_id].name
                }
            }
        });
    }
}