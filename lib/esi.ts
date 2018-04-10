import { UserAgent } from '../config/config';
import { Character } from '../models/Character';
import { Logger } from '../utils/logging';
import { Severity } from '../models/Log';

let logger = new Logger('esi');
let headers = {
    'Accept': 'application/json',
    'User-Agent' : UserAgent
};

export const verifyResponse = async (method: string, response: Response): Promise<any> => {
    let body;
    if (response.body) {
        body = await response.json();
    }

    await logger.logHttp(method, response, body);

    if (response.status >= 200 && response.status < 300) {
        return body;
    }
    else {
        return {
            error: true,
            statusCode: response.status,
            uri: response.url
        }
    }
}

export const status = async (): Promise<any> => {
    try {
        const response: Response = await fetch('https://esi.tech.ccp.is/latest/status/?datasource=tranquility', {
            method: 'GET',
            headers
        });
            
        return await verifyResponse('GET', response);
    }
    catch(error) {
        await logger.log(Severity.ERROR, {}, error);
        return {
            error: true, 
            statusCode: 500,
            uri: 'https://esi.tech.ccp.is/latest/status/?datasource=tranquility'
        };
    }
}

export const getCharacterOnline = async (character: Character): Promise<any> => {
    try {
        const response: Response = await fetch(`https://esi.tech.ccp.is/v2/characters/${character.id}/online/`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${character.sso.accessToken}`,
                ...headers
            }
        });

        const content = await verifyResponse('GET', response);
        
        return {
            id: character.id,
            ...content
        };
    }
    catch(error) {
        await logger.log(Severity.ERROR, {}, error);
        return {
            error: true, 
            statusCode: 500,
            uri: `https://esi.tech.ccp.is/v2/characters/${character.id}/online/`
        };
    }
}

export const getCharacterLocation = async (character: Character): Promise<any> => {
    try {
        const response: Response = await fetch(`https://esi.tech.ccp.is/latest/characters/${character.id}/location/`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${character.sso.accessToken}`,
                ...headers
            }
        });

        const content = await verifyResponse('GET', response);

        return {
            id: character.id,
            ...content
        };
    }
    catch (error) {
        await logger.log(Severity.ERROR, {}, error);
        return {
            error: true, 
            statusCode: 500,
            uri: `https://esi.tech.ccp.is/latest/characters/${character.id}/location/`
        };
    }
}

export const getCharacterShip = async (character: Character): Promise<any> => {
    try {
        const response: Response = await fetch(`https://esi.tech.ccp.is/latest/characters/${character.id}/ship/`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${character.sso.accessToken}`,
                ...headers
            }
        });

        const content = await verifyResponse('GET', response);

        return {
            id: character.id,
            ...content
        };
    }
    catch(error) {
        await logger.log(Severity.ERROR, {}, error);
        return {
            error: true, 
            statusCode: 500,
            uri: `https://esi.tech.ccp.is/latest/characters/${character.id}/ship/`
        };
    }
}

export const getNames = async (ids: string[] | number[]): Promise<any> => {
    try {
        const response: Response = await fetch('https://esi.tech.ccp.is/v2/universe/names/', {
            method: 'POST',
            body: JSON.stringify(ids),
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        });

        return await verifyResponse('POST', response);
    }
    catch(error) {
        await logger.log(Severity.ERROR, {}, error);
        return {
            error: true, 
            statusCode: 500,
            uri: 'https://esi.tech.ccp.is/v2/universe/names/'
        };
    }
}