import { database } from 'firebase-admin';
import { Severity, Character, ErrorResponse, Ship, Location, Permissions, Reference } from 'node-esi-stackdriver';
import Authentication from './auth';
import { map } from 'bluebird';

export default class Locations {

    private lastRun: number;
    private database = firebase.database();
    private users: Map<string, database.DataSnapshot> = new Map();
    private auth = new Authentication();

    constructor() {
        this.database.ref(`characters`).on('child_added', this.setUser);
        this.database.ref(`characters`).on('child_changed', this.setUser);
        this.database.ref(`characters`).on('child_removed', this.removeUser);
    }

    // public getLastRun = (): number => this.lastRun;

    private setUser = (snapshot: database.DataSnapshot) => {
        let character = snapshot.val();

        if ('accessToken' in character) {
            snapshot.child('accessToken').ref.remove();
        }
        if ('expiresAt' in character) {
            snapshot.child('expiresAt').ref.remove();
        }
        if ('refreshToken' in character) {
            snapshot.child('refreshToken').ref.remove();
        }

        this.users.set(snapshot.key, snapshot);
    }

    private removeUser = (snapshot: database.DataSnapshot) => {
        this.users.delete(snapshot.key);
    }

    private sleep = (seconds: number): Promise<void> => new Promise(resolve => {
        setTimeout(resolve, seconds * 1000)
    })

    public start = async () => {
        for (;;) {
            if (this.lastRun) {
                console.info(`last run at ${new Date(this.lastRun)} about ${(Date.now() - this.lastRun) / 1000} seconds ago.`);
            }

            try {
                this.lastRun = Date.now();
                let response = await esi.status();

                if (this.users.size < 1) {
                    await this.sleep(6);
                }
                else if ('players' in response) {
                    await this.processUsers();
                }
                else {
                    logger.log(Severity.INFO, {}, 'ESI is offline, waiting 35 seconds to check again');
                    await this.sleep(35);
                }
            }
            catch (error) {
                logger.log(Severity.ERROR, {}, error);
                console.info("Location service encountered an error, waiting 15 seconds before running next instance")
                await this.sleep(15);
            }
        }
    }

    private processUsers = async () => {
        await map(this.users, user => this.processUser(user[1]), { concurrency: 500 });
    }
    
    private processUser = (user: database.DataSnapshot) => new Promise(async (resolve, reject) => {
        const login = await this.auth.validate(user);
    
        if ('error' in login) {
            resolve();
        }
        else if ('id' in login && login.sso && this.hasLocationScopes(login.sso)) {
            await this.processOnlineCharacter(login);
            resolve();
        }
        else {
            resolve();
        }
    });

    private hasLocationScopes = (permissions: Permissions): boolean => {
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

    private processOnlineCharacter = async (character: Character): Promise<void> => {
        const online = await esi.getCharacterOnline(character);

        if ('error' in online || online.online === false) {
            this.database.ref(`locations/${character.id}`).remove();
            return;
        }

        if (online.online === true) {
            const results = await Promise.all([
                esi.getCharacterLocation(character), 
                esi.getCharacterShip(character)
            ]);

            return await this.setCharacterLocation(character, results);
        }
    }

    private getNames = async (location: Location, ship: Ship): Promise<Record<string, Reference>> => {
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

    private setCharacterLocation = async (character: Character, results: (Location | Ship | ErrorResponse)[]): Promise<void> => {
        let ship: Ship;
        let location: Location;
    
        for (let result of results) {
            if ('error' in result) {
                console.log(JSON.stringify(location));
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
            this.database.ref(`locations/${character.id}`).remove();
            return;
        }

        const names = await this.getNames(location, ship);

        if (names && location && ship) {
            await this.database.ref(`locations/${character.id}`).update({
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
            }).catch(error => {
                console.error(`Update of locations failed: ${error}`);
            });
        }
    }

}