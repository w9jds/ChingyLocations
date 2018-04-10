import { database } from 'firebase-admin';
import { UserAgent, EveClientId, EveSecret } from '../config/config';

import * as moment from 'moment';
import { Permissions, Character } from 'node-esi-stackdriver/models/Character';
import { Logger } from 'node-esi-stackdriver/libs/logging';
import { Severity } from 'node-esi-stackdriver/models/Log';

let logger = new Logger('esi');

export default class Authenticator {

    constructor(private firebase: database.Database) { }

    private async manageTokenRefreshErrors(user: database.DataSnapshot, response: Response): Promise<any> {
        let content = await response.json()

        await logger.logHttp('POST', response, content);

        if (content.error == 'invalid_grant' || content.error == 'invalid_token') {
            let scopes = user.child('sso/scope').val();
            user.ref.update({ expired_scopes: scopes });

            user.child('sso').ref.remove();
            user.child('roles').ref.remove();
            user.child('titles').ref.remove();
            this.firebase.ref(`users/${user.child('accountId').val()}/errors`).set(true);
            logger.log(Severity.NOTICE, {}, `Invalid user token, ${user.child('name').val()} has been removed.`);
        }

        return {
            error: true,
            response: content,
            user: {
                id: user.key,
                name: user.child('name').val()
            }
        };
    }

    public validate = async (user: database.DataSnapshot): Promise<any> => {
        let character: Character = user.val();
        if (!character.sso) {
            return {
                error: true,
                user: {
                    id: user.key,
                    name: user.child('name').val()
                }
            };
        }

        try {
            let expiresAt = moment(character.sso.expiresAt);
            if (moment().isAfter(expiresAt)) {
                let response = await this.refresh(character.sso.refreshToken);

                if (response.status == 200) {
                    let tokens = await response.json();
                    let update: Permissions = {
                        accessToken: tokens.access_token,
                        refreshToken: tokens.refresh_token,
                        expiresAt: moment().add((tokens.expires_in - 60), 'seconds').valueOf(),
                    }

                    character.sso.accessToken = tokens.access_token;
                    user.child('sso').ref.update(update);
                    return character;
                }
                else {
                    return this.manageTokenRefreshErrors(user, response);
                }
            }
            else {
                return character;
            }
        }
        catch(error) {
            console.log(error);
        }
    }

    private refresh = (refreshToken: string): Promise<any> => {
        return fetch('https://login.eveonline.com/oauth/token', {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + new Buffer(process.env.EVE_CLIENT_ID + ':' + process.env.EVE_SECRET).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded',
                'Host': 'login.eveonline.com'
            },
            body: `grant_type=refresh_token&refresh_token=${refreshToken}`
        });
    }
}
