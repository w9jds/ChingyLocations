import {database} from 'firebase-admin';
import * as moment from 'moment';
import { status, getCharacterOnline, getCharacterLocation, getCharacterShip, getNames } from './lib/esi';

import Authentication from './lib/auth';
import { Character } from './models/Character';

export default class Locations {

    private users: Map<string, database.DataSnapshot> = new Map();
    private auth: Authentication;
    public lastRun: moment.Moment;

    constructor(private firebase: database.Database) {
        this.auth = new Authentication(firebase);

        firebase.ref(`characters`).on('child_added', this.setUser);
        firebase.ref(`characters`).on('child_changed', this.setUser);
        firebase.ref(`characters`).on('child_removed', this.removeUser);
    }

    private setUser = (snapshot: database.DataSnapshot): void => {
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
        
        return await this.pushChanges(names, current);
    }

    public start = async (startTime: moment.Moment) => {
        this.lastRun = startTime;

        try {
            let response = await status();

            if (this.users.size < 1) {
                this.getCharacterLocations(6000, false);
            }
            else if (!response.statusCode) {    
                await this.trigger();
                
                let duration = moment.duration(moment().diff(startTime)).asMilliseconds();
                this.getCharacterLocations(6000 - duration > 0 ? 6000 - duration : 0, false);
            }
            else {
                console.error(JSON.stringify(response));
                console.info('ESI is offline, waiting 35 seconds to check again.');
                this.getCharacterLocations(35000, false);
            }
        }
        catch(error) {
            this.logError(error);
        }
    }

    private logError = error => {
        console.error(error);
        console.info("Location service encountered an error, waiting 15 seconds before running next instance.")
        this.getCharacterLocations(15000, true);
    }

    public validateUsers = (): Promise<any[]> => {
        let validation = [];

        this.users.forEach(user => {
             validation.push(this.auth.validate(user));
        });

        return Promise.all(validation);
    }

    public getCharacterStatuses = (characters): Promise<any[]> => {
        return Promise.all(
            characters
                .filter((character: Character) => {
                    if (!character || !character.id) return false;
                    if (!character.sso) return false;
                    if (character.sso.scope.indexOf('read_location') < 0) return false;
                    if (character.sso.scope.indexOf('read_ship_type') < 0) return false;

                    return true;
                })
                .map(character => getCharacterOnline(character))
        );
    }

    public getCharacterDetails = (results, current, online = []): Promise<any[]> => {
        let promises = [];

        online = results.filter(result => {
            if (result.error) {
                console.error(`${result.id}: received ${result.statusCode} from ${result.uri}`);
                return false;
            }

            if (result.online && result.online === true) {
                return true;
            }
            else {
                current[result.id] = {};
                return false;
            }
        });

        online.forEach(key => {
            let user: database.DataSnapshot = this.users.get(key.id) || this.users.get(key.id.toString());

            promises.push(getCharacterLocation(user.val() as Character));
            promises.push(getCharacterShip(user.val() as Character));
        });

        return Promise.all(promises);
    }

    public processDetails = (results, current): Promise<any[]> => {
        let ids = [];

        results.forEach(result => {
            let user: database.DataSnapshot = this.users.get(result.id) || this.users.get(result.id.toString());

            let base = current[result.id] || {
                id: result.id,
                name: user.child('name').val(),
                corpId: user.child('corpId').val(),
                allianceId: user.hasChild('allianceId') ? user.child('allianceId').val() : null
            };

            if (result.statusCode) {
                console.info(`${base.name}: received ${result.statusCode} from ${result.uri} ${result.body ? 'with' + result.body : ''}`);
            }
            else {
                if (result.solar_system_id) {
                    if (ids.indexOf(result.solar_system_id) < 0) {
                        ids.push(result.solar_system_id);
                    }

                    current[result.id] = {
                        ...base,
                        location: {
                            system: {
                                id: result.solar_system_id
                            }
                        }
                    }
                }
                if (result.ship_type_id) {
                    if (ids.indexOf(result.ship_type_id) < 0) {
                        ids.push(result.ship_type_id);
                    }

                    current[result.id] = {
                        ...base,
                        ship: {
                            typeId: result.ship_type_id,
                            name: result.ship_name,
                            itemId: result.ship_item_id
                        }
                    }
                }
            }
        });

        return ids.length > 0 ? getNames(ids) : null;
    }

    public pushChanges = async (names, current): Promise<any> => {
        if (!names || names.error) return;
        
        names = names.reduce((end, item) => {
            end[item.id] = item;
            return end;
        }, {});

        Object.keys(current).forEach(key => {
            let details = current[key];

            if (details.id) {
                details.location.system.name = names[details.location.system.id].name;
                details.ship.type = names[details.ship.typeId].name;
            }
        });

        return this.firebase.ref('locations').transaction(snapshot => {
            if (!snapshot) {
                snapshot = {};
            }

            Object.keys(current).forEach(userId => {
                if (snapshot[userId]) {
                    let old = snapshot[userId],
                        updated = current[userId];

                    if (!updated.id) {
                        delete snapshot[userId];
                    }
                    else if (!old.location.system || old.location.system.id != updated.location.system.id) {
                        snapshot[userId].location = updated.location;
                    }
                    else if (!old.ship || old.ship.typeId != updated.ship.typeId || old.ship.name != updated.ship.name) {
                        snapshot[userId].ship = updated.ship;
                    }
                }
                else if (current[userId].id) {
                    snapshot[userId] = current[userId];
                }
            });

            return snapshot;
        }, (error, committed) => {
            if (committed) {
                return;
            }
            else {
                console.log(error);
                throw error;
            }
        });
    }
}