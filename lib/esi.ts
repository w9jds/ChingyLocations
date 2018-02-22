import { UserAgent } from '../config/config';
import { access } from 'fs';
import { Character } from '../models/Character';

let headers = {
    'Accept': 'application/json',
    'User-Agent' : UserAgent
};

export const verifyResponse = async (response): Promise<any> => {
    if (response.status >= 200 && response.status <= 300) {
        return response.json();
    }
    else if (response.bodyUsed) {
        let error = await response.json();

        return {
            error: true,
            body: response.body,
            statusCode: response.status,
            message: error,
            uri: response.url
        };
    }
    else {
        return {
            error: true,
            statusCode: response.status,
            uri: response.url
        }
    }
}


export const status = (): Promise<any> => {
    return fetch('https://esi.tech.ccp.is/latest/status/?datasource=tranquility', {
        method: 'GET',
        headers
    }).then(verifyResponse);
}

export const getCharacterOnline = (character: Character): Promise<any> => {
    return new Promise((resolve, reject) => {
        fetch(`https://esi.tech.ccp.is/v2/characters/${character.id}/online/`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${character.sso.accessToken}`,
                ...headers
            }
        })
        .then(verifyResponse)
        .then(content => {
            resolve({
                id: character.id,
                ...content
            });
        })
    }); 
}

export const getCharacterLocation = (character: Character): Promise<any> => {
    return fetch(`https://esi.tech.ccp.is/latest/characters/${character.id}/location/`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${character.sso.accessToken}`,
            ...headers
        }
    })
    .then(verifyResponse)
    .then(payload => {
        return {
            id: character.id,
            ...payload
        };
    });
}

export const getCharacterShip = (character: Character): Promise<any> => {
    return fetch(`https://esi.tech.ccp.is/latest/characters/${character.id}/ship/`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${character.sso.accessToken}`,
            ...headers
        }
    })
    .then(verifyResponse)
    .then(payload => {
        return {
            id: character.id,
            ...payload
        }
    });
}

export const getNames = (ids: string[] | number[]): Promise<any> => {
    return fetch('https://esi.tech.ccp.is/v2/universe/names/', {
        method: 'POST',
        body: JSON.stringify(ids),
        headers: {
            'Content-Type': 'application/json',
            ...headers
        }
    }).then(verifyResponse);
}