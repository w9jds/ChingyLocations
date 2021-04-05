import { isAfter } from 'date-fns';
import { map, allSettled } from 'bluebird';
import { database } from 'firebase-admin';
import { TimeoutError, UserError } from './models/Errors';

import {
  Character,
  Ship,
  Location,
  Permissions,
  Reference
} from 'node-esi-stackdriver';

export default class Locations {
  public lastRun: number;
  private database = firebase.database();

  private users: Map<string, database.DataSnapshot> = new Map();

  constructor() {
    this.database.ref(`characters`).on("child_added", this.setUser);
    this.database.ref(`characters`).on("child_changed", this.setUser);
    this.database.ref(`characters`).on("child_removed", this.removeUser);
  }

  private setUser = (snapshot: database.DataSnapshot) => {
    const character: Character = snapshot.val();

    if ("accessToken" in character) {
      snapshot.child("accessToken").ref.remove();
    }
    if ("expiresAt" in character) {
      snapshot.child("expiresAt").ref.remove();
    }
    if ("refreshToken" in character) {
      snapshot.child("refreshToken").ref.remove();
    }

    if (!character.sso || !this.hasLocationScopes(character.sso)) {
      this.users.delete(snapshot.key);
      return;
    }

    this.users.set(snapshot.key, snapshot);
  };

  private removeUser = (snapshot: database.DataSnapshot) => {
    this.users.delete(snapshot.key);
  };

  private sleep = (seconds: number) => new Promise(resolve => {
    setTimeout(resolve, seconds * 1000);
  });

  public process = async () => {
    if (this.lastRun) {
      console.info(
        `last run at ${new Date(this.lastRun)} about ${(Date.now() - this.lastRun) / 1000} seconds ago.`
      );
    }

    try {
      this.lastRun = Date.now();
      const response = await esi.status();

      if (this.users.size < 1) {
        await this.sleep(6);
        return;
      }

      if ("players" in response) {
        await this.processUsers();
        return;
      }
      
      // logger.log(200, {}, "ESI is offline, waiting 35 seconds to check again");
      console.error('ESI is offline, waiting 35 seconds to check again');
      await this.sleep(35);
      return;

    } catch (error) {
      // logger.log(500, {}, error);
      console.error(error);
      console.info("Location service encountered an error, waiting 15 seconds before running next instance");
      await this.sleep(15);
      return;
    }
  };

  private processUsers = async () => {
    await map(this.users, user => this.processUser(user[1]), { concurrency: 500 });
  };

  private hasLocationScopes = (permissions: Permissions): boolean => {
    if (!permissions || !permissions.scope) {
      return false;
    }

    if (permissions.scope.indexOf("read_location") < 0) {
      return false;
    }
    if (permissions.scope.indexOf("read_ship_type") < 0) {
      return false;
    }
    if (permissions.scope.indexOf("read_online") < 0) {
      return false;
    }

    return true;
  };

  private validate = (user: database.DataSnapshot): Character | UserError => {
    const character: Character = user.val();
    
    if (!character.sso) {
      return {
        error: true,
        content: 'character not logged in',
        user: {
          id: user.key,
          name: user.child('name').val()
        }
      };
    }
    
    const expiresAt = new Date(character.sso.expiresAt);
    if (isAfter(new Date(), expiresAt)) {
      return {
        error: true,
        content: 'token expired',
        user: {
          id: user.key,
          name: user.child('name').val()
        }
      };
    }

    return character;
  }

  private processUser = async (user: database.DataSnapshot) => {
    const login = this.validate(user);

    if ("error" in login) {
      return;
    }
    
    if ("id" in login && login.sso) {
      await this.processOnlineCharacter(login);
      return;
    }

    return;
  }

  private timeoutRace = (id: number, type: string, timeout: number) => new Promise<TimeoutError>((resolve, reject) => {
    const interval = setTimeout(() => {
      clearTimeout(interval);
      resolve({ 
        id,
        type,
        error: true, 
        contents: `Request timed out after ${timeout}ms`
      });
    }, timeout);
  });

  private processOnlineCharacter = async (character: Character) => {
    const online = await esi.getCharacterOnline(character);

    if ("error" in online || online.online === false) {
      this.database.ref(`locations/${character.id}`).remove();
      return;
    }

    if (online.online === true) {
      const results = await allSettled([
        Promise.race([
          esi.getCharacterLocation(character),
          this.timeoutRace(character.id, 'location', 8000),
        ]),
        Promise.race([
          esi.getCharacterShip(character),
          this.timeoutRace(character.id, 'ship', 8000),
        ])
      ]);

      await this.setCharacterLocation(character, results);
      return;
    }
  };

  private getNames = async (location: Location, ship: Ship): Promise<Record<string, Reference>> => {
    const responses = await esi.getNames([
      location.solar_system_id,
      ship.ship_type_id
    ]);

    if ("error" in responses) {
      console.error(JSON.stringify(responses));
      return;
    }

    return responses.reduce((end, item) => {
      end[item.id] = item;
      return end;
    }, {});
  };

  private setCharacterLocation = async (character: Character, results) => {
    let ship: Ship;
    let location: Location;

    for (let result of results) {
      const value = result.value();
      
      if ("error" in value) {
        console.error(JSON.stringify(value));
        continue;
      }

      if ("solar_system_id" in value) {
        location = value;
        continue;
      }

      if ("ship_type_id" in value) {
        ship = value;
        continue;
      }
    }

    if (!ship || !location) {
      this.database.ref(`locations/${character.id}`).remove();
      return;
    }

    const names = await Promise.race([
      this.getNames(location, ship),
      this.timeoutRace(character.id, 'names', 8000),
    ]);

    if ('error' in names) {
      console.error(JSON.stringify(names));
      return;
    }

    if (!names[location.solar_system_id] || !names[ship.ship_type_id]) {
      console.error(`${character.id} names request missing items`);
      return;
    }

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
  };
}
