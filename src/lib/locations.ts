import * as bluebird from 'bluebird';
import { database } from 'firebase-admin';

import Authentication from './auth';
import { Severity, Character, ErrorResponse, Reference, Online, Ship, Location } from 'node-esi-stackdriver';
import { CharacterLocation } from '../models/Locations';

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

    public getLastRun = (): number => this.lastRun;

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

    private trigger = async () => {
        let current = {};
        const users = await this.validateUsers();
        const status = await this.getCharacterStatuses(users);
        const details = await this.getCharacterDetails(status, current);
        const names = await this.processDetails(details, current);
        
        return this.pushChanges(names, current);
    }

    private sleep = (ms: number): Promise<void> => new Promise(resolve => {
        setTimeout(resolve, ms)
    })

    public start = async () => {
        for (;;) {
            try {
                this.lastRun = Date.now();
                let response = await esi.status();

                if (this.users.size < 1) {
                    await this.sleep(6000);
                }
                else if ('players' in response) {
                    await this.trigger();
                }
                else {
                    logger.log(Severity.INFO, {}, 'ESI is offline, waiting 35 seconds to check again');
                    await this.sleep(35000);
                }
            }
            catch (error) {
                logger.log(Severity.ERROR, {}, error);
                console.info("Location service encountered an error, waiting 15 seconds before running next instance")
                await this.sleep(15000);
            }
        }
    }

    private validateUsers = (): bluebird<any[]> => bluebird.map(this.users, user => this.auth.validate(user[1]))
    
    private getCharacterStatuses = (characters: Character[]): bluebird<any[]> => {
        const filter = characters.filter((character: Character) => {
            if (!character || !character.id) return false;
            if (!character.sso) return false;
            if (character.sso.scope.indexOf('read_location') < 0) return false;
            if (character.sso.scope.indexOf('read_ship_type') < 0) return false;
            return true;
        });

        return bluebird.map(filter, character => {
            return esi.getCharacterOnline(character)
        });
    }

    private getCharacterDetails = (results, current): bluebird<any[]> => {
        const online: Online[] = results.filter((result: Online | ErrorResponse) => {
            if ('error' in result) {
                return false;
            }

            if (result.online === true) {
                return true;
            }
             
            current[result.id] = false;
            return false;
        });

        return bluebird.map(online, (status: Online) => {
            const user: database.DataSnapshot = this.users.get(status.id.toString());

            return Promise.all([
                esi.getCharacterLocation(user.val() as Character),
                esi.getCharacterShip(user.val() as Character)
            ]);
        })
    }


    private processDetails = (results: (Location | Ship | ErrorResponse)[], current): Promise<Reference[] | ErrorResponse> => {
        let ids = [];

        for (let result of results) {
            const characterId: number = result[0].id || result[1].id || null;
            if (characterId) {
                const ship: Ship | ErrorResponse = result[1];
                const location: Location | ErrorResponse = result[0];
                const user: database.DataSnapshot = this.users.get(characterId.toString());
                
                if ('error' in location) {
                    console.log(JSON.stringify(location));
                    continue;
                }
                
                if ('error' in ship) {
                    console.log(JSON.stringify(ship));
                    continue;
                }

                if (ids.indexOf(location.solar_system_id) < 0) {
                    ids.push(location.solar_system_id);
                }

                if (ids.indexOf(ship.ship_type_id) < 0) {
                    ids.push(ship.ship_type_id);
                }

                current[user.key] = {
                    id: Number(user.key),
                    name: user.child('name').val(),
                    corpId: user.child('corpId').val(),
                    allianceId: user.hasChild('allianceId') ? user.child('allianceId').val() : null,
                    ship: {
                        typeId: ship.ship_type_id,
                        name: ship.ship_name,
                        itemId: ship.ship_item_id
                    },
                    location: {
                        system: {
                            id: location.solar_system_id
                        }
                    }
                };
            }
        };

        return ids.length > 0 ? esi.getNames(ids) : null;
    }

    private pushChanges = async (names, current): Promise<any> => {
        if (!names || 'error' in names) {
            return;
        }
        
        names = names.reduce((end, item) => {
            end[item.id] = item;
            return end;
        }, {});

        return bluebird.map(Object.keys(current), (key: string) => {
            let details: CharacterLocation | false = current[key];

            if (details === false || !details.location || !details.ship) {
                return this.database.ref(`locations/${key}`).remove();
            }

            if (details.location.system && details.location.system.id) {
                details.location.system.name = names[details.location.system.id].name;
            }

            if (details.ship && details.ship.typeId) {
                details.ship.type = names[details.ship.typeId].name;
            }

            return this.database.ref(`locations/${key}`).set(details);
        });
    }
}