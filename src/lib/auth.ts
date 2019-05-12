import * as moment from 'moment';
import { database } from 'firebase-admin';
import fetch, {Response} from 'node-fetch';

import { UserAgent, EveClientId, EveSecret } from '../config/constants';
import { Logger, Severity, Permissions, Character, Esi } from 'node-esi-stackdriver';

const logger = new Logger('esi', { projectId: 'new-eden-storage-a5c23' });
const headers = {
    'Accept': 'application/json',
    'User-Agent' : UserAgent
};

export default class Authenticator {

    private database = firebase.database();

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
            user.child('roles').ref.remove();
            user.child('titles').ref.remove();

            this.database.ref(`users/${user.child('accountId').val()}/errors`).set(true);
            logger.log(Severity.NOTICE, {}, `Invalid user token, ${user.child('name').val()} has been removed.`);
        }

        return payload;
    }

    public validate = async (user: database.DataSnapshot): Promise<any> => {
        let character: Character = user.val();
        const base: UserError = {
            error: true,
            user: {
                id: user.key,
                name: user.child('name').val()
            }
        };

        if (!character.sso) {
            base.content = 'character not logged in';
            return base;
        }

        try {
            const expiresAt = moment(character.sso.expiresAt);
            if (moment().isAfter(expiresAt)) {
                const response = await this.refresh(character.sso.refreshToken);

                if (response.status == 200) {
                    const tokens = await response.json();
                    const verify = await this.verify(tokens.token_type, tokens.access_token);
                    let update: Permissions = {
                        accessToken: tokens.access_token,
                        refreshToken: tokens.refresh_token,
                        expiresAt: moment().add((tokens.expires_in - 60), 'seconds').valueOf()
                    }

                    character.sso.accessToken = tokens.access_token;
                    Promise.all([
                        user.child('sso').ref.update(update),
                        user.ref.update({
                            name: verify.CharacterName,
                            hash: verify.CharacterOwnerHash
                        })
                    ]);
                    return character;
                }
                return this.manageTokenRefreshErrors(user, response);
            }
            return character;
        }
        catch(error) {
            base.error = error;
            return base;
        }
    }

    private verify = async (type: string, token: string): Promise<any> => {
        const response: Response = await fetch('https://login.eveonline.com/oauth/verify/', {
            method: 'GET',
            headers: {
                'Authorization': type + ' ' + token,
                'Host': 'login.eveonline.com',
                ...headers
            }
        });

        if (response.status === 200) {
            return response.json();
        }
        else {
            throw new Error(`Invalid Login: ${response.status} ${response.body}`);
        }
    }

    private refresh = (refreshToken: string): Promise<any> => 
        fetch('https://login.eveonline.com/oauth/token', {
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
