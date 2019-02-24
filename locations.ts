import * as moment from 'moment';
import * as bluebird from 'bluebird';
import {database} from 'firebase-admin';
import { UserAgent } from './config/config';

import Authentication from './lib/auth';
import { Esi, Logger, 
    Severity, Character, ErrorResponse,
    Reference, Online, Ship, Location
} from 'node-esi-stackdriver';

export default class Locations {

    private esi: Esi;
    private users: Map<string, database.DataSnapshot> = new Map();
    private auth: Authentication;
    public lastRun: moment.Moment;

    constructor(private firebase: database.Database, private logger: Logger) {
        this.auth = new Authentication(firebase);

        firebase.ref(`characters`).on('child_added', this.setUser);
        firebase.ref(`characters`).on('child_changed', this.setUser);
        firebase.ref(`characters`).on('child_removed', this.removeUser);

        this.esi = new Esi(UserAgent, {
            projectId: 'new-eden-storage-a5c23'
        });
    }

    private setUser = (snapshot: database.DataSnapshot): void => {
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

    private removeUser = (snapshot: database.DataSnapshot): void => {
        this.users.delete(snapshot.key);
    }

    private getCharacterLocations = (delay: number, error: boolean) => {
        if (error === false) {
            this.lastRun = moment();
        }
    
        setTimeout(() => {
            this.start(moment());
        }, delay);
    }

    private trigger = async () => {
        let current = {};
        let users = await this.validateUsers();
        let status = await this.getCharacterStatuses(users);
        let details = await this.getCharacterDetails(status, current);
        let names = await this.processDetails(details, current);
        
        return this.pushChanges(names, current);
    }

    public start = async (startTime: moment.Moment) => {
        this.lastRun = startTime;

        try {
            let response = await this.esi.status();

            if (this.users.size < 1) {
                this.getCharacterLocations(6000, false);
            }
            else if ('players' in response) {
                await this.trigger();

                let duration = moment.duration(moment().diff(startTime)).asMilliseconds();
                this.getCharacterLocations(6000 - duration > 0 ? 6000 - duration : 0, false);
            }
            else {
                this.logger.log(Severity.INFO, {}, 'ESI is offline, waiting 35 seconds to check again.');
                this.getCharacterLocations(35000, false);
            }
        }
        catch (error) {
            this.logger.log(Severity.ERROR, {}, error);
            console.info("Location service encountered an error, waiting 15 seconds before running next instance.")
            this.getCharacterLocations(15000, true);
        }
    }

    public validateUsers = (): bluebird<any[]> => {
        return bluebird.map(this.users, user => {
            return this.auth.validate(user[1]);
        });
    }

    public getCharacterStatuses = (characters: Character[]): bluebird<any[]> => {
        const filter = characters.filter((character: Character) => {
            if (!character || !character.id) return false;
            if (!character.sso) return false;
            if (character.sso.scope.indexOf('read_location') < 0) return false;
            if (character.sso.scope.indexOf('read_ship_type') < 0) return false;
            return true;
        });

        return bluebird.map(filter, character => {
            return this.esi.getCharacterOnline(character)
        });
    }

    public getCharacterDetails = (results, current): bluebird<any[]> => {
        const online: Online[] = results.filter((result: Online | ErrorResponse) => {
            if ('error' in result) {
                return false;
            }

            if (result.online === true) {
                return true;
            }
            else {
                current[result.id] = false;
                return false;
            }
        });

        return bluebird.map(online, (status: Online) => {
            const user: database.DataSnapshot = this.users.get(status.id.toString());

            return Promise.all([
                this.esi.getCharacterLocation(user.val() as Character),
                this.esi.getCharacterShip(user.val() as Character)
            ]);
        })
    }

    public processDetails = (results: (Location | Ship | ErrorResponse)[], current): Promise<Reference[] | ErrorResponse> => {
        let ids = [];

        for (let result of results) {
            let characterId: number = result[0].id || result[1].id || null;
            if (characterId) {
                const user: database.DataSnapshot = this.users.get(characterId.toString());
                const location: Location | ErrorResponse = result[0];
                const ship: Ship | ErrorResponse = result[1];
                const base = {
                    id: user.key,
                    name: user.child('name').val(),
                    corpId: user.child('corpId').val(),
                    allianceId: user.hasChild('allianceId') ? user.child('allianceId').val() : null
                };

                if ('error' in location) {
                    console.log(JSON.stringify(location));
//                  this.logger.log(Severity.ERROR, {}, location);
                }
                else {
                    if (ids.indexOf(location.solar_system_id) < 0) {
                        ids.push(location.solar_system_id);
                    }

                    base['location'] = {
                        system: {
                            id: location.solar_system_id
                        }
                    }
                }

                if ('error' in ship) {
                    console.log(JSON.stringify(ship));
//                  this.logger.log(Severity.ERROR, {}, ship);
                }
                else {
                    if (ids.indexOf(ship.ship_type_id) < 0) {
                        ids.push(ship.ship_type_id);
                    }

                    base['ship'] = {
                        typeId: ship.ship_type_id,
                        name: ship.ship_name,
                        itemId: ship.ship_item_id
                    };
                }

                current[user.key] = base;
            }
        };

        return ids.length > 0 ? this.esi.getNames(ids) : null;
    }

    public pushChanges = async (names, current): Promise<any> => {
        if (!names || 'error' in names) {
            return;
        }
        
        names = names.reduce((end, item) => {
            end[item.id] = item;
            return end;
        }, {});

        return bluebird.map(Object.keys(current), (key: string) => {
            let details = current[key];

            if (details === false || !details.location || !details.ship) {
                return this.firebase.ref(`locations/${key}`).remove();
            }

            if (details.location.system && details.location.system.id) {
                details.location.system.name = names[details.location.system.id].name;
            }

            if (details.ship && details.ship.typeId) {
                details.ship.type = names[details.ship.typeId].name;
            }

            return this.firebase.ref(`locations/${key}`).set(details);
        });
    }
}