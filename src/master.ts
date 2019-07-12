import { database } from 'firebase-admin';
import { Character } from 'node-esi-stackdriver';
import { fork, exec } from 'child_process';

export type CharacterBase = Pick<Character, "id" | "name" | "accountId" | "corpId" | "allianceId" | "sso">

export default class Master {
    private concurrency = 500;
    private database = firebase.database();
    private users: Map<string, CharacterBase> = new Map();

    private channels: number = 0;
    private isFlagged: boolean = false;
    private response: () => void;

    constructor() {
        this.database.ref(`characters`).on('child_added', this.setUser);
        this.database.ref(`characters`).on('child_changed', this.setUser);
        this.database.ref(`characters`).on('child_removed', this.removeUser);
    }

    private setUser = (snapshot: database.DataSnapshot) => {
        let character: Character = snapshot.val();

        if ('accessToken' in character) {
            snapshot.child('accessToken').ref.remove();
        }
        if ('expiresAt' in character) {
            snapshot.child('expiresAt').ref.remove();
        }
        if ('refreshToken' in character) {
            snapshot.child('refreshToken').ref.remove();
        }

        this.users.set(snapshot.key, {
            id: character.id,
            name: character.name,
            accountId: character.accountId,
            corpId: character.corpId,
            allianceId: character.allianceId,
            sso: character.sso
        });
    }

    private removeUser = (snapshot: database.DataSnapshot) => {
        this.users.delete(snapshot.key);
    }

    private channelClosed = async (code: number, signal: string) => {
        this.channels -= 1;

        if (code === 1) {
            this.isFlagged = true;
        }

        if (this.channels === 0) {
            if (this.isFlagged) {
                await this.sleep(15);
            }

            this.isFlagged = false;
            this.response();
        }
    }

    private sleep = (seconds: number): Promise<void> => new Promise(resolve => {
        setTimeout(resolve, seconds * 1000)
    })

    public startWorkers = async (callback: () => void) => {
        if (this.users.size < 1) {
            await this.sleep(6);
            callback();
        }

        if (!this.channels) {
            this.response = callback;
            this.channels = Math.ceil(this.users.size / this.concurrency);
           
            let keys = [...this.users.keys()];
            for (let i = this.channels; i > 0; i--) {
                const startPosition = this.concurrency * (i - 1);
                const endPosition = startPosition + this.concurrency;
                const ids = keys.slice(startPosition, endPosition);
                
                this.forkShard(ids.map(key => this.users.get(key)), i);
            }
        }
    }
    
    private forkShard = (characters: CharacterBase[], index: number) => {
        console.log(`${__dirname}`);

        const forked = fork(`locations.js`, [], {
            cwd: __dirname,
            env: process.env,
            execArgv: [
                `--inspect-brk=${process.debugPort + index}`
            ]
        });

        forked.on('exit', this.channelClosed);
        forked.send(characters);
    }
}