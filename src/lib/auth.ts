import * as moment from 'moment';
import fetch, {Response} from 'node-fetch';

import { UserAgent, EveClientId, EveSecret } from '../config/constants';
import { Logger, Severity, Permissions } from 'node-esi-stackdriver';
import { CharacterBase } from '../locations';

const logger = new Logger('esi', { projectId: 'new-eden-storage-a5c23' });
const headers = {
    'Accept': 'application/json',
    'User-Agent' : UserAgent
};

export default class Authenticator {

    private database = firebase.database();

    private async manageTokenRefreshErrors(user: CharacterBase, response: Response): Promise<any> {
        let content: any;
        let payload = {
            error: true,
            user: {
                id: user.id,
                name: user.name
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
            let userRef = this.database.ref(`characters/${user.id}`);

            userRef.update({ expired_scopes: user.sso.scope });

            userRef.child('sso').ref.remove();
            userRef.child('roles').ref.remove();
            userRef.child('titles').ref.remove();

            this.database.ref(`users/${user.accountId}/errors`).set(true);
            logger.log(Severity.NOTICE, {}, `Invalid user token, ${user.name} has been removed.`);
        }

        return payload;
    }

    public validate = async (user: CharacterBase): Promise<CharacterBase | UserError> => {
        const base: UserError = {
            error: true,
            user: {
                id: user.id,
                name: user.name
            }
        };

        if (!user.sso) {
            base.content = 'character not logged in';
            return base;
        }

        try {
            const expiresAt = moment(user.sso.expiresAt);
            if (moment().isAfter(expiresAt)) {
                const response = await this.refresh(user.sso.refreshToken);

                if (response.status == 200) {
                    const tokens = await response.json();
                    const verify = await this.verify(tokens.token_type, tokens.access_token);
                    let update: Permissions = {
                        accessToken: tokens.access_token,
                        refreshToken: tokens.refresh_token,
                        expiresAt: moment().add((tokens.expires_in - 60), 'seconds').valueOf()
                    }

                    user.sso.accessToken = tokens.access_token;
                    Promise.all([
                        this.database.ref(`characters/${user.id}/sso`).update(update),
                        this.database.ref(`characters/${user.id}`).update({
                            name: verify.CharacterName,
                            hash: verify.CharacterOwnerHash
                        })
                    ]);
                    return user;
                }
                return this.manageTokenRefreshErrors(user, response);
            }
            return user;
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
