import * as moment from 'moment';
import { database } from 'firebase-admin';
import fetch, {Response} from 'node-fetch';

import { UserAgent, EveClientId, EveSecret } from '../config/constants';
import { Logger, Severity, Permissions, Character } from 'node-esi-stackdriver';

const logger = new Logger('esi', { projectId: 'new-eden-storage-a5c23' });

export default class Authenticator {

    constructor(private firebase: database.Database) { }

    private async manageTokenRefreshErrors(user: database.DataSnapshot, response: Response): Promise<any> {
        let content: any;
        let payload = {
            error: true,
            user: {
                id: user.key,
                name: user.child('name').val()
            }
        };

        try {
            content = await response.json();
            payload['response'] = content;
            await logger.logHttp('POST', response, content);
        }
        catch (error) {
            payload['response'] = error;
        }
        
        if (content && content.error && (content.error == 'invalid_grant' || content.error == 'invalid_token')) {
            let scopes = user.child('sso/scope').val();
            user.ref.update({ expired_scopes: scopes });

            user.child('sso').ref.remove();
            user.child('hash').ref.remove();
            user.child('roles').ref.remove();
            user.child('titles').ref.remove();

            this.firebase.ref(`users/${user.child('accountId').val()}/errors`).set(true);
            logger.log(Severity.NOTICE, {}, `Invalid user token, ${user.child('name').val()} has been removed.`);
        }

        return payload;
    }

    public validate = async (user: database.DataSnapshot): Promise<any> => {
        let character: Character = user.val();
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

        try {
            let expiresAt = moment(character.sso.expiresAt);
            if (moment().isAfter(expiresAt)) {
                let response = await this.refresh(character.sso.refreshToken);

                if (response.status == 200) {
                    let tokens = await response.json();
                    let update: Permissions = {
                        accessToken: tokens.access_token,
                        refreshToken: tokens.refresh_token,
                        expiresAt: moment().add((tokens.expires_in - 60), 'seconds').valueOf()
                    }

                    character.sso.accessToken = tokens.access_token;
                    user.child('hash').ref.update(tokens);
                    user.child('sso').ref.update(update);
                    return character;
                }
                return this.manageTokenRefreshErrors(user, response);
            }
            return character;
        }
        catch(error) {
            logger.log(Severity.ERROR, {}, error);
        }
    }

    private refresh = (refreshToken: string): Promise<any> => {
        return fetch('https://login.eveonline.com/oauth/token', {
            method: 'POST',
            headers: {
                'User-Agent': UserAgent,
                'Authorization': 'Basic ' + new Buffer(EveClientId + ':' + EveSecret).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded',
                'Host': 'login.eveonline.com'
            },
            body: `grant_type=refresh_token&refresh_token=${refreshToken}`
        });
    }
}
